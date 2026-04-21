// Direct Yahoo Finance v8 chart API — no crumb/cookie auth needed
import { getOptionMid, fetchChain, calcIV30, type RawOption } from './cboe.js';

const YF_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Accept': 'application/json',
};

export interface StockQuote {
  ticker: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  marketCap?: number;
  dividendRate?: number;   // annual $ per share
  dividendYield?: number;  // decimal, e.g. 0.007 = 0.7%
  exDividendDate?: string; // YYYY-MM-DD
}

export interface OptionsData {
  key: string;
  ticker: string;
  strike: number;
  expiration: string;
  type: 'call' | 'put';
  daysToExpiration: number;
  bid?: number;
  ask?: number;
  mid?: number;
  last?: number;
  iv?: number;
}

async function fetchQuote(ticker: string): Promise<StockQuote> {
  try {
    const url = `${YF_BASE}/${ticker}?interval=1d&range=1d`;
    const res = await fetch(url, { headers: HEADERS });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json() as {
      chart: {
        result: Array<{
          meta: {
            regularMarketPrice: number;
            chartPreviousClose: number;
            regularMarketVolume: number;
            marketCap?: number;
          };
        }> | null;
        error: unknown;
      };
    };

    const meta = json?.chart?.result?.[0]?.meta;
    if (!meta) throw new Error('No result');

    const price = meta.regularMarketPrice ?? 0;
    const prevClose = meta.chartPreviousClose ?? price;
    const change = price - prevClose;
    const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;

    return {
      ticker,
      price,
      change,
      changePercent,
      volume: meta.regularMarketVolume ?? 0,
      marketCap: meta.marketCap,
    };
  } catch (err) {
    console.warn(`Failed to fetch quote for ${ticker}:`, err instanceof Error ? err.message : err);
    return { ticker, price: 0, change: 0, changePercent: 0, volume: 0 };
  }
}

function calcDTE(expiration: string): number {
  const expDate = new Date(expiration);
  const today = new Date();
  return Math.max(0, Math.round((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));
}

// ── HV30 ─────────────────────────────────────────────────────────────

const hvCache = new Map<string, { ts: number; hv30: number }>();
const HV_TTL = 60 * 60 * 1000; // 1 hour

async function fetchHV30(ticker: string): Promise<number | null> {
  const hit = hvCache.get(ticker);
  if (hit && Date.now() - hit.ts < HV_TTL) return hit.hv30;

  try {
    const url = `${YF_BASE}/${ticker}?interval=1d&range=3mo`;
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json() as {
      chart: {
        result: Array<{
          indicators: { quote: Array<{ close: (number | null)[] }> };
        }> | null;
      };
    };

    const rawCloses = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    const closes = rawCloses.filter((c): c is number => c != null && c > 0);
    if (closes.length < 32) return null;

    // Take last 31 closes → 30 log returns
    const window = closes.slice(-31);
    const logReturns = window.slice(1).map((c, i) => Math.log(c / window[i]));
    const mean = logReturns.reduce((s, v) => s + v, 0) / logReturns.length;
    const variance = logReturns.reduce((s, v) => s + (v - mean) ** 2, 0) / (logReturns.length - 1);
    const hv30 = Math.sqrt(variance) * Math.sqrt(252);

    hvCache.set(ticker, { ts: Date.now(), hv30 });
    return hv30;
  } catch (err) {
    console.warn(`Failed to fetch HV30 for ${ticker}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

// ── Dividend data ─────────────────────────────────────────────────────

const divCache = new Map<string, { ts: number; rate: number; yield: number; exDivDate?: string }>();
const DIV_TTL = 24 * 60 * 60 * 1000; // 24 hours

async function fetchDividendData(ticker: string): Promise<{ rate: number; yield: number; exDivDate?: string }> {
  const hit = divCache.get(ticker);
  if (hit && Date.now() - hit.ts < DIV_TTL) return hit;

  try {
    const url = `${YF_BASE}/${ticker}?interval=1d&range=1y&events=dividends`;
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return { rate: 0, yield: 0 };

    const json = await res.json() as {
      chart: {
        result: Array<{
          meta: { regularMarketPrice: number };
          events?: { dividends?: Record<string, { amount: number; date: number }> };
        }> | null;
      };
    };

    const result = json?.chart?.result?.[0];
    if (!result) return { rate: 0, yield: 0 };

    const price = result.meta.regularMarketPrice ?? 0;
    const allDivs = Object.values(result.events?.dividends ?? {});
    const oneYearAgo = Date.now() / 1000 - 365 * 24 * 60 * 60;
    const recent = allDivs.filter(d => d.date >= oneYearAgo);
    const annualRate = recent.reduce((s, d) => s + d.amount, 0);

    // Most recent ex-div date for display
    const lastDiv = allDivs.sort((a, b) => b.date - a.date)[0];
    const exDivDate = lastDiv
      ? new Date(lastDiv.date * 1000).toISOString().split('T')[0]
      : undefined;

    const data = {
      ts: Date.now(),
      rate: annualRate,
      yield: price > 0 ? annualRate / price : 0,
      exDivDate,
    };
    divCache.set(ticker, data);
    return data;
  } catch {
    return { rate: 0, yield: 0 };
  }
}

export async function getStockQuotes(tickers: string[]): Promise<StockQuote[]> {
  const results: StockQuote[] = [];
  for (const ticker of tickers) {
    results.push(await fetchQuote(ticker));
    if (tickers.length > 1) await new Promise((r) => setTimeout(r, 200));
  }

  // Enrich with dividend data in parallel (cached, won't slow price display)
  await Promise.all(results.map(async (q) => {
    const div = await fetchDividendData(q.ticker);
    if (div.rate > 0) {
      q.dividendRate = div.rate;
      q.dividendYield = div.yield;
      q.exDividendDate = div.exDivDate;
    }
  }));

  return results;
}

export interface VolatilityData {
  iv30: number | null;
  hv30: number | null;
}

export async function getAllPrices(holdings: {
  stocks: Record<string, unknown>;
  options: Record<string, { ticker: string; strike: number; expiration: string; type: string; contracts?: number }>;
}): Promise<{ stocks: StockQuote[]; options: OptionsData[]; volatility: Record<string, VolatilityData> }> {
  const SPECIAL_KEYS = new Set(['$CASH', '$OTHER']);
  const stockTickers = Object.keys(holdings.stocks).filter(t => !SPECIAL_KEYS.has(t));
  const optionEntries = Object.entries(holdings.options);
  const optionTickers = [...new Set(optionEntries.map(([, o]) => o.ticker))];
  const allTickers = [...new Set([...stockTickers, ...optionTickers])];

  const allQuotes = await getStockQuotes(allTickers);
  const stocks = allQuotes.filter((s) => stockTickers.includes(s.ticker));
  const quoteMap = new Map(allQuotes.map(q => [q.ticker, q]));

  const options: OptionsData[] = await Promise.all(
    optionEntries.map(async ([key, o]) => {
      const base: OptionsData = {
        key,
        ticker: o.ticker,
        strike: o.strike,
        expiration: o.expiration,
        type: o.type.toLowerCase() as 'call' | 'put',
        daysToExpiration: calcDTE(o.expiration),
      };
      const mid = await getOptionMid(o.ticker, o.type, o.strike, o.expiration);
      if (mid) {
        base.bid  = mid.bid;
        base.ask  = mid.ask;
        base.mid  = mid.mid;
        base.last = mid.last;
        base.iv   = mid.iv;
      }
      return base;
    })
  );

  // Compute IV30 and HV30 for all unique option tickers
  const volatility: Record<string, VolatilityData> = {};
  await Promise.all(optionTickers.map(async (ticker) => {
    const underlyingPrice = quoteMap.get(ticker)?.price;
    const [chain, hv30] = await Promise.all([
      fetchChain(ticker).catch((): RawOption[] => []),
      fetchHV30(ticker),
    ]);
    const iv30 = underlyingPrice != null && chain.length > 0
      ? calcIV30(chain, underlyingPrice)
      : null;
    volatility[ticker] = { iv30, hv30 };
  }));

  return { stocks, options, volatility };
}
