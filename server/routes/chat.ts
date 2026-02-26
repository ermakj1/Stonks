import { Router } from 'express';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { streamChat, type AIProvider, type ChatMessage, type ToolExecutor } from '../services/ai.js';
import { getAllPrices, type StockQuote, type OptionsData } from '../services/yahoo.js';
import { getFilteredChain } from '../services/cboe.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOLDINGS_PATH      = path.resolve(__dirname, '../../data/holdings.json');
const STRATEGY_PATH      = path.resolve(__dirname, '../../data/strategy.md');
const SYSTEM_PROMPT_PATH = path.resolve(__dirname, '../../data/system_prompt.md');

export const chatRouter = Router();

interface StockEntry {
  shares: number;
  cost_basis: number;
  target_allocation_pct: number;
  notes: string;
}

interface OptionEntry {
  ticker: string;
  type: string;
  strike: number;
  expiration: string;
  contracts: number;
  premium_paid: number;
  saved_price?: number;
  target_price?: number;
  notes: string;
}

interface Holdings {
  lastUpdated: string;
  stocks: Record<string, StockEntry>;
  options: Record<string, OptionEntry>;
}

function buildSystemPrompt(
  persona: string,
  strategy: string,
  holdings: Holdings,
  prices: { stocks: StockQuote[]; options: OptionsData[] }
): string {
  const priceMap = new Map(prices.stocks.map((s) => [s.ticker, s]));
  const optionPriceMap = new Map(prices.options.map((o) => [o.key, o]));

  const ownedStocks   = Object.entries(holdings.stocks).filter(([, s]) => s.shares > 0);
  const watchedStocks = Object.entries(holdings.stocks).filter(([, s]) => s.shares === 0);
  const ownedOptions   = Object.entries(holdings.options).filter(([, o]) => o.contracts > 0);
  const watchedOptions = Object.entries(holdings.options).filter(([, o]) => o.contracts === 0);

  const fmtOwnedStock = ([ticker, s]: [string, StockEntry]) => {
    const q = priceMap.get(ticker);
    const currentPrice = q?.price ?? 0;
    const pnl = (currentPrice - s.cost_basis) * s.shares;
    const pnlPct = s.cost_basis > 0 ? ((currentPrice - s.cost_basis) / s.cost_basis) * 100 : 0;
    return [
      `  ${ticker}: ${s.shares} shares @ cost basis $${s.cost_basis.toFixed(2)}`,
      `    Current: $${currentPrice.toFixed(2)} (${q?.changePercent?.toFixed(2) ?? 0}% today)`,
      `    P&L: $${pnl.toFixed(2)} (${pnlPct.toFixed(1)}%)`,
      `    Target allocation: ${s.target_allocation_pct}%`,
      s.notes ? `    Notes: ${s.notes}` : '',
    ].filter(Boolean).join('\n');
  };

  const fmtWatchedStock = ([ticker, s]: [string, StockEntry]) => {
    const q = priceMap.get(ticker);
    const currentPrice = q?.price ?? 0;
    return [
      `  ${ticker}: watching (not owned)`,
      `    Current: $${currentPrice.toFixed(2)} (${q?.changePercent?.toFixed(2) ?? 0}% today)`,
      s.cost_basis > 0 ? `    Cost target / reference: $${s.cost_basis.toFixed(2)}` : '',
      s.notes ? `    Notes: ${s.notes}` : '',
    ].filter(Boolean).join('\n');
  };

  const fmtOwnedOption = ([key, o]: [string, OptionEntry]) => {
    const od = optionPriceMap.get(key);
    const gainDollar = od?.mid != null ? (od.mid - o.premium_paid) * o.contracts * 100 : null;
    const gainPct    = gainDollar != null && o.premium_paid > 0 ? (gainDollar / (o.premium_paid * o.contracts * 100)) * 100 : null;
    return [
      `  ${o.ticker} ${o.type.toUpperCase()} $${o.strike} exp ${o.expiration} x${o.contracts} contracts`,
      `    Premium paid: $${o.premium_paid.toFixed(2)}/contract`,
      od?.mid != null
        ? `    Current mid: $${od.mid.toFixed(2)} | Bid/Ask: $${od.bid?.toFixed(2) ?? 'N/A'}/$${od.ask?.toFixed(2) ?? 'N/A'}`
        : '    Current mid: N/A',
      od?.iv != null ? `    IV: ${(od.iv * 100).toFixed(1)}% | DTE: ${od.daysToExpiration} days` : `    DTE: ${od?.daysToExpiration ?? 'N/A'} days`,
      gainDollar != null ? `    P&L: $${gainDollar.toFixed(2)} (${gainPct?.toFixed(1)}%)` : '',
      o.notes ? `    Notes: ${o.notes}` : '',
    ].filter(Boolean).join('\n');
  };

  const fmtWatchedOption = ([, o]: [string, OptionEntry]) => {
    return [
      `  ${o.ticker} ${o.type.toUpperCase()} $${o.strike} exp ${o.expiration}: watching (not owned)`,
      o.saved_price != null ? `    Mid when added to watchlist: $${o.saved_price.toFixed(2)}` : '',
      o.target_price != null && o.target_price > 0 ? `    Target mid price: $${o.target_price.toFixed(2)}` : '',
      o.notes ? `    Notes: ${o.notes}` : '',
    ].filter(Boolean).join('\n');
  };

  const section = (items: string[]) => items.length > 0 ? items.join('\n\n') : '  (none)';

  return `${persona.trim()}

## Trading Strategy
${strategy}

## Current Holdings (as of ${holdings.lastUpdated})

### Stocks — Owned
${section(ownedStocks.map(fmtOwnedStock))}

### Stocks — Watching
${section(watchedStocks.map(fmtWatchedStock))}

### Options — Owned
${section(ownedOptions.map(fmtOwnedOption))}

### Options — Watching
${section(watchedOptions.map(fmtWatchedOption))}

## Instructions
- Provide thoughtful, data-driven advice based on the user's strategy and current positions
- Reference specific holdings and prices when relevant
- Be concise but thorough
- When suggesting changes to holdings or strategy, include a FILE_UPDATE block at the end of your response in EXACTLY this format:

<<<FILE_UPDATE>>>
{"file": "holdings", "content": { ...full new holdings object... }}
<<<END_FILE_UPDATE>>>

Or for strategy:

<<<FILE_UPDATE>>>
{"file": "strategy", "content": "...full new strategy markdown..."}
<<<END_FILE_UPDATE>>>

IMPORTANT for holdings updates: preserve the exact schema format (stocks as an object keyed by ticker, options as an object keyed by a string ID, snake_case field names). Only include ONE FILE_UPDATE block per response.`;
}

// ── Tool executor ─────────────────────────────────────────────────────

function makeToolExecutor(priceMap: Map<string, StockQuote>): ToolExecutor {
  return async (name, input) => {
    if (name !== 'get_option_chain') return `Unknown tool: ${name}`;

    const ticker = String(input.ticker ?? '').toUpperCase();
    if (!ticker) return 'Error: ticker is required';

    const type       = String(input.type ?? 'both') as 'calls' | 'puts' | 'both';
    const dteMin     = Number(input.dte_min     ?? 20);
    const dteMax     = Number(input.dte_max     ?? 90);
    const otmOnly    = input.otm_only !== false;
    const maxResults = Math.min(Number(input.max_results ?? 25), 50);

    const underlyingPrice = priceMap.get(ticker)?.price;

    try {
      const contracts = await getFilteredChain(ticker, {
        type, dteMin, dteMax, otmOnly, maxResults, underlyingPrice,
      });

      if (contracts.length === 0) {
        return `No ${ticker} options matched (${type}, DTE ${dteMin}–${dteMax}, OTM: ${otmOnly}). Try widening filters or check the ticker.`;
      }

      const p = (s: string, n: number) => s.padStart(n);
      const header = [
        `${ticker} options  |  underlying: $${underlyingPrice?.toFixed(2) ?? 'N/A'}`,
        `Filters: ${type}, DTE ${dteMin}–${dteMax} days, OTM only: ${otmOnly}  |  ${contracts.length} contracts`,
        '',
        `${'Expiry'.padEnd(12)} ${'DTE'.padStart(3)}  ${'Type'.padEnd(4)}  ${'Strike'.padStart(7)}  ${'Bid'.padStart(6)}  ${'Ask'.padStart(6)}  ${'Mid'.padStart(6)}  ${'IV%'.padStart(5)}  ${'Delta'.padStart(6)}  ${'Vol'.padStart(7)}  ${'OI'.padStart(7)}`,
        '─'.repeat(90),
      ].join('\n');

      const rows = contracts.map(c =>
        `${c.expiry.padEnd(12)} ${p(String(c.dte), 3)}  ${c.type.toUpperCase().padEnd(4)}  ${p('$' + c.strike, 7)}` +
        `  ${p('$' + c.bid.toFixed(2), 6)}  ${p('$' + c.ask.toFixed(2), 6)}  ${p('$' + c.mid.toFixed(2), 6)}` +
        `  ${p((c.iv * 100).toFixed(1) + '%', 5)}  ${p(c.delta.toFixed(3), 6)}` +
        `  ${p((c.volume ?? 0).toLocaleString(), 7)}  ${p((c.openInterest ?? 0).toLocaleString(), 7)}`
      );

      return `${header}\n${rows.join('\n')}`;
    } catch (err) {
      return `Error fetching ${ticker} options: ${err instanceof Error ? err.message : String(err)}`;
    }
  };
}

// GET /api/chat/context — returns exactly what the AI would receive
chatRouter.get('/context', async (_req, res) => {
  try {
    const [personaRaw, strategyRaw, holdingsRaw] = await Promise.all([
      readFile(SYSTEM_PROMPT_PATH, 'utf-8').catch(() => 'You are a knowledgeable stock trading assistant helping manage a personal investment portfolio.'),
      readFile(STRATEGY_PATH, 'utf-8'),
      readFile(HOLDINGS_PATH, 'utf-8'),
    ]);

    const holdings: Holdings = JSON.parse(holdingsRaw);
    const prices = await getAllPrices(holdings);
    const systemPrompt = buildSystemPrompt(personaRaw, strategyRaw, holdings, prices);

    res.json({ systemPrompt, prices, holdings });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

chatRouter.post('/', async (req, res) => {
  try {
    const { messages, provider = process.env.AI_PROVIDER ?? 'anthropic' } = req.body as {
      messages: ChatMessage[];
      provider?: AIProvider;
    };

    if (!messages || !Array.isArray(messages)) {
      res.status(400).json({ error: 'messages array required' });
      return;
    }

    const [personaRaw, strategyRaw, holdingsRaw] = await Promise.all([
      readFile(SYSTEM_PROMPT_PATH, 'utf-8').catch(() => 'You are a knowledgeable stock trading assistant helping manage a personal investment portfolio.'),
      readFile(STRATEGY_PATH, 'utf-8'),
      readFile(HOLDINGS_PATH, 'utf-8'),
    ]);

    const holdings: Holdings = JSON.parse(holdingsRaw);
    const prices = await getAllPrices(holdings);
    const priceMap = new Map(prices.stocks.map(s => [s.ticker, s]));
    const systemPrompt = buildSystemPrompt(personaRaw, strategyRaw, holdings, prices);
    const toolExecutor = makeToolExecutor(priceMap);

    await streamChat(messages, systemPrompt, provider, res, toolExecutor);
  } catch (err) {
    console.error('Chat error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Chat failed' });
    }
  }
});
