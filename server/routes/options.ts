import { Router } from 'express';

export const optionsRouter = Router();

// CBOE delayed quotes CDN — free, no auth, ~15 min delay, full Greeks
const CBOE_BASE = 'https://cdn.cboe.com/api/global/delayed_quotes/options';

// Cache full chain per ticker for 5 minutes (one call covers all expiries)
const cache = new Map<string, { ts: number; data: CBOEResponse }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function getCached(ticker: string): CBOEResponse | null {
  const entry = cache.get(ticker);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) { cache.delete(ticker); return null; }
  return entry.data;
}

interface CBOEOption {
  option:            string;  // OCC symbol e.g. "AAPL260321C00100000"
  bid:               number;
  ask:               number;
  iv:                number;  // decimal fraction (0.35 = 35%)
  open_interest:     number;
  volume:            number;
  delta:             number;
  last_trade_price:  number;
  prev_day_close:    number;
}

interface CBOEResponse {
  data: {
    options: CBOEOption[];
    close?:  number;   // underlying close price
    bid?:    number;
    ask?:    number;
  };
}

// Parse OCC symbol: "AAPL260321C00100000" → { expiry: "2026-03-21", type: "call", strike: 100 }
function parseOCC(symbol: string) {
  const m = symbol.match(/^([A-Z]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/);
  if (!m) return null;
  const [, , yy, mm, dd, cp, strikeStr] = m;
  return {
    expiry:  `20${yy}-${mm}-${dd}`,
    type:    cp === 'C' ? 'call' : 'put',
    strike:  parseInt(strikeStr) / 1000,
  };
}

// Convert YYYY-MM-DD to unix timestamp (noon UTC)
function toUnix(isoDate: string) {
  return Math.floor(new Date(isoDate + 'T12:00:00Z').getTime() / 1000);
}
function toIsoDate(unixTs: number) {
  return new Date(unixTs * 1000).toISOString().split('T')[0];
}

// GET /api/options/:ticker?date=<unixTimestamp>
optionsRouter.get('/:ticker', async (req, res) => {
  const { ticker } = req.params;
  const { date } = req.query as { date?: string };

  try {
    // 1. Get underlying price from Yahoo Finance chart API
    const chartRes = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`,
      { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } }
    );
    const chartJson = await chartRes.json() as {
      chart?: { result?: Array<{ meta?: { regularMarketPrice?: number } }> };
    };
    const underlyingPrice = chartJson?.chart?.result?.[0]?.meta?.regularMarketPrice ?? 0;

    // 2. Fetch full option chain from CBOE (cached per ticker)
    let cboe = getCached(ticker);
    if (!cboe) {
      const r = await fetch(`${CBOE_BASE}/${ticker}.json`, {
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      });
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        throw new Error(`CBOE HTTP ${r.status}${txt ? ': ' + txt.slice(0, 200) : ''}`);
      }
      cboe = await r.json() as CBOEResponse;
      cache.set(ticker, { ts: Date.now(), data: cboe });
    }

    const allOptions = cboe.data.options ?? [];

    // 3. Collect unique sorted expiry dates
    const expirySet = new Set<string>();
    for (const opt of allOptions) {
      const parsed = parseOCC(opt.option);
      if (parsed) expirySet.add(parsed.expiry);
    }
    const allExpiries = [...expirySet].sort();
    const expirationDates = allExpiries.map(toUnix);

    // 4. Filter to requested (or first) expiry
    const targetDate = date ? toIsoDate(parseInt(date)) : (allExpiries[0] ?? null);

    const calls: object[] = [];
    const puts:  object[] = [];

    if (targetDate) {
      const S = underlyingPrice;
      for (const opt of allOptions) {
        const parsed = parseOCC(opt.option);
        if (!parsed || parsed.expiry !== targetDate) continue;

        const isCall = parsed.type === 'call';
        const isItm  = isCall ? S > parsed.strike : S < parsed.strike;

        const contract = {
          contractSymbol:    opt.option,
          strike:            parsed.strike,
          expiration:        toUnix(parsed.expiry),
          bid:               opt.bid              ?? 0,
          ask:               opt.ask              ?? 0,
          lastPrice:         opt.last_trade_price ?? opt.prev_day_close ?? 0,
          volume:            opt.volume           ?? 0,
          openInterest:      opt.open_interest    ?? 0,
          impliedVolatility: opt.iv               ?? 0,
          inTheMoney:        isItm,
          delta:             opt.delta            ?? undefined,
        };

        if (isCall) calls.push(contract);
        else puts.push(contract);
      }

      calls.sort((a: any, b: any) => a.strike - b.strike);
      puts.sort((a:  any, b: any) => a.strike - b.strike);
    }

    res.json({ underlyingPrice, expirationDates, calls, puts });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Options error for ${ticker}:`, msg);
    res.status(500).json({ error: msg });
  }
});
