import { Router } from 'express';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { streamChat, type AIProvider, type ChatMessage } from '../services/ai.js';
import { getAllPrices, type StockQuote, type OptionsData } from '../services/yahoo.js';

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
  const optionList = Object.values(holdings.options);

  const stocksText = Object.entries(holdings.stocks).map(([ticker, s]) => {
    const q = priceMap.get(ticker);
    const currentPrice = q?.price ?? 0;
    const pnl = (currentPrice - s.cost_basis) * s.shares;
    const pnlPct = s.cost_basis > 0 ? ((currentPrice - s.cost_basis) / s.cost_basis) * 100 : 0;
    return [
      `  ${ticker}: ${s.shares} shares @ cost basis $${s.cost_basis.toFixed(2)}`,
      `    Current: $${currentPrice.toFixed(2)} (${q?.changePercent?.toFixed(2) ?? 0}% today)`,
      `    P&L: $${pnl.toFixed(2)} (${pnlPct.toFixed(1)}%)`,
      `    Target allocation: ${s.target_allocation_pct}%`,
      `    Notes: ${s.notes}`,
    ].join('\n');
  });

  const optionsText = optionList.map((o, i) => {
    const od = prices.options[i];
    return [
      `  ${o.ticker} ${o.type} $${o.strike} exp ${o.expiration} x${o.contracts} contracts`,
      `    Premium paid: $${o.premium_paid.toFixed(2)}/share`,
      `    Last: $${od?.lastPrice?.toFixed(2) ?? 'N/A'} | Bid/Ask: ${od?.bid?.toFixed(2) ?? 'N/A'}/${od?.ask?.toFixed(2) ?? 'N/A'}`,
      `    IV: ${od?.impliedVolatility ? (od.impliedVolatility * 100).toFixed(1) + '%' : 'N/A'} | DTE: ${od?.daysToExpiration ?? 'N/A'} days`,
      `    Notes: ${o.notes}`,
    ].join('\n');
  });

  return `${persona.trim()}

## Trading Strategy
${strategy}

## Current Holdings (as of ${holdings.lastUpdated})

### Stocks
${stocksText.join('\n\n')}

### Options
${optionsText.length > 0 ? optionsText.join('\n\n') : '  (none)'}

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
    const systemPrompt = buildSystemPrompt(personaRaw, strategyRaw, holdings, prices);

    await streamChat(messages, systemPrompt, provider, res);
  } catch (err) {
    console.error('Chat error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Chat failed' });
    }
  }
});
