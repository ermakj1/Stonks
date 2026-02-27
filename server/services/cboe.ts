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

// ── IV30 calculation ──────────────────────────────────────────────────

/**
 * Compute a 30-DTE implied volatility estimate by:
 * 1. For each expiry, find the ATM call and put (closest strike to underlying).
 * 2. Average their IVs to get that expiry's IV.
 * 3. Linearly interpolate the term structure at 30 DTE.
 * Returns a decimal (e.g. 0.32 = 32%), or null if insufficient data.
 */
export function calcIV30(options: RawOption[], underlyingPrice: number): number | null {
  type ExpiryBucket = { dte: number; calls: RawOption[]; puts: RawOption[] };
  const byExpiry = new Map<string, ExpiryBucket>();

  for (const opt of options) {
    const p = parseOCC(opt.option);
    if (!p || opt.iv <= 0) continue;
    if (!byExpiry.has(p.expiry)) {
      const dte = (new Date(p.expiry + 'T12:00:00Z').getTime() - Date.now()) / 86_400_000;
      byExpiry.set(p.expiry, { dte, calls: [], puts: [] });
    }
    const bucket = byExpiry.get(p.expiry)!;
    (p.type === 'call' ? bucket.calls : bucket.puts).push(opt);
  }

  const termStructure: { dte: number; iv: number }[] = [];

  for (const bucket of byExpiry.values()) {
    if (bucket.dte < 5) continue; // skip pin-risk expiries

    const atmOf = (opts: RawOption[]) =>
      opts.reduce<RawOption | null>((best, o) => {
        const p = parseOCC(o.option);
        if (!p || o.iv <= 0) return best;
        if (!best) return o;
        const bp = parseOCC(best.option)!;
        return Math.abs(p.strike - underlyingPrice) < Math.abs(bp.strike - underlyingPrice) ? o : best;
      }, null);

    const ivs = [atmOf(bucket.calls)?.iv, atmOf(bucket.puts)?.iv]
      .filter((v): v is number => v != null && v > 0);
    if (ivs.length === 0) continue;

    termStructure.push({ dte: bucket.dte, iv: ivs.reduce((s, v) => s + v, 0) / ivs.length });
  }

  if (termStructure.length === 0) return null;
  termStructure.sort((a, b) => a.dte - b.dte);

  const TARGET = 30;
  const exact = termStructure.find(t => Math.abs(t.dte - TARGET) < 1);
  if (exact) return exact.iv;

  const below = termStructure.filter(t => t.dte < TARGET);
  const above = termStructure.filter(t => t.dte > TARGET);
  if (below.length === 0) return above[0].iv;
  if (above.length === 0) return below[below.length - 1].iv;

  const t1 = below[below.length - 1];
  const t2 = above[0];
  return t1.iv + ((TARGET - t1.dte) / (t2.dte - t1.dte)) * (t2.iv - t1.iv);
}

// ── Filtered chain for AI tool use ───────────────────────────────────

export interface ChainFilter {
  type?:           'calls' | 'puts' | 'both';
  dteMin?:         number;   // default 20
  dteMax?:         number;   // default 90
  otmOnly?:        boolean;  // default true
  maxResults?:     number;   // default 25, capped at 50
  underlyingPrice?: number;
}

export interface FilteredContract {
  type:         'call' | 'put';
  strike:       number;
  expiry:       string;
  dte:          number;
  bid:          number;
  ask:          number;
  mid:          number;
  iv:           number;
  delta:        number;
  volume:       number;
  openInterest: number;
}

export async function getFilteredChain(
  ticker: string,
  filter: ChainFilter = {}
): Promise<FilteredContract[]> {
  const {
    type        = 'both',
    dteMin      = 20,
    dteMax      = 90,
    otmOnly     = true,
    maxResults  = 25,
    underlyingPrice,
  } = filter;

  const options = await fetchChain(ticker);
  const now     = Date.now() / 1000;
  const results: FilteredContract[] = [];

  for (const opt of options) {
    const parsed = parseOCC(opt.option);
    if (!parsed) continue;

    // Type filter
    if (type === 'calls' && parsed.type !== 'call') continue;
    if (type === 'puts'  && parsed.type !== 'put')  continue;

    // DTE filter
    const expiryTs = new Date(parsed.expiry + 'T12:00:00Z').getTime() / 1000;
    const dte      = (expiryTs - now) / 86400;
    if (dte < dteMin || dte > dteMax) continue;

    // OTM filter
    if (otmOnly && underlyingPrice != null) {
      const isOTM = parsed.type === 'call'
        ? parsed.strike > underlyingPrice
        : parsed.strike < underlyingPrice;
      if (!isOTM) continue;
    }

    // Require non-zero mid (some stale contracts have no market)
    const mid = (opt.bid + opt.ask) / 2;
    if (mid <= 0) continue;

    results.push({
      type:         parsed.type,
      strike:       parsed.strike,
      expiry:       parsed.expiry,
      dte:          Math.round(dte),
      bid:          opt.bid,
      ask:          opt.ask,
      mid,
      iv:           opt.iv           ?? 0,
      delta:        opt.delta        ?? 0,
      volume:       opt.volume       ?? 0,
      openInterest: opt.open_interest ?? 0,
    });
  }

  // Sort: nearest expiry first, then closest strike to underlying
  results.sort((a, b) => {
    if (a.dte !== b.dte) return a.dte - b.dte;
    if (underlyingPrice != null) {
      return Math.abs(a.strike - underlyingPrice) - Math.abs(b.strike - underlyingPrice);
    }
    return a.strike - b.strike;
  });

  return results.slice(0, Math.min(maxResults, 50));
}
