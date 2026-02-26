import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  ModuleRegistry,
  AllCommunityModule,
  themeBalham,
  type ColDef,
  type CellValueChangedEvent,
} from 'ag-grid-community';
import type { Holdings, PricesResponse, OptionEntry } from '../types';
import { OptionChainModal } from './OptionChainModal';

ModuleRegistry.registerModules([AllCommunityModule]);

const darkTheme = themeBalham.withParams({
  backgroundColor: '#0f172a',
  oddRowBackgroundColor: '#111827',
  headerBackgroundColor: '#1e293b',
  borderColor: '#334155',
  rowBorder: { color: '#1e293b', width: 1 },
  foregroundColor: '#e2e8f0',
  headerTextColor: '#94a3b8',
  rowHoverColor: '#1e3a5f',
  selectedRowBackgroundColor: '#1e3a5f',
  fontSize: 13,
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  cellHorizontalPaddingScale: 0.8,
  rowHeight: 44,
  headerHeight: 34,
  columnBorder: { style: 'solid', color: '#1e293b', width: 1 },
  headerColumnBorder: { style: 'solid', color: '#334155', width: 1 },
});

// ── helpers ──────────────────────────────────────────────────────────

function dollar(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmt2(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function dteFromExpiry(expiry: string): number {
  const ts = new Date(expiry + 'T12:00:00Z').getTime() / 1000;
  return Math.max(0, Math.round((ts - Date.now() / 1000) / 86400));
}

// ── cell renderers ───────────────────────────────────────────────────

type StockCtx = { openOptions: (t: string) => void; deleteStock: (t: string) => void };

function TickerCell(p: { value: string; data: StockRow; context: StockCtx }) {
  if (p.data.isSummary) {
    return <span style={{ fontWeight: 700, color: '#94a3b8', fontSize: 12, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Portfolio Total</span>;
  }
  const btnBase: React.CSSProperties = {
    background: 'none', border: 'none', padding: '2px 4px', cursor: 'pointer',
    borderRadius: 4, lineHeight: 1, display: 'flex', alignItems: 'center',
  };
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={{ fontWeight: 700, color: p.data.shares === 0 ? '#64748b' : '#fff', fontSize: 14 }}>
        {p.value}
        {p.data.shares === 0 && (
          <span style={{ fontSize: 9, fontWeight: 600, marginLeft: 4, color: '#475569', letterSpacing: '0.05em', textTransform: 'uppercase', verticalAlign: 'middle' }}>watch</span>
        )}
      </span>
      {/* option chain icon */}
      <button onClick={e => { e.stopPropagation(); p.context.openOptions(p.value); }} title="View option chain"
        style={{ ...btnBase, color: '#475569' }}
        onMouseEnter={e => (e.currentTarget.style.color = '#38bdf8')}
        onMouseLeave={e => (e.currentTarget.style.color = '#475569')}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" />
        </svg>
      </button>
      {/* delete icon */}
      <button onClick={e => { e.stopPropagation(); p.context.deleteStock(p.value); }} title="Remove stock"
        style={{ ...btnBase, color: '#334155' }}
        onMouseEnter={e => (e.currentTarget.style.color = '#f87171')}
        onMouseLeave={e => (e.currentTarget.style.color = '#334155')}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </span>
  );
}

function PriceCell(p: { value: number }) {
  if (!p.value) return <span style={{ color: '#475569' }}>—</span>;
  return <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>${fmt2(p.value)}</span>;
}
function DayCell(p: { value: number }) {
  if (p.value === 0) return <span style={{ color: '#475569' }}>—</span>;
  const up = p.value >= 0;
  return <span style={{ color: up ? '#34d399' : '#f87171', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{up ? '+' : ''}{p.value.toFixed(2)}%</span>;
}
function GainDollarCell(p: { value: number }) {
  if (p.value === 0) return <span style={{ color: '#475569' }}>—</span>;
  const up = p.value >= 0;
  return <span style={{ color: up ? '#34d399' : '#f87171', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{up ? '+' : ''}{dollar(p.value)}</span>;
}
function GainPctCell(p: { value: number }) {
  if (p.value === 0) return <span style={{ color: '#475569' }}>—</span>;
  const up = p.value >= 0;
  return <span style={{ color: up ? '#34d399' : '#f87171', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{up ? '+' : ''}{p.value.toFixed(1)}%</span>;
}
function AllocPctCell(p: { value: number; data: StockRow; colDef: { headerName?: string } }) {
  if (!p.value && !p.data.isSummary) return <span style={{ color: '#475569' }}>—</span>;
  const isActual = p.colDef.headerName === 'Actual %';
  return <span style={{ fontVariantNumeric: 'tabular-nums', color: isActual ? '#e2e8f0' : '#94a3b8' }}>{p.value.toFixed(1)}%</span>;
}
function OptionTypeCell(p: { value: string }) {
  const isCall = p.value?.toLowerCase() === 'call';
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
      background: isCall ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
      color: isCall ? '#34d399' : '#f87171' }}>
      {p.value?.toUpperCase()}
    </span>
  );
}

// Saved vs target mid comparison for watched options
function TargetMidCell(p: { value: number; data: WatchedOptionRow }) {
  const { savedPrice } = p.data;
  if (!p.value) return <span style={{ color: '#475569' }}>—</span>;
  const diff = p.value - savedPrice;
  const color = diff < 0 ? '#34d399' : diff > 0 ? '#f87171' : '#94a3b8';
  const sign = diff >= 0 ? '+' : '';
  return (
    <span style={{ fontVariantNumeric: 'tabular-nums' }}>
      ${fmt2(p.value)}
      {savedPrice > 0 && diff !== 0 && (
        <span style={{ color, fontSize: 11, marginLeft: 4 }}>({sign}{fmt2(diff)})</span>
      )}
    </span>
  );
}

function OptMidCell(p: { value: number | null }) {
  if (p.value == null) return <span style={{ color: '#475569' }}>—</span>;
  return <span style={{ fontVariantNumeric: 'tabular-nums' }}>${fmt2(p.value)}</span>;
}
function OptGainDollarCell(p: { value: number | null }) {
  if (p.value == null) return <span style={{ color: '#475569' }}>—</span>;
  const up = p.value >= 0;
  return <span style={{ color: up ? '#34d399' : '#f87171', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{up ? '+' : ''}{dollar(p.value)}</span>;
}
function OptGainPctCell(p: { value: number | null }) {
  if (p.value == null) return <span style={{ color: '#475569' }}>—</span>;
  const up = p.value >= 0;
  return <span style={{ color: up ? '#34d399' : '#f87171', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{up ? '+' : ''}{p.value.toFixed(1)}%</span>;
}

// Delete button cell for option rows
type OptCtx = { deleteOption: (key: string) => void };
function DeleteOptionCell(p: { data: OwnedOptionRow | WatchedOptionRow; context: OptCtx }) {
  return (
    <button
      onClick={e => { e.stopPropagation(); p.context.deleteOption(p.data.key); }}
      title="Remove"
      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#334155', padding: '2px 6px', display: 'flex', alignItems: 'center' }}
      onMouseEnter={e => (e.currentTarget.style.color = '#f87171')}
      onMouseLeave={e => (e.currentTarget.style.color = '#334155')}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  );
}

// ── row interfaces ────────────────────────────────────────────────────

interface StockRow {
  ticker: string; shares: number; costBasis: number; price: number;
  dayChangePct: number; marketValue: number; gainDollar: number; gainPct: number;
  actualPct: number; targetPct: number; notes: string; isSummary?: boolean;
}
interface OwnedOptionRow {
  key: string; ticker: string; type: string; strike: number; expiration: string;
  contracts: number; premiumPaid: number; daysToExpiration: number; notes: string;
  currentMid: number | null;
  gainDollar: number | null;
  gainPct: number | null;
}
interface WatchedOptionRow {
  key: string; ticker: string; type: string; strike: number; expiration: string;
  daysToExpiration: number; savedPrice: number; targetOptionMid: number;
  underlyingPrice: number; notes: string;
}

// ── Add Stock modal ───────────────────────────────────────────────────

interface AddStockModalProps {
  existingTickers: string[];
  onAdd: (ticker: string, shares: number, costBasis: number, targetPct: number, notes: string) => Promise<void>;
  onClose: () => void;
}

function AddStockModal({ existingTickers, onAdd, onClose }: AddStockModalProps) {
  const [ticker, setTicker] = useState('');
  const [shares, setShares] = useState('0');
  const [costBasis, setCostBasis] = useState('0');
  const [targetPct, setTargetPct] = useState('0');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const tickerRef = useRef<HTMLInputElement>(null);

  useEffect(() => { tickerRef.current?.focus(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = ticker.trim().toUpperCase();
    if (!t) { setError('Ticker is required'); return; }
    if (existingTickers.includes(t)) { setError(`${t} is already in your list`); return; }
    setSaving(true);
    try {
      await onAdd(t, Number(shares) || 0, Number(costBasis) || 0, Number(targetPct) || 0, notes.trim());
      onClose();
    } catch { setError('Failed to save'); setSaving(false); }
  };

  const inp: React.CSSProperties = { width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', padding: '6px 10px', fontSize: 13, outline: 'none', boxSizing: 'border-box' };
  const lbl: React.CSSProperties = { fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 4 };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <form onSubmit={handleSubmit} style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 24, width: 340, boxShadow: '0 25px 50px rgba(0,0,0,0.6)' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <span style={{ fontWeight: 700, color: '#e2e8f0', fontSize: 15 }}>Add Stock</span>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={lbl}>Ticker *</label>
            <input ref={tickerRef} style={{ ...inp, textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em' }}
              value={ticker} onChange={e => { setTicker(e.target.value); setError(''); }} placeholder="e.g. AAPL" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={lbl}>Shares</label>
              <input style={inp} type="number" min="0" step="any" value={shares} onChange={e => setShares(e.target.value)} />
              <span style={{ fontSize: 10, color: '#475569', marginTop: 2, display: 'block' }}>0 = watchlist only</span>
            </div>
            <div>
              <label style={lbl}>Cost / Share</label>
              <input style={inp} type="number" min="0" step="any" value={costBasis} onChange={e => setCostBasis(e.target.value)} />
            </div>
          </div>
          <div>
            <label style={lbl}>Target Allocation %</label>
            <input style={inp} type="number" min="0" max="100" step="any" value={targetPct} onChange={e => setTargetPct(e.target.value)} />
          </div>
          <div>
            <label style={lbl}>Notes</label>
            <input style={inp} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" />
          </div>
        </div>
        {error && <div style={{ marginTop: 12, fontSize: 12, color: '#f87171' }}>{error}</div>}
        <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={{ padding: '7px 16px', borderRadius: 7, border: '1px solid #334155', background: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
          <button type="submit" disabled={saving} style={{ padding: '7px 16px', borderRadius: 7, border: 'none', background: '#059669', color: '#fff', cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: 13, opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Adding…' : 'Add Stock'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── component ────────────────────────────────────────────────────────

interface Props {
  holdings: Holdings | null;
  prices: PricesResponse | null;
  loading: boolean;
  onHoldingsUpdated?: () => void;
}

export function HoldingsPanel({ holdings, prices, loading, onHoldingsUpdated }: Props) {
  const [optionChainTicker, setOptionChainTicker] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  const priceMap = useMemo(() => new Map(prices?.stocks.map(s => [s.ticker, s]) ?? []), [prices]);
  const optionPriceMap = useMemo(() => new Map(prices?.options.map(o => [o.key, o]) ?? []), [prices]);

  // ── stock rows ───────────────────────────────────────────────────
  const baseRows = useMemo<Omit<StockRow, 'actualPct'>[]>(() => {
    if (!holdings) return [];
    return Object.entries(holdings.stocks).map(([ticker, s]) => {
      const q = priceMap.get(ticker);
      const price = q?.price ?? 0;
      const marketValue = price * s.shares;
      const cost = s.cost_basis * s.shares;
      const gainDollar = price > 0 && s.shares > 0 ? marketValue - cost : 0;
      const gainPct = price > 0 && cost > 0 ? (gainDollar / cost) * 100 : 0;
      return { ticker, shares: s.shares, costBasis: s.cost_basis, price, dayChangePct: q?.changePercent ?? 0, marketValue, gainDollar, gainPct, targetPct: s.target_allocation_pct, notes: s.notes };
    });
  }, [holdings, priceMap]);

  const totalValue = baseRows.reduce((s, r) => s + r.marketValue, 0);
  const stockRows = useMemo<StockRow[]>(() => baseRows.map(r => ({ ...r, actualPct: totalValue > 0 ? (r.marketValue / totalValue) * 100 : 0 })), [baseRows, totalValue]);

  const totalCost = stockRows.reduce((s, r) => s + r.costBasis * r.shares, 0);
  const totalGain = totalValue - totalCost;
  const totalGainPct = totalCost > 0 ? (totalGain / totalCost) * 100 : 0;
  const totalDayChange = stockRows.reduce((s, r) => s + (r.price > 0 && r.shares > 0 ? (r.dayChangePct / 100) * r.marketValue : 0), 0);
  const weightedDayChangePct = totalValue > 0 ? (totalDayChange / totalValue) * 100 : 0;

  const summaryRow: StockRow = {
    ticker: '', shares: 0, costBasis: 0, price: 0,
    dayChangePct: weightedDayChangePct, marketValue: totalValue,
    gainDollar: totalGain, gainPct: totalGainPct, actualPct: 100,
    targetPct: stockRows.reduce((s, r) => s + r.targetPct, 0),
    notes: '', isSummary: true,
  };

  // ── option rows ──────────────────────────────────────────────────
  const ownedOptionRows = useMemo<OwnedOptionRow[]>(() => {
    if (!holdings) return [];
    return Object.entries(holdings.options)
      .filter(([, o]) => o.contracts > 0)
      .map(([key, o]) => {
        const priceData = optionPriceMap.get(key);
        const currentMid = priceData?.mid ?? null;
        const totalCost = o.premium_paid * o.contracts * 100;
        const gainDollar = currentMid != null && totalCost > 0
          ? (currentMid - o.premium_paid) * o.contracts * 100
          : null;
        const gainPct = gainDollar != null && totalCost > 0
          ? (gainDollar / totalCost) * 100
          : null;
        return {
          key, ticker: o.ticker, type: o.type, strike: o.strike,
          expiration: o.expiration, contracts: o.contracts, premiumPaid: o.premium_paid,
          daysToExpiration: dteFromExpiry(o.expiration),
          currentMid, gainDollar, gainPct,
          notes: o.notes,
        };
      });
  }, [holdings, optionPriceMap]);

  const watchedOptionRows = useMemo<WatchedOptionRow[]>(() => {
    if (!holdings) return [];
    return Object.entries(holdings.options)
      .filter(([, o]) => o.contracts === 0)
      .map(([key, o]) => ({
        key, ticker: o.ticker, type: o.type, strike: o.strike,
        expiration: o.expiration, daysToExpiration: dteFromExpiry(o.expiration),
        savedPrice: o.saved_price ?? 0,
        targetOptionMid: o.target_price ?? 0,
        underlyingPrice: priceMap.get(o.ticker)?.price ?? 0,
        notes: o.notes,
      }));
  }, [holdings, priceMap]);

  // ── save helpers ─────────────────────────────────────────────────
  const saveHoldings = useCallback(async (updated: Holdings) => {
    await fetch('/api/holdings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) });
    onHoldingsUpdated?.();
  }, [onHoldingsUpdated]);

  const onCellValueChanged = useCallback(async (e: CellValueChangedEvent<StockRow>) => {
    if (!holdings || e.data.isSummary) return;
    const { ticker, shares, costBasis, targetPct, notes } = e.data;
    const updated: Holdings = { ...holdings, stocks: { ...holdings.stocks, [ticker]: { ...holdings.stocks[ticker], shares: Number(shares), cost_basis: Number(costBasis), target_allocation_pct: Number(targetPct), notes: String(notes ?? '') } } };
    try { await saveHoldings(updated); } catch (err) { console.error('Failed to save:', err); }
  }, [holdings, saveHoldings]);

  const handleAddStock = useCallback(async (ticker: string, shares: number, costBasis: number, targetPct: number, notes: string) => {
    if (!holdings) return;
    await saveHoldings({ ...holdings, stocks: { ...holdings.stocks, [ticker]: { shares, cost_basis: costBasis, target_allocation_pct: targetPct, notes } } });
  }, [holdings, saveHoldings]);

  const handleDeleteStock = useCallback(async (ticker: string) => {
    if (!holdings) return;
    const stocks = Object.fromEntries(Object.entries(holdings.stocks).filter(([k]) => k !== ticker));
    await saveHoldings({ ...holdings, stocks });
  }, [holdings, saveHoldings]);

  const handleDeleteOption = useCallback(async (key: string) => {
    if (!holdings) return;
    const options = Object.fromEntries(Object.entries(holdings.options).filter(([k]) => k !== key));
    await saveHoldings({ ...holdings, options });
  }, [holdings, saveHoldings]);

  const handleAddOptionWatch = useCallback(async (key: string, entry: OptionEntry) => {
    if (!holdings) return;
    await saveHoldings({ ...holdings, options: { ...holdings.options, [key]: entry } });
  }, [holdings, saveHoldings]);

  // ── column defs ──────────────────────────────────────────────────
  const defaultColDef = useMemo<ColDef>(() => ({ resizable: true, sortable: true, suppressHeaderMenuButton: true }), []);
  const ec = { cursor: 'text' };

  const stockCols = useMemo<ColDef<StockRow>[]>(() => [
    { field: 'ticker',       headerName: 'Symbol',     width: 145, pinned: 'left', cellRenderer: TickerCell },
    { field: 'shares',       headerName: 'Shares',     width: 95,  editable: p => !p.data?.isSummary, cellStyle: p => p.data?.isSummary ? {} : ec, valueFormatter: p => p.data?.isSummary ? '' : p.value?.toLocaleString(), valueParser: p => Number(p.newValue), onCellValueChanged },
    { field: 'costBasis',    headerName: 'Cost/Share', width: 105, editable: p => !p.data?.isSummary, cellStyle: p => p.data?.isSummary ? {} : ec, valueFormatter: p => p.data?.isSummary ? '' : `$${fmt2(p.value)}`, valueParser: p => Number(p.newValue), onCellValueChanged },
    { field: 'price',        headerName: 'Last Price', width: 105, cellRenderer: PriceCell },
    { field: 'dayChangePct', headerName: 'Day %',      width: 90,  cellRenderer: DayCell },
    { field: 'marketValue',  headerName: 'Mkt Value',  width: 115, valueFormatter: p => p.value > 0 ? dollar(p.value) : '—' },
    { field: 'gainDollar',   headerName: 'Gain $',     width: 120, cellRenderer: GainDollarCell },
    { field: 'gainPct',      headerName: 'Gain %',     width: 90,  cellRenderer: GainPctCell },
    { field: 'actualPct',    headerName: 'Actual %',   width: 85,  cellRenderer: AllocPctCell },
    { field: 'targetPct',    headerName: 'Target %',   width: 85,  editable: p => !p.data?.isSummary, cellStyle: p => p.data?.isSummary ? {} : ec, cellRenderer: AllocPctCell, valueParser: p => Number(p.newValue), onCellValueChanged },
    { field: 'notes',        headerName: 'Notes',      flex: 1, minWidth: 80, editable: p => !p.data?.isSummary, cellStyle: p => p.data?.isSummary ? {} : { ...ec, color: '#64748b', fontSize: '12px' }, onCellValueChanged },
  ], [onCellValueChanged]);

  const ownedOptionCols = useMemo<ColDef<OwnedOptionRow>[]>(() => [
    { field: 'ticker',           headerName: 'Symbol',  width: 90,  pinned: 'left', cellStyle: { fontWeight: 'bold' } },
    { field: 'type',             headerName: 'Type',    width: 80,  cellRenderer: OptionTypeCell },
    { field: 'strike',           headerName: 'Strike',  width: 85,  valueFormatter: p => `$${p.value}` },
    { field: 'expiration',       headerName: 'Expiry',  width: 110 },
    { field: 'daysToExpiration', headerName: 'DTE',     width: 60 },
    { field: 'contracts',        headerName: 'Qty',     width: 55 },
    { field: 'premiumPaid',      headerName: 'Paid',    width: 80,  valueFormatter: p => `$${fmt2(p.value)}` },
    { field: 'currentMid',       headerName: 'Mid',     width: 80,  cellRenderer: OptMidCell },
    { field: 'gainDollar',       headerName: 'Gain $',  width: 105, cellRenderer: OptGainDollarCell },
    { field: 'gainPct',          headerName: 'Gain %',  width: 85,  cellRenderer: OptGainPctCell },
    { field: 'notes',            headerName: 'Notes',   flex: 1, minWidth: 80, cellStyle: { color: '#64748b', fontSize: '12px' } },
    { headerName: '', width: 40, sortable: false, resizable: false, cellRenderer: DeleteOptionCell },
  ], []);

  const watchedOptionCols = useMemo<ColDef<WatchedOptionRow>[]>(() => [
    { field: 'ticker',          headerName: 'Symbol',       width: 90,  pinned: 'left', cellStyle: { fontWeight: 'bold', color: '#64748b' } },
    { field: 'type',            headerName: 'Type',         width: 80,  cellRenderer: OptionTypeCell },
    { field: 'strike',          headerName: 'Strike',       width: 85,  valueFormatter: p => `$${p.value}` },
    { field: 'expiration',      headerName: 'Expiry',       width: 110 },
    { field: 'daysToExpiration',headerName: 'DTE',          width: 60 },
    { field: 'underlyingPrice', headerName: 'Stock $',      width: 90,  valueFormatter: p => p.value > 0 ? `$${fmt2(p.value)}` : '—', cellStyle: { color: '#94a3b8' } },
    { field: 'savedPrice',      headerName: 'Saved Mid',    width: 105, valueFormatter: p => p.value > 0 ? `$${fmt2(p.value)}` : '—', cellStyle: { color: '#64748b' } },
    { field: 'targetOptionMid', headerName: 'Target Mid',   width: 120, cellRenderer: TargetMidCell },
    { field: 'notes',           headerName: 'Notes',        flex: 1, minWidth: 80, cellStyle: { color: '#64748b', fontSize: '12px' } },
    { headerName: '', width: 40, sortable: false, resizable: false, cellRenderer: DeleteOptionCell },
  ], []);

  if (loading && !holdings) return <div className="flex items-center justify-center h-full text-slate-400">Loading…</div>;
  if (!holdings) return <div className="flex items-center justify-center h-full text-slate-400">No holdings</div>;

  const ROW_H = 44;
  const HDR_H = 34;
  const stockGridH         = HDR_H + stockRows.length * 48 + 48;
  const ownedOptGridH      = HDR_H + ownedOptionRows.length * ROW_H;
  const watchedOptGridH    = HDR_H + watchedOptionRows.length * ROW_H;
  const hasOwnedOptions    = ownedOptionRows.length > 0;
  const hasWatchedOptions  = watchedOptionRows.length > 0;
  const existingTickers    = Object.keys(holdings.stocks);

  const stockCtx = { openOptions: setOptionChainTicker, deleteStock: handleDeleteStock };
  const optCtx   = { deleteOption: handleDeleteOption };

  return (
    <div className="flex flex-col h-full bg-slate-950">
      <div className="flex-1 overflow-y-auto">

        {/* ── Stocks ── */}
        <SectionLabel onAdd={() => setShowAddModal(true)}>Stocks</SectionLabel>
        <div style={{ height: stockGridH }}>
          <AgGridReact<StockRow>
            theme={darkTheme} rowData={stockRows} columnDefs={stockCols} defaultColDef={defaultColDef}
            rowHeight={48} headerHeight={36} animateRows pinnedBottomRowData={[summaryRow]}
            context={stockCtx}
            getRowStyle={p => p.node.rowPinned ? { background: '#1e293b', borderTop: '1px solid #334155' } : undefined}
          />
        </div>

        {/* ── Owned Options ── */}
        {hasOwnedOptions && (
          <div className="border-t border-slate-700/50">
            <SectionLabel>Options — Owned</SectionLabel>
            <div style={{ height: ownedOptGridH }}>
              <AgGridReact<OwnedOptionRow>
                theme={darkTheme} rowData={ownedOptionRows} columnDefs={ownedOptionCols}
                defaultColDef={defaultColDef} rowHeight={ROW_H} headerHeight={HDR_H}
                context={optCtx}
              />
            </div>
          </div>
        )}

        {/* ── Watched Options ── */}
        {hasWatchedOptions && (
          <div className="border-t border-slate-700/50">
            <SectionLabel>Options — Watching</SectionLabel>
            <div style={{ height: watchedOptGridH }}>
              <AgGridReact<WatchedOptionRow>
                theme={darkTheme} rowData={watchedOptionRows} columnDefs={watchedOptionCols}
                defaultColDef={defaultColDef} rowHeight={ROW_H} headerHeight={HDR_H}
                context={optCtx}
              />
            </div>
          </div>
        )}

      </div>

      <div className="px-4 py-1 text-xs text-slate-600 border-t border-slate-800 flex-shrink-0">
        Updated: {holdings.lastUpdated} · Chart icon → option chain · ✕ → remove · Double-click editable cells to edit
      </div>

      {showAddModal && <AddStockModal existingTickers={existingTickers} onAdd={handleAddStock} onClose={() => setShowAddModal(false)} />}

      {optionChainTicker && (
        <OptionChainModal
          ticker={optionChainTicker}
          currentPrice={priceMap.get(optionChainTicker)?.price ?? 0}
          onClose={() => setOptionChainTicker(null)}
          onWatchAdded={handleAddOptionWatch}
        />
      )}
    </div>
  );
}

function SectionLabel({ children, onAdd }: { children: React.ReactNode; onAdd?: () => void }) {
  return (
    <div className="px-5 pt-3 pb-1.5 flex items-center gap-3 flex-shrink-0">
      <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">{children}</span>
      <div className="flex-1 h-px bg-slate-800" />
      {onAdd && (
        <button onClick={onAdd} title="Add"
          style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(5,150,105,0.15)', border: '1px solid rgba(5,150,105,0.4)', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', color: '#34d399', fontSize: 11, fontWeight: 700 }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(5,150,105,0.3)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'rgba(5,150,105,0.15)')}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add
        </button>
      )}
    </div>
  );
}
