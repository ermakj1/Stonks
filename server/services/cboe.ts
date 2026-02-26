// Shared CBOE CDN service — 5-minute cache per ticker
const CBOE_BASE = 'https://cdn.cboe.com/api/global/delayed_quotes/options';

const cache = new Map<string, { ts: number; options: RawOption[] }>();
const TTL_MS = 5 * 60 * 1000;

export interface RawOption {
  option:           string;   // OCC symbol e.g. "AAPL260321C00100000"
  bid:              number;
  ask:              number;
  iv:               number;
  open_interest:    number;
  volume:           number;
  delta:            number;
  last_trade_price: number;
  prev_day_close:   number;
}

export interface OptionMid {
  bid:  number;
  ask:  number;
  mid:  number;
  last: number;
  iv:   number;
}

function parseOCC(symbol: string) {
  const m = symbol.match(/^([A-Z]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/);
  if (!m) return null;
  const [,, yy, mm, dd, cp, strikeStr] = m;
  return {
    expiry: `20${yy}-${mm}-${dd}`,
    type:   cp === 'C' ? 'call' : 'put',
    strike: parseInt(strikeStr) / 1000,
  };
}

export async function fetchChain(ticker: string): Promise<RawOption[]> {
  const hit = cache.get(ticker);
  if (hit && Date.now() - hit.ts < TTL_MS) return hit.options;

  const r = await fetch(`${CBOE_BASE}/${ticker}.json`, {
    headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
  });
  if (!r.ok) throw new Error(`CBOE HTTP ${r.status}`);
  const data = await r.json() as { data: { options: RawOption[] } };
  const options = data.data.options ?? [];
  cache.set(ticker, { ts: Date.now(), options });
  return options;
}

/**
 * Look up current bid/ask/mid for a single option contract.
 * Returns null if not found or if the fetch fails.
 */
export async function getOptionMid(
  ticker: string,
  type: string,
  strike: number,
  expiry: string   // YYYY-MM-DD
): Promise<OptionMid | null> {
  try {
    const options = await fetchChain(ticker);
    const norm = type.toLowerCase();
    const match = options.find(o => {
      const p = parseOCC(o.option);
      return p && p.expiry === expiry && p.type === norm && Math.abs(p.strike - strike) < 0.005;
    });
    if (!match) return null;
    const bid  = match.bid              ?? 0;
    const ask  = match.ask              ?? 0;
    const last = match.last_trade_price ?? match.prev_day_close ?? 0;
    return { bid, ask, mid: (bid + ask) / 2, last, iv: match.iv ?? 0 };
  } catch {
    return null;
  }
}

export { parseOCC };
