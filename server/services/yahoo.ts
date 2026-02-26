// Direct Yahoo Finance v8 chart API — no crumb/cookie auth needed
import { getOptionMid } from './cboe.js';

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

export async function getStockQuotes(tickers: string[]): Promise<StockQuote[]> {
  // Stagger requests slightly to be polite
  const results: StockQuote[] = [];
  for (const ticker of tickers) {
    results.push(await fetchQuote(ticker));
    if (tickers.length > 1) await new Promise((r) => setTimeout(r, 200));
  }
  return results;
}

export async function getAllPrices(holdings: {
  stocks: Record<string, unknown>;
  options: Record<string, { ticker: string; strike: number; expiration: string; type: string; contracts?: number }>;
}): Promise<{ stocks: StockQuote[]; options: OptionsData[] }> {
  const stockTickers = Object.keys(holdings.stocks);
  const optionEntries = Object.entries(holdings.options);
  const optionTickers = [...new Set(optionEntries.map(([, o]) => o.ticker))];
  const allTickers = [...new Set([...stockTickers, ...optionTickers])];

  const allQuotes = await getStockQuotes(allTickers);
  const stocks = allQuotes.filter((s) => stockTickers.includes(s.ticker));

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
      // Only fetch live market prices for owned options (contracts > 0)
      if (o.contracts && o.contracts > 0) {
        const mid = await getOptionMid(o.ticker, o.type, o.strike, o.expiration);
        if (mid) {
          base.bid  = mid.bid;
          base.ask  = mid.ask;
          base.mid  = mid.mid;
          base.last = mid.last;
          base.iv   = mid.iv;
        }
      }
      return base;
    })
  );

  return { stocks, options };
}
