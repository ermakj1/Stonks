export type AIProvider = 'anthropic' | 'gemini' | 'none';

export interface StockEntry {
  shares: number;
  cost_basis: number;
  current_price?: number;
  current_change_pct?: number;
  target_allocation_pct: number;
  notes: string;
}

export interface OptionEntry {
  ticker: string;
  type: string; // 'call' | 'put'
  strike: number;
  expiration: string;
  contracts: number;
  premium_paid: number;
  // watchlist fields — only used when contracts === 0
  saved_price?: number;      // option mid-price when added to watchlist
  target_price?: number;     // underlying stock price the user is watching for
  current_last?: number | null;
  bid?: number | null;
  ask?: number | null;
  iv?: number | null;
  dte?: number | null;
  notes: string;
}

export interface Holdings {
  lastUpdated: string;
  stocks: Record<string, StockEntry>;
  options: Record<string, OptionEntry>;
}

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
  lastPrice?: number;
  bid?: number;
  ask?: number;
  mid?: number;
  last?: number;
  iv?: number;
  impliedVolatility?: number;
  daysToExpiration: number;
}

export interface VolatilityData {
  iv30: number | null;
  hv30: number | null;
}

export interface PricesResponse {
  stocks: StockQuote[];
  options: OptionsData[];
  volatility?: Record<string, VolatilityData>;
}

export interface OptionSuggestion {
  ticker: string;
  type: 'call' | 'put';
  strike: number;
  expiration: string; // YYYY-MM-DD
  notes?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  optionSuggestions?: OptionSuggestion[];
}

export interface OptionContract {
  contractSymbol: string;
  strike: number;
  bid: number;
  ask: number;
  lastPrice: number;
  volume: number;
  openInterest: number;
  impliedVolatility: number;
  inTheMoney: boolean;
  expiration: number; // unix timestamp
  // computed client-side
  delta?: number;
  midpoint?: number;
}

export interface OptionChainResponse {
  underlyingPrice: number;
  expirationDates: number[];
  calls: OptionContract[];
  puts: OptionContract[];
}

export interface FileUpdate {
  file: 'holdings' | 'strategy';
  content: Holdings | string;
}
