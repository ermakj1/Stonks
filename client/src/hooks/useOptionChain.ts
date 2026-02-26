import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { OptionChainResponse, OptionContract } from '../types';
import { bsDelta } from '../utils/blackScholes';

export type ExpiryFreq = 'daily' | 'weekly' | 'monthly';

/**
 * Classify an expiry timestamp.
 * Monthly  = 3rd Friday of the month (date 15–21, Friday)
 * Weekly   = any other Friday
 * Daily    = Mon–Thu (0-DTE or near-term dailies)
 */
export function getExpiryType(ts: number): ExpiryFreq {
  const d = new Date(ts * 1000);
  const dow  = d.getUTCDay();   // 0=Sun … 5=Fri … 6=Sat
  if (dow !== 5) return 'daily';
  const date = d.getUTCDate();
  if (date >= 15 && date <= 21) return 'monthly';
  return 'weekly';
}

export interface OptionFilters {
  strikeMin:        string;
  strikeMax:        string;
  deltaMin:         string;
  deltaMax:         string;
  dteMin:           number;           // default 7
  dteMax:           number;           // 0 = no max
  selectedExpiries: number[];
  expiryFreq:       ExpiryFreq[];     // which frequency types to show
}

export interface ExpiryGroup {
  expiry: number;
  calls:  OptionContract[];
  puts:   OptionContract[];
}

export interface UseOptionChainResult {
  loading:         boolean;
  loadingExpiries: Set<number>;
  error:           string | null;
  expiryDates:     number[];
  groups:          ExpiryGroup[];
  filters:         OptionFilters;
  setFilters:      React.Dispatch<React.SetStateAction<OptionFilters>>;
  toggleExpiry:    (ts: number) => void;
  underlyingPrice: number;
}

const ALL_FREQS: ExpiryFreq[] = ['daily', 'weekly', 'monthly'];

const DEFAULT_FILTERS: OptionFilters = {
  strikeMin:        '',
  strikeMax:        '',
  deltaMin:         '',
  deltaMax:         '',
  dteMin:           7,
  dteMax:           90,
  selectedExpiries: [],
  expiryFreq:       ALL_FREQS,
};

type CachedExpiry = { calls: OptionContract[]; puts: OptionContract[] };

export function useOptionChain(ticker: string | null): UseOptionChainResult {
  const [allExpiries, setAllExpiries]         = useState<number[]>([]);
  const [underlyingPrice, setUnderlyingPrice] = useState(0);
  const [loading, setLoading]                 = useState(false);
  const [loadingExpiries, setLoadingExpiries] = useState<Set<number>>(new Set());
  const [error, setError]                     = useState<string | null>(null);
  const [filters, setFilters]                 = useState<OptionFilters>(DEFAULT_FILTERS);

  const cacheRef  = useRef<Map<number, CachedExpiry>>(new Map());
  const [cacheTick, setCacheTick] = useState(0);

  // ── per-expiry fetch ──────────────────────────────────────────────
  const fetchExpiry = useCallback(async (ts: number) => {
    if (!ticker || cacheRef.current.has(ts)) return;
    setLoadingExpiries(s => new Set([...s, ts]));
    try {
      const res = await fetch(`/api/options/${ticker}?date=${ts}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const data: OptionChainResponse = await res.json();
      cacheRef.current.set(ts, { calls: data.calls, puts: data.puts });
      setCacheTick(v => v + 1);
    } catch (e) {
      console.error('Failed to fetch expiry', ts, e);
    } finally {
      setLoadingExpiries(s => { const n = new Set(s); n.delete(ts); return n; });
    }
  }, [ticker]);

  // ── toggle expiry selection ───────────────────────────────────────
  const toggleExpiry = useCallback((ts: number) => {
    setFilters(f => {
      const sel = f.selectedExpiries;
      if (sel.includes(ts)) {
        if (sel.length === 1) return f;
        return { ...f, selectedExpiries: sel.filter(e => e !== ts) };
      }
      fetchExpiry(ts);
      return { ...f, selectedExpiries: [...sel, ts].sort((a, b) => a - b) };
    });
  }, [fetchExpiry]);

  // ── initial load ──────────────────────────────────────────────────
  useEffect(() => {
    if (!ticker) return;
    cacheRef.current = new Map();
    setAllExpiries([]);
    setUnderlyingPrice(0);
    setError(null);
    setFilters(DEFAULT_FILTERS);
    setCacheTick(0);
    setLoading(true);

    fetch(`/api/options/${ticker}`)
      .then(async res => {
        if (!res.ok) {
          const body = await res.json().catch(() => null) as { error?: string } | null;
          throw new Error(body?.error ?? `HTTP ${res.status}`);
        }
        return res.json() as Promise<OptionChainResponse>;
      })
      .then(data => {
        setUnderlyingPrice(data.underlyingPrice);
        setAllExpiries(data.expirationDates);

        const S = data.underlyingPrice;
        const now = Date.now() / 1000;

        // Pick the first expiry that passes the default DTE min filter
        const firstExpiry = data.expirationDates.find(ts =>
          (ts - now) / 86400 >= DEFAULT_FILTERS.dteMin
        ) ?? data.expirationDates[0] ?? null;

        if (firstExpiry) {
          cacheRef.current.set(firstExpiry, { calls: data.calls, puts: data.puts });
          setCacheTick(v => v + 1);
          setFilters(f => ({
            ...f,
            selectedExpiries: [firstExpiry],
            strikeMin: S > 0 ? String(Math.floor(S))       : f.strikeMin,
            strikeMax: S > 0 ? String(Math.ceil(S * 1.15)) : f.strikeMax,
          }));
        }
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Unknown error'))
      .finally(() => setLoading(false));
  }, [ticker]);

  // ── derived: expiry dates filtered by DTE + frequency ────────────
  const expiryDates = useMemo(() => {
    const now = Date.now() / 1000;
    return allExpiries.filter(ts => {
      const d = (ts - now) / 86400;
      if (d < filters.dteMin) return false;
      if (filters.dteMax > 0 && d > filters.dteMax) return false;
      if (!filters.expiryFreq.includes(getExpiryType(ts))) return false;
      return true;
    });
  }, [allExpiries, filters.dteMin, filters.dteMax, filters.expiryFreq]);

  // Auto-deselect expiries that fall outside the current filter
  useEffect(() => {
    const valid = new Set(expiryDates);
    setFilters(f => {
      const kept = f.selectedExpiries.filter(ts => valid.has(ts));
      if (kept.length === f.selectedExpiries.length) return f;
      const result = kept.length > 0 ? kept : (expiryDates.length > 0 ? [expiryDates[0]] : []);
      return { ...f, selectedExpiries: result };
    });
  }, [expiryDates]);

  // ── annotate + filter contracts ───────────────────────────────────
  function annotate(contracts: OptionContract[], isCall: boolean, S: number): OptionContract[] {
    const sMin = filters.strikeMin !== '' ? parseFloat(filters.strikeMin) : -Infinity;
    const sMax = filters.strikeMax !== '' ? parseFloat(filters.strikeMax) : Infinity;
    const dMin = filters.deltaMin  !== '' ? parseFloat(filters.deltaMin)  : -Infinity;
    const dMax = filters.deltaMax  !== '' ? parseFloat(filters.deltaMax)  : Infinity;

    return contracts
      .map(c => {
        const daysLeft = c.expiration
          ? Math.max(0, (c.expiration - Date.now() / 1000) / 86400)
          : 0;
        const delta = bsDelta(S, c.strike, daysLeft / 365, c.impliedVolatility ?? 0, isCall);
        return { ...c, delta, midpoint: ((c.bid ?? 0) + (c.ask ?? 0)) / 2 };
      })
      .filter(c => {
        if (c.strike < sMin || c.strike > sMax) return false;
        const d = c.delta ?? 0;
        if (d < dMin || d > dMax) return false;
        return true;
      });
  }

  // ── build groups ──────────────────────────────────────────────────
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const groups = useMemo<ExpiryGroup[]>(() => {
    const S = underlyingPrice;
    return filters.selectedExpiries
      .filter(ts => cacheRef.current.has(ts))
      .map(ts => ({
        expiry: ts,
        calls:  annotate(cacheRef.current.get(ts)!.calls, true,  S),
        puts:   annotate(cacheRef.current.get(ts)!.puts,  false, S),
      }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, underlyingPrice, cacheTick]);

  return { loading, loadingExpiries, error, expiryDates, groups, filters, setFilters, toggleExpiry, underlyingPrice };
}
