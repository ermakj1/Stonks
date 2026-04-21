import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  ModuleRegistry,
  AllCommunityModule,
  themeBalham,
  type ColDef,
  type CellValueChangedEvent,
  type GridApi,
} from 'ag-grid-community';
import type { Holdings, PricesResponse, OptionEntry, VolatilityData, OptionSuggestion } from '../types';
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

const STOCK_COL_META = [
  { field: 'shares',       headerName: 'Shares' },
  { field: 'costBasis',    headerName: 'Cost/Share' },
  { field: 'price',        headerName: 'Last Price' },
  { field: 'dayChangePct', headerName: 'Day %' },
  { field: 'marketValue',  headerName: 'Mkt Value' },
  { field: 'gainDollar',   headerName: 'Gain $' },
  { field: 'gainPct',      headerName: 'Gain %' },
  { field: 'actualPct',    headerName: 'Actual %' },
  { field: 'targetPct',    headerName: 'Target %' },
  { field: 'targetValue',  headerName: 'Target $' },
  { field: 'notes',        headerName: 'Notes' },
];

const OPTION_COL_META = [
  { field: 'type',             headerName: 'Type' },
  { field: 'strike',           headerName: 'Strike' },
  { field: 'expiration',       headerName: 'Expiry' },
  { field: 'daysToExpiration', headerName: 'DTE' },
  { field: 'contracts',        headerName: 'Qty' },
  { field: 'premiumPaid',      headerName: 'Premium' },
  { field: 'currentMid',       headerName: 'Mid' },
  { field: 'gainDollar',       headerName: 'Gain $' },
  { field: 'gainPct',          headerName: 'Gain %' },
  { field: 'underlyingPrice',  headerName: 'Stock $' },
  { field: 'iv30',             headerName: 'IV30' },
  { field: 'hv30',             headerName: 'HV30' },
  { field: 'ivhvRatio',        headerName: 'IV/HV' },
  { field: 'savedPrice',       headerName: 'Saved Mid' },
  { field: 'targetOptionMid',  headerName: 'Target Mid' },
  { field: 'notes',            headerName: 'Notes' },
];

// ── cell renderers ───────────────────────────────────────────────────

type StockCtx = { openOptions: (t: string) => void; deleteStock: (t: string) => void };

const FIDELITY_URL = (ticker: string) =>
  `https://digital.fidelity.com/prgw/digital/research/quote/dashboard/chart?symbol=${ticker}`;

const FIDELITY_OPTIONS_URL = (ticker: string) =>
  `https://digital.fidelity.com/ftgw/digital/options-research/option-chain?symbol=${ticker}&oarchain=true`;

const ExternalLinkIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

function TickerCell(p: { value: string; data: StockRow; context: StockCtx }) {
  if (p.data.isSummary) {
    return <span style={{ fontWeight: 700, color: '#94a3b8', fontSize: 12, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Portfolio Total</span>;
  }
  const btnBase: React.CSSProperties = {
    background: 'none', border: 'none', padding: '2px 4px', cursor: 'pointer',
    borderRadius: 4, lineHeight: 1, display: 'flex', alignItems: 'center',
  };
  const isCash  = p.value === '$CASH';
  const isOther = p.value === '$OTHER';
  const label   = isCash ? 'Cash' : isOther ? 'Other Stocks' : p.value;
  const badgeColor = isCash ? '#60a5fa' : isOther ? '#a78bfa' : null;

  if (isCash || isOther) {
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: `${badgeColor}20`, border: `1px solid ${badgeColor}40`, color: badgeColor!, letterSpacing: '0.05em', textTransform: 'uppercase', flexShrink: 0 }}>
          {isCash ? 'cash' : 'other'}
        </span>
        <span style={{ fontWeight: 600, color: '#e2e8f0', fontSize: 13 }}>{label}</span>
        <button onClick={e => { e.stopPropagation(); p.context.deleteStock(p.value); }} title="Remove"
          style={{ ...btnBase, color: '#334155', marginLeft: 2 }}
          onMouseEnter={e => (e.currentTarget.style.color = '#f87171')}
          onMouseLeave={e => (e.currentTarget.style.color = '#334155')}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </span>
    );
  }

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
      {/* Fidelity link */}
      <a href={FIDELITY_URL(p.value)} target="_blank" rel="noopener noreferrer" title="Research on Fidelity"
        onClick={e => e.stopPropagation()}
        style={{ ...btnBase, color: '#475569', textDecoration: 'none' }}
        onMouseEnter={e => (e.currentTarget.style.color = '#818cf8')}
        onMouseLeave={e => (e.currentTarget.style.color = '#475569')}>
        <ExternalLinkIcon />
      </a>
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

function OptionTickerCell(p: { value: string; data: OptionRow }) {
  const btnBase: React.CSSProperties = {
    background: 'none', border: 'none', padding: '2px 3px', cursor: 'pointer',
    borderRadius: 4, lineHeight: 1, display: 'flex', alignItems: 'center', textDecoration: 'none',
  };
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
      <span style={{ fontWeight: 700, color: p.data.isWatchlist ? '#64748b' : '#fff', fontSize: 14 }}>
        {p.value}
        {p.data.isWatchlist && (
          <span style={{ fontSize: 9, fontWeight: 600, marginLeft: 4, color: '#475569', letterSpacing: '0.05em', textTransform: 'uppercase', verticalAlign: 'middle' }}>watch</span>
        )}
        {p.data.fromTrades && (
          <span style={{ fontSize: 9, fontWeight: 600, marginLeft: 4, color: '#60a5fa', letterSpacing: '0.05em', textTransform: 'uppercase', verticalAlign: 'middle' }}>trade</span>
        )}
      </span>
      <a href={FIDELITY_OPTIONS_URL(p.value)} target="_blank" rel="noopener noreferrer" title="Option chain on Fidelity"
        onClick={e => e.stopPropagation()}
        style={{ ...btnBase, color: '#475569', textDecoration: 'none' }}
        onMouseEnter={e => (e.currentTarget.style.color = '#818cf8')}
        onMouseLeave={e => (e.currentTarget.style.color = '#475569')}>
        <ExternalLinkIcon />
      </a>
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

// Target mid vs current live price
function TargetMidCell(p: { value: number; data: { currentMid: number | null } }) {
  const { currentMid } = p.data;
  if (!p.value) return <span style={{ color: '#475569' }}>—</span>;
  const diff = currentMid != null ? currentMid - p.value : null;
  const color = diff == null ? '#94a3b8' : diff < 0 ? '#34d399' : diff > 0 ? '#f87171' : '#94a3b8';
  const sign = diff != null && diff >= 0 ? '+' : '';
  return (
    <span style={{ fontVariantNumeric: 'tabular-nums' }}>
      ${fmt2(p.value)}
      {diff != null && diff !== 0 && (
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

function VolCell(p: { value: number | null }) {
  if (p.value == null) return <span style={{ color: '#475569' }}>—</span>;
  const pct = (p.value * 100).toFixed(1) + '%';
  const heat = p.value > 0.6 ? '#f87171' : p.value > 0.35 ? '#fb923c' : '#94a3b8';
  return <span style={{ fontVariantNumeric: 'tabular-nums', color: heat }}>{pct}</span>;
}

function IvHvCell(p: { value: number | null }) {
  if (p.value == null) return <span style={{ color: '#475569' }}>—</span>;
  // > 1.2 → options expensive (red); < 0.8 → options cheap (green); near 1 → neutral
  const color = p.value > 1.2 ? '#f87171' : p.value < 0.8 ? '#34d399' : '#94a3b8';
  return <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, color }}>{p.value.toFixed(2)}x</span>;
}

// Delete button cell for option rows
type OptCtx = { deleteOption: (key: string) => void };
function DeleteOptionCell(p: { data: OptionRow; context: OptCtx }) {
  if (p.data.fromTrades) return null;
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
  actualPct: number; targetPct: number; targetValue: number; notes: string; isSummary?: boolean;
  isSpecial?: boolean; // $CASH or $OTHER rows
  divYield?: number;            // decimal e.g. 0.007
  annualDivIncome?: number;     // shares × annual rate
  targetAnnualIncome?: number;  // targetValue × divYield
}
interface OptionRow {
  key: string; ticker: string; type: string; strike: number; expiration: string;
  contracts: number; daysToExpiration: number; notes: string; isWatchlist: boolean;
  // owned fields
  premiumPaid: number;
  currentMid: number | null;
  gainDollar: number | null;
  gainPct: number | null;
  // volatility / watched fields
  underlyingPrice: number;
  iv30: number | null;
  hv30: number | null;
  ivhvRatio: number | null;
  savedPrice: number | null;
  targetOptionMid: number;
  fromTrades?: boolean;
  lastOpenTradeId?: string;
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

// ── Add Option modal ──────────────────────────────────────────────────

function buildOccKey(ticker: string, type: string, strike: number, expiration: string): string {
  const [yyyy, mm, dd] = expiration.split('-');
  const yy = yyyy.slice(2);
  const cp = type.toLowerCase() === 'call' ? 'C' : 'P';
  const strikeStr = Math.round(strike * 1000).toString().padStart(8, '0');
  return `${ticker.toUpperCase()}${yy}${mm}${dd}${cp}${strikeStr}`;
}

interface AddOptionModalProps {
  existingKeys: string[];
  onAddOwned: (key: string, entry: OptionEntry) => Promise<void>;
  onAddWatch: (ticker: string, type: string, strike: number, expiration: string, notes: string) => Promise<void>;
  onClose: () => void;
}

function AddOptionModal({ existingKeys, onAddOwned, onAddWatch, onClose }: AddOptionModalProps) {
  const [ticker, setTicker]         = useState('');
  const [optType, setOptType]       = useState<'call' | 'put'>('call');
  const [direction, setDirection]   = useState<'long' | 'short'>('long');
  const [strike, setStrike]         = useState('');
  const [expiration, setExpiration] = useState('');
  const [contracts, setContracts]   = useState('0');
  const [premium, setPremium]       = useState('');
  const [notes, setNotes]           = useState('');
  const [error, setError]           = useState('');
  const [saving, setSaving]         = useState(false);
  const tickerRef = useRef<HTMLInputElement>(null);

  useEffect(() => { tickerRef.current?.focus(); }, []);

  const qty = Math.abs(Number(contracts));
  const isOwned = qty > 0;
  const finalContracts = direction === 'short' ? -qty : qty;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = ticker.trim().toUpperCase();
    if (!t) { setError('Ticker is required'); return; }
    if (!strike || Number(strike) <= 0) { setError('Strike must be greater than 0'); return; }
    if (!expiration) { setError('Expiration date is required'); return; }
    const key = buildOccKey(t, optType, Number(strike), expiration);
    if (existingKeys.includes(key)) { setError('That option is already in your list'); return; }
    setSaving(true);
    try {
      if (isOwned) {
        const entry: OptionEntry = {
          ticker: t, type: optType, strike: Number(strike),
          expiration, contracts: finalContracts,
          premium_paid: Number(premium) || 0,
          notes: notes.trim(),
        };
        await onAddOwned(key, entry);
      } else {
        await onAddWatch(t, optType, Number(strike), expiration, notes.trim());
      }
      onClose();
    } catch { setError('Failed to save'); setSaving(false); }
  };

  const inp: React.CSSProperties = { width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', padding: '6px 10px', fontSize: 13, outline: 'none', boxSizing: 'border-box' };
  const lbl: React.CSSProperties = { fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 4 };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <form onSubmit={handleSubmit} style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 24, width: 360, boxShadow: '0 25px 50px rgba(0,0,0,0.6)' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <span style={{ fontWeight: 700, color: '#e2e8f0', fontSize: 15 }}>Add Option</span>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={lbl}>Ticker *</label>
              <input ref={tickerRef} style={{ ...inp, textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em' }}
                value={ticker} onChange={e => { setTicker(e.target.value); setError(''); }} placeholder="e.g. AAPL" />
            </div>
            <div>
              <label style={lbl}>Type</label>
              <div style={{ display: 'flex', gap: 6, paddingTop: 2 }}>
                {(['call', 'put'] as const).map(t => (
                  <button key={t} type="button" onClick={() => setOptType(t)}
                    style={{ flex: 1, padding: '6px 0', borderRadius: 6, border: '1px solid', cursor: 'pointer', fontSize: 12, fontWeight: 700,
                      borderColor: optType === t ? (t === 'call' ? '#10b981' : '#ef4444') : '#334155',
                      background: optType === t ? (t === 'call' ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)') : 'none',
                      color: optType === t ? (t === 'call' ? '#34d399' : '#f87171') : '#94a3b8',
                    }}>
                    {t.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div>
            <label style={lbl}>Direction</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['long', 'short'] as const).map(d => (
                <button key={d} type="button" onClick={() => setDirection(d)}
                  style={{ flex: 1, padding: '6px 0', borderRadius: 6, border: '1px solid', cursor: 'pointer', fontSize: 12, fontWeight: 700,
                    borderColor: direction === d ? (d === 'long' ? '#10b981' : '#f59e0b') : '#334155',
                    background: direction === d ? (d === 'long' ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)') : 'none',
                    color: direction === d ? (d === 'long' ? '#34d399' : '#fbbf24') : '#94a3b8',
                  }}>
                  {d === 'long' ? 'Long (bought)' : 'Short (sold)'}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={lbl}>Strike *</label>
              <input style={inp} type="number" min="0" step="any" value={strike}
                onChange={e => { setStrike(e.target.value); setError(''); }} placeholder="e.g. 200" />
            </div>
            <div>
              <label style={lbl}>Expiration *</label>
              <input style={{ ...inp, colorScheme: 'dark' }} type="date" value={expiration}
                onChange={e => { setExpiration(e.target.value); setError(''); }} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={lbl}>Qty (contracts)</label>
              <input style={inp} type="number" min="0" step="1" value={contracts}
                onChange={e => setContracts(e.target.value)} />
              <span style={{ fontSize: 10, color: '#475569', marginTop: 2, display: 'block' }}>0 = watchlist only</span>
            </div>
            <div style={{ opacity: isOwned ? 1 : 0.4 }}>
              <label style={lbl}>{direction === 'short' ? 'Premium Received' : 'Premium Paid'}</label>
              <input style={inp} type="number" min="0" step="any" value={premium}
                disabled={!isOwned} onChange={e => setPremium(e.target.value)} placeholder="per contract" />
            </div>
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
            {saving ? 'Adding…' : isOwned ? (direction === 'short' ? 'Add Short' : 'Add Long') : 'Add to Watchlist'}
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
  optionChainTicker: string | null;
  onOptionChainChange: (ticker: string | null, expiry?: string) => void;
  aiHighlights?: OptionSuggestion[];
  chainInitialExpiry?: string | null;
  onRefreshPrices: () => void;
  pricesLoading: boolean;
  lastRefreshed: Date | null;
}

interface TradePosition {
  id: string; ticker: string; assetType: 'stock' | 'option';
  optionType?: string; strike?: number; expiration?: string;
  notes: string; lastOpenTradeId: string;
  netQty: number; avgCostBasis: number;
  currentPrice: number | null; unrealizedGain: number | null; unrealizedGainPct: number | null;
}

export function HoldingsPanel({ holdings, prices, loading, onHoldingsUpdated, optionChainTicker, onOptionChainChange, aiHighlights, chainInitialExpiry, onRefreshPrices, pricesLoading, lastRefreshed }: Props) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [tradePositions, setTradePositions] = useState<TradePosition[]>([]);
  useEffect(() => {
    fetch('/api/positions/unrealized')
      .then(r => r.ok ? r.json() : [])
      .then(setTradePositions)
      .catch(() => setTradePositions([]));
  }, [holdings]);
  const [showAddOptionModal, setShowAddOptionModal] = useState(false);
  const [showAddStockMenu, setShowAddStockMenu] = useState(false);
  const [stocksCollapsed, setStocksCollapsed] = useState(false);
  const [optionsCollapsed, setOptionsCollapsed] = useState(false);
  const addStockMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showAddStockMenu) return;
    function close(e: MouseEvent) { if (addStockMenuRef.current && !addStockMenuRef.current.contains(e.target as Node)) setShowAddStockMenu(false); }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [showAddStockMenu]);

  const stockGridApi = useRef<GridApi | null>(null);
  const optionGridApi = useRef<GridApi | null>(null);
  const [hiddenStockCols, setHiddenStockCols] = useState<Set<string>>(new Set());
  const [hiddenOptionCols, setHiddenOptionCols] = useState<Set<string>>(new Set());
  const toggleStockCol = useCallback((field: string) => {
    setHiddenStockCols(prev => {
      const nowHidden = prev.has(field);
      const next = new Set(prev);
      if (nowHidden) next.delete(field); else next.add(field);
      stockGridApi.current?.setColumnsVisible([field], nowHidden);
      return next;
    });
  }, []);
  const toggleOptionCol = useCallback((field: string) => {
    setHiddenOptionCols(prev => {
      const nowHidden = prev.has(field);
      const next = new Set(prev);
      if (nowHidden) next.delete(field); else next.add(field);
      optionGridApi.current?.setColumnsVisible([field], nowHidden);
      return next;
    });
  }, []);

  const chainRef = useRef<HTMLDivElement>(null);

  // Resizable vertical split: stocks top, options+chain bottom
  const [splitPct, setSplitPct] = useState(50);
  const vDragging = useRef(false);
  const vContainerRef = useRef<HTMLDivElement>(null);
  const onVMouseDown = useCallback(() => { vDragging.current = true; }, []);
  const onVMouseMove = useCallback((e: MouseEvent) => {
    if (!vDragging.current || !vContainerRef.current) return;
    const rect = vContainerRef.current.getBoundingClientRect();
    const pct = ((e.clientY - rect.top) / rect.height) * 100;
    setSplitPct(Math.min(80, Math.max(20, pct)));
  }, []);
  const onVMouseUp = useCallback(() => { vDragging.current = false; }, []);

  useEffect(() => {
    window.addEventListener('mousemove', onVMouseMove);
    window.addEventListener('mouseup', onVMouseUp);
    return () => {
      window.removeEventListener('mousemove', onVMouseMove);
      window.removeEventListener('mouseup', onVMouseUp);
    };
  }, [onVMouseMove, onVMouseUp]);

  // Auto-scroll to option chain when it opens
  useEffect(() => {
    if (optionChainTicker && chainRef.current) {
      setTimeout(() => chainRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    }
  }, [optionChainTicker]);

  const priceMap = useMemo(() => new Map(prices?.stocks.map(s => [s.ticker, s]) ?? []), [prices]);
  const optionPriceMap = useMemo(() => new Map(prices?.options.map(o => [o.key, o]) ?? []), [prices]);

  // ── stock rows ───────────────────────────────────────────────────
  const baseRows = useMemo<Omit<StockRow, 'actualPct' | 'targetValue'>[]>(() => {
    if (!holdings) return [];
    return Object.entries(holdings.stocks).map(([ticker, s]) => {
      const isCash  = ticker === '$CASH';
      const isOther = ticker === '$OTHER';
      const isSpecial = isCash || isOther;
      if (isSpecial) {
        // shares = current value, cost_basis = total cost
        const marketValue = s.shares;
        const cost = s.cost_basis;
        const gainDollar = isCash ? 0 : marketValue - cost;
        const gainPct = isCash ? 0 : (cost > 0 ? (gainDollar / cost) * 100 : 0);
        return { ticker, shares: s.shares, costBasis: s.cost_basis, price: 0, dayChangePct: 0, marketValue, gainDollar, gainPct, targetPct: s.target_allocation_pct, notes: s.notes, isSpecial: true };
      }
      const q = priceMap.get(ticker);
      const price = q?.price ?? 0;
      const marketValue = price * s.shares;
      const cost = s.cost_basis * s.shares;
      const gainDollar = price > 0 && s.shares > 0 ? marketValue - cost : 0;
      const gainPct = price > 0 && cost > 0 ? (gainDollar / cost) * 100 : 0;
      const divYield = q?.dividendYield;
      const annualDivIncome = q?.dividendRate != null && q.dividendRate > 0 ? q.dividendRate * s.shares : undefined;
      return { ticker, shares: s.shares, costBasis: s.cost_basis, price, dayChangePct: q?.changePercent ?? 0, marketValue, gainDollar, gainPct, targetPct: s.target_allocation_pct, notes: s.notes, divYield, annualDivIncome };
    });
  }, [holdings, priceMap]);

  const totalValue = baseRows.reduce((s, r) => s + r.marketValue, 0);
  const stockRows = useMemo<StockRow[]>(() => baseRows.map(r => {
    const targetValue = totalValue > 0 ? (r.targetPct / 100) * totalValue : 0;
    const targetAnnualIncome = (r.divYield ?? 0) > 0 ? targetValue * r.divYield! : undefined;
    return { ...r, actualPct: totalValue > 0 ? (r.marketValue / totalValue) * 100 : 0, targetValue, targetAnnualIncome };
  }), [baseRows, totalValue]);

  const totalCost = stockRows.reduce((s, r) => s + (r.isSpecial ? r.costBasis : r.costBasis * r.shares), 0);
  const totalGain = totalValue - totalCost;
  const totalGainPct = totalCost > 0 ? (totalGain / totalCost) * 100 : 0;
  const totalDayChange = stockRows.reduce((s, r) => s + (r.price > 0 && r.shares > 0 ? (r.dayChangePct / 100) * r.marketValue : 0), 0);
  const weightedDayChangePct = totalValue > 0 ? (totalDayChange / totalValue) * 100 : 0;
  const totalAnnualDivIncome = stockRows.reduce((s, r) => s + (r.annualDivIncome ?? 0), 0);

  const summaryRow: StockRow = {
    ticker: '', shares: 0, costBasis: 0, price: 0,
    dayChangePct: weightedDayChangePct, marketValue: totalValue,
    gainDollar: totalGain, gainPct: totalGainPct, actualPct: 100,
    targetPct: stockRows.reduce((s, r) => s + r.targetPct, 0),
    targetValue: stockRows.reduce((s, r) => s + r.targetValue, 0),
    notes: '', isSummary: true,
    annualDivIncome: totalAnnualDivIncome > 0 ? totalAnnualDivIncome : undefined,
    targetAnnualIncome: (() => { const t = stockRows.reduce((s, r) => s + (r.targetAnnualIncome ?? 0), 0); return t > 0 ? t : undefined; })(),
  };

  // ── option rows (owned + watchlist unified) ──────────────────────
  const optionRows = useMemo<OptionRow[]>(() => {
    if (!holdings) return [];
    const holdingsRows = Object.entries(holdings.options).map(([key, o]) => {
      const isWatchlist = o.contracts === 0;
      const isShort = o.contracts < 0;
      const currentMid = optionPriceMap.get(key)?.mid ?? null;
      const vol: VolatilityData | undefined = prices?.volatility?.[o.ticker];
      const absContracts = Math.abs(o.contracts);
      const optionCost = o.premium_paid * absContracts * 100;
      // Short: gain = (premium_received - current_mid) * contracts * 100
      // Long:  gain = (current_mid - premium_paid) * contracts * 100
      const gainDollar = !isWatchlist && currentMid != null && optionCost > 0
        ? isShort
          ? (o.premium_paid - currentMid) * absContracts * 100
          : (currentMid - o.premium_paid) * absContracts * 100
        : null;
      const gainPct = gainDollar != null && optionCost > 0
        ? (gainDollar / optionCost) * 100
        : null;
      return {
        key, ticker: o.ticker, type: o.type, strike: o.strike,
        expiration: o.expiration, contracts: o.contracts,
        daysToExpiration: dteFromExpiry(o.expiration),
        isWatchlist, premiumPaid: o.premium_paid,
        currentMid, gainDollar, gainPct,
        underlyingPrice: priceMap.get(o.ticker)?.price ?? 0,
        iv30: vol?.iv30 ?? null,
        hv30: vol?.hv30 ?? null,
        ivhvRatio: vol?.iv30 != null && vol?.hv30 != null && vol.hv30 > 0
          ? vol.iv30 / vol.hv30 : null,
        savedPrice: o.saved_price ?? null,
        targetOptionMid: o.target_price ?? 0,
        notes: o.notes,
      };
    });

    // Merge open option positions from trade history that aren't already in holdings.options
    const holdingsKeys = new Set(holdingsRows.map(r => r.key));
    const tradeRows: OptionRow[] = tradePositions
      .filter(p => p.assetType === 'option' && p.optionType && p.strike != null && p.expiration)
      .map(p => {
        const key = buildOccKey(p.ticker, p.optionType!, p.strike!, p.expiration!);
        if (holdingsKeys.has(key)) return null;
        const absContracts = Math.abs(p.netQty);
        const optionCost = p.avgCostBasis * absContracts * 100;
        const gainPct = optionCost > 0 && p.unrealizedGain != null
          ? (p.unrealizedGain / optionCost) * 100 : null;
        return {
          key, ticker: p.ticker, type: p.optionType!, strike: p.strike!, expiration: p.expiration!,
          contracts: p.netQty, daysToExpiration: dteFromExpiry(p.expiration!),
          isWatchlist: false, premiumPaid: p.avgCostBasis,
          currentMid: p.currentPrice, gainDollar: p.unrealizedGain, gainPct,
          underlyingPrice: priceMap.get(p.ticker)?.price ?? 0,
          iv30: null, hv30: null, ivhvRatio: null, savedPrice: null, targetOptionMid: 0,
          notes: p.notes ?? '', fromTrades: true, lastOpenTradeId: p.lastOpenTradeId,
        } satisfies OptionRow;
      })
      .filter((r): r is OptionRow => r !== null);

    return [...holdingsRows, ...tradeRows];
  }, [holdings, priceMap, optionPriceMap, prices, tradePositions]);

  // ── save helpers ─────────────────────────────────────────────────
  const saveHoldings = useCallback(async (updated: Holdings) => {
    await fetch('/api/holdings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) });
    onHoldingsUpdated?.();
  }, [onHoldingsUpdated]);

  const onCellValueChanged = useCallback(async (e: CellValueChangedEvent<StockRow>) => {
    if (!holdings || e.data.isSummary) return;
    const { ticker, shares, costBasis, notes } = e.data;
    const colId = e.column.getColId();
    const targetPct =
      colId === 'targetValue'
        ? (totalValue > 0 ? (Number(e.newValue) / totalValue) * 100 : 0)
        : colId === 'targetAnnualIncome' && (e.data.divYield ?? 0) > 0
          ? (Number(e.newValue) / (totalValue * e.data.divYield!)) * 100
          : e.data.targetPct;
    const updated: Holdings = { ...holdings, stocks: { ...holdings.stocks, [ticker]: { ...holdings.stocks[ticker], shares: Number(shares), cost_basis: Number(costBasis), target_allocation_pct: targetPct, notes: String(notes ?? '') } } };
    try { await saveHoldings(updated); } catch (err) { console.error('Failed to save:', err); }
  }, [holdings, saveHoldings, totalValue]);

  const handleAddSpecial = useCallback(async (key: '$CASH' | '$OTHER') => {
    if (!holdings || holdings.stocks[key]) return;
    await saveHoldings({ ...holdings, stocks: { ...holdings.stocks, [key]: { shares: 0, cost_basis: 0, target_allocation_pct: 0, notes: '' } } });
  }, [holdings, saveHoldings]);

  const onOptionCellValueChanged = useCallback(async (e: CellValueChangedEvent<OptionRow>) => {
    if (!holdings) return;
    const { key, contracts, premiumPaid, targetOptionMid, notes, fromTrades, lastOpenTradeId } = e.data;

    // Trade-derived row: patch notes on the opening trade record
    if (fromTrades) {
      if (!lastOpenTradeId) return;
      try {
        await fetch(`/api/trades/${lastOpenTradeId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notes: String(notes ?? '') }),
        });
      } catch (err) { console.error('Failed to save position notes:', err); }
      return;
    }

    const existing = holdings.options[key];
    if (!existing) return;
    const updated: Holdings = {
      ...holdings,
      options: {
        ...holdings.options,
        [key]: {
          ...existing,
          contracts: Number(contracts ?? 0),
          premium_paid: Number(premiumPaid ?? 0),
          target_price: Number(targetOptionMid ?? 0),
          notes: String(notes ?? ''),
        },
      },
    };
    try { await saveHoldings(updated); } catch (err) { console.error('Failed to save option:', err); }
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

  const handleAddOptionWatchPost = useCallback(async (ticker: string, type: string, strike: number, expiration: string, notes: string) => {
    await fetch('/api/holdings/watch-option', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker, type, strike, expiration, notes }),
    });
    onHoldingsUpdated?.();
  }, [onHoldingsUpdated]);

  // ── column defs ──────────────────────────────────────────────────
  const defaultColDef = useMemo<ColDef>(() => ({ resizable: true, sortable: true, suppressHeaderMenuButton: true }), []);
  const ec = { cursor: 'text' };

  const stockCols = useMemo<ColDef<StockRow>[]>(() => [
    { field: 'ticker',       headerName: 'Symbol',     width: 160, pinned: 'left', cellRenderer: TickerCell },
    { field: 'shares',       headerName: 'Shares',     width: 105, editable: p => !p.data?.isSummary, cellStyle: p => p.data?.isSummary ? {} : ec,
      valueFormatter: p => {
        if (p.data?.isSummary) return '';
        if (p.data?.isSpecial) return p.value > 0 ? dollar(p.value) : '$0.00';
        return p.value?.toLocaleString();
      },
      valueParser: p => Number(p.newValue), onCellValueChanged },
    { field: 'costBasis',    headerName: 'Cost/Share', width: 110, editable: p => !p.data?.isSummary, cellStyle: p => p.data?.isSummary ? {} : ec,
      valueFormatter: p => {
        if (p.data?.isSummary) return '';
        if (p.data?.ticker === '$CASH') return '—';
        if (p.data?.isSpecial) return p.value > 0 ? dollar(p.value) : '$0.00';
        return `$${fmt2(p.value)}`;
      },
      valueParser: p => Number(p.newValue), onCellValueChanged },
    { field: 'price',        headerName: 'Last Price', width: 105, cellRenderer: (p: { value: number; data: StockRow }) => (p.data?.isSpecial || p.data?.isSummary) ? <span style={{ color: '#475569' }}>{p.data.isSummary ? '' : '—'}</span> : <PriceCell value={p.value} /> },
    { field: 'dayChangePct', headerName: 'Day %',      width: 90,  cellRenderer: (p: { value: number; data: StockRow }) => p.data?.isSpecial ? <span style={{ color: '#475569' }}>—</span> : <DayCell value={p.value} /> },
    { field: 'marketValue',  headerName: 'Mkt Value',  width: 115, valueFormatter: p => p.value > 0 ? dollar(p.value) : '—' },
    { field: 'gainDollar',   headerName: 'Gain $',     width: 120, cellRenderer: (p: { value: number; data: StockRow }) => p.data?.ticker === '$CASH' ? <span style={{ color: '#475569' }}>—</span> : <GainDollarCell value={p.value} /> },
    { field: 'gainPct',      headerName: 'Gain %',     width: 90,  cellRenderer: (p: { value: number; data: StockRow }) => p.data?.ticker === '$CASH' ? <span style={{ color: '#475569' }}>—</span> : <GainPctCell value={p.value} /> },
    { field: 'divYield',     headerName: 'Div Yield',  width: 90,
      valueFormatter: (p: { value: number | undefined; data: StockRow }) => p.data?.isSummary ? '' : (p.value != null && p.value > 0 ? `${(p.value * 100).toFixed(2)}%` : '—'),
      cellStyle: { color: '#34d399', textAlign: 'right' } },
    { field: 'annualDivIncome', headerName: 'Ann. Income', width: 110,
      valueFormatter: (p: { value: number | undefined; data: StockRow }) => p.value != null && p.value > 0 ? `$${Math.round(p.value).toLocaleString()}` : (p.data?.isSummary ? '' : '—'),
      cellStyle: { color: '#34d399', textAlign: 'right' } },
    { field: 'actualPct',    headerName: 'Actual %',   width: 85,  cellRenderer: AllocPctCell },
    { field: 'targetPct',    headerName: 'Target %',   width: 85,  editable: p => !p.data?.isSummary, cellStyle: p => p.data?.isSummary ? {} : ec, cellRenderer: AllocPctCell, valueParser: p => Number(p.newValue), onCellValueChanged },
    { field: 'targetValue',  headerName: 'Target $',   width: 105, editable: p => !p.data?.isSummary, cellStyle: p => p.data?.isSummary ? {} : ec,
      valueFormatter: p => p.value > 0 ? dollar(p.value) : '—',
      valueParser: p => Number(p.newValue), onCellValueChanged },
    { field: 'targetAnnualIncome', headerName: 'Target Income', width: 120,
      editable: p => !p.data?.isSummary && (p.data?.divYield ?? 0) > 0,
      cellStyle: (p: { data?: StockRow }) => p.data?.isSummary ? {} : (p.data?.divYield ?? 0) > 0 ? { ...ec, color: '#34d399', textAlign: 'right' } : { color: '#334155', textAlign: 'right' },
      valueFormatter: (p: { value: number | undefined; data?: StockRow }) =>
        p.data?.isSummary
          ? (p.value != null && p.value > 0 ? `$${Math.round(p.value).toLocaleString()}` : '')
          : (p.value != null && p.value > 0 ? `$${Math.round(p.value).toLocaleString()}` : ((p.data?.divYield ?? 0) > 0 ? '—' : '')),
      valueParser: p => Number(p.newValue), onCellValueChanged },
    { field: 'notes',        headerName: 'Notes',      flex: 1, minWidth: 80, editable: p => !p.data?.isSummary, cellStyle: p => p.data?.isSummary ? {} : { ...ec, color: '#64748b', fontSize: '12px' }, onCellValueChanged },
  ], [onCellValueChanged]);

  const optionCols = useMemo<ColDef<OptionRow>[]>(() => [
    { field: 'ticker',           headerName: 'Symbol',      width: 118, pinned: 'left', cellRenderer: OptionTickerCell },
    { field: 'type',             headerName: 'Type',        width: 78,  cellRenderer: OptionTypeCell },
    { field: 'strike',           headerName: 'Strike',      width: 80,  valueFormatter: p => `$${p.value}` },
    { field: 'expiration',       headerName: 'Expiry',      width: 105 },
    { field: 'daysToExpiration', headerName: 'DTE',         width: 55 },
    { field: 'contracts',        headerName: 'Qty',         width: 58,  editable: true, cellStyle: ec, valueParser: p => Number(p.newValue), onCellValueChanged: onOptionCellValueChanged },
    { field: 'premiumPaid',      headerName: 'Premium',     width: 88,
      editable: p => !(p.data?.isWatchlist ?? true),
      cellStyle: p => p.data?.isWatchlist ? {} : ec,
      valueFormatter: p => (!p.data || p.data.isWatchlist || !p.value) ? '—' : `$${fmt2(p.value)}`,
      valueParser: p => Number(p.newValue), onCellValueChanged: onOptionCellValueChanged },
    { field: 'currentMid',       headerName: 'Mid',         width: 88,  cellRenderer: OptMidCell },
    { field: 'gainDollar',       headerName: 'Gain $',      width: 100, cellRenderer: OptGainDollarCell },
    { field: 'gainPct',          headerName: 'Gain %',      width: 80,  cellRenderer: OptGainPctCell },
    { field: 'underlyingPrice',  headerName: 'Stock $',     width: 82,  valueFormatter: p => p.value > 0 ? `$${fmt2(p.value)}` : '—', cellStyle: { color: '#94a3b8' } },
    { field: 'iv30',             headerName: 'IV30',        width: 70,  cellRenderer: VolCell },
    { field: 'hv30',             headerName: 'HV30',        width: 70,  cellRenderer: VolCell },
    { field: 'ivhvRatio',        headerName: 'IV/HV',       width: 72,  cellRenderer: IvHvCell },
    { field: 'savedPrice',       headerName: 'Saved Mid',   width: 95,
      valueFormatter: p => (p.value != null && p.value > 0 && p.data?.isWatchlist) ? `$${fmt2(p.value)}` : '—',
      cellStyle: { color: '#64748b' } },
    { field: 'targetOptionMid',  headerName: 'Target Mid',  width: 115, cellRenderer: TargetMidCell,
      editable: p => p.data?.isWatchlist ?? false,
      cellStyle: p => p.data?.isWatchlist ? ec : {},
      valueParser: p => Number(p.newValue), onCellValueChanged: onOptionCellValueChanged },
    { field: 'notes',            headerName: 'Notes',       flex: 1, minWidth: 80, editable: true, cellStyle: { ...ec, color: '#64748b', fontSize: '12px' }, onCellValueChanged: onOptionCellValueChanged },
    { headerName: '', width: 40, sortable: false, resizable: false, cellRenderer: DeleteOptionCell },
  ], [onOptionCellValueChanged]);

  if (loading && !holdings) return <div className="flex items-center justify-center h-full text-slate-400">Loading…</div>;
  if (!holdings) return <div className="flex items-center justify-center h-full text-slate-400">No holdings</div>;

  const ROW_H = 44;
  const HDR_H = 34;
  const stockGridH   = HDR_H + stockRows.length * 48 + 48;
  const optionGridH  = HDR_H + optionRows.length * ROW_H;
  const hasOptions   = optionRows.length > 0;
  const existingTickers = Object.keys(holdings.stocks);

  const stockCtx = { openOptions: onOptionChainChange, deleteStock: handleDeleteStock };
  const optCtx   = { deleteOption: handleDeleteOption };

  return (
    <div className="flex flex-col h-full bg-slate-950">
      <div ref={vContainerRef} className="flex-1 flex flex-col overflow-hidden">

        {/* ── Stocks + Options pane ── */}
        <div style={optionChainTicker ? { height: `${splitPct}%` } : { flex: 1 }} className="flex flex-col overflow-hidden flex-shrink-0">
          <SectionLabel collapsed={stocksCollapsed} onToggle={() => setStocksCollapsed(v => !v)}
            addSlot={
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div className="relative" ref={addStockMenuRef}>
                <button
                  onClick={() => setShowAddStockMenu(v => !v)}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(5,150,105,0.15)', border: '1px solid rgba(5,150,105,0.4)', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', color: '#34d399', fontSize: 11, fontWeight: 700 }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(5,150,105,0.3)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'rgba(5,150,105,0.15)')}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                  Add ▾
                </button>
                {showAddStockMenu && (
                  <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: '#1e293b', border: '1px solid #334155', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', zIndex: 50, minWidth: 150, overflow: 'hidden' }}>
                    <button onClick={() => { setShowAddStockMenu(false); setShowAddModal(true); }}
                      style={{ width: '100%', textAlign: 'left', padding: '8px 14px', background: 'none', border: 'none', color: '#e2e8f0', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#334155')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" /></svg>
                      Stock
                    </button>
                    <div style={{ height: 1, background: '#334155', margin: '0 10px' }} />
                    <button onClick={() => { setShowAddStockMenu(false); handleAddSpecial('$CASH'); }}
                      disabled={!!holdings?.stocks['$CASH']}
                      style={{ width: '100%', textAlign: 'left', padding: '8px 14px', background: 'none', border: 'none', color: holdings?.stocks['$CASH'] ? '#475569' : '#60a5fa', fontSize: 12, cursor: holdings?.stocks['$CASH'] ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
                      onMouseEnter={e => { if (!holdings?.stocks['$CASH']) e.currentTarget.style.background = '#334155'; }}
                      onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                      <span style={{ fontSize: 11 }}>$</span>
                      Cash{holdings?.stocks['$CASH'] ? ' (exists)' : ''}
                    </button>
                    <button onClick={() => { setShowAddStockMenu(false); handleAddSpecial('$OTHER'); }}
                      disabled={!!holdings?.stocks['$OTHER']}
                      style={{ width: '100%', textAlign: 'left', padding: '8px 14px', background: 'none', border: 'none', color: holdings?.stocks['$OTHER'] ? '#475569' : '#a78bfa', fontSize: 12, cursor: holdings?.stocks['$OTHER'] ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
                      onMouseEnter={e => { if (!holdings?.stocks['$OTHER']) e.currentTarget.style.background = '#334155'; }}
                      onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                      <span style={{ fontSize: 11 }}>≈</span>
                      Other Stocks{holdings?.stocks['$OTHER'] ? ' (exists)' : ''}
                    </button>
                  </div>
                )}
              </div>
              <ColumnChooserButton columns={STOCK_COL_META} hidden={hiddenStockCols} onToggle={toggleStockCol} />
            </div>
            }
          >Stocks</SectionLabel>
          <div className="flex-1 overflow-y-auto">
            {!stocksCollapsed && (
              <div style={{ height: stockGridH }}>
                <AgGridReact<StockRow>
                  theme={darkTheme} rowData={stockRows} columnDefs={stockCols} defaultColDef={defaultColDef}
                  rowHeight={48} headerHeight={36} animateRows pinnedBottomRowData={[summaryRow]}
                  context={stockCtx}
                  getRowStyle={p => p.node.rowPinned ? { background: '#1e293b', borderTop: '1px solid #334155' } : undefined}
                  onGridReady={e => { stockGridApi.current = e.api; }}
                />
              </div>
            )}

            <div className="border-t border-slate-700/50">
              <SectionLabel onAdd={() => setShowAddOptionModal(true)} collapsed={optionsCollapsed} onToggle={() => setOptionsCollapsed(v => !v)}
                addSlot={<ColumnChooserButton columns={OPTION_COL_META} hidden={hiddenOptionCols} onToggle={toggleOptionCol} />}
              >Options</SectionLabel>
              {!optionsCollapsed && hasOptions && (
                <div style={{ height: optionGridH }}>
                  <AgGridReact<OptionRow>
                    theme={darkTheme} rowData={optionRows} columnDefs={optionCols}
                    defaultColDef={defaultColDef} rowHeight={ROW_H} headerHeight={HDR_H}
                    context={optCtx}
                    getRowStyle={p => p.data?.isWatchlist ? { color: '#64748b' } : undefined}
                    onRowClicked={p => { if (p.data) onOptionChainChange(p.data.ticker, p.data.expiration); }}
                    onGridReady={e => { optionGridApi.current = e.api; }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Drag handle + Option Chain pane (only when chain is open) ── */}
        {optionChainTicker && (() => {
          const ownedKeys   = new Set(Object.entries(holdings.options).filter(([,o]) => o.contracts > 0).map(([k]) => k));
          const watchedKeys = new Set(Object.entries(holdings.options).filter(([,o]) => o.contracts === 0).map(([k]) => k));
          return (
            <>
              <div
                onMouseDown={onVMouseDown}
                className="h-1 flex-shrink-0 bg-slate-800 hover:bg-blue-500 cursor-row-resize transition-colors active:bg-blue-400"
                title="Drag to resize"
              />
              <div ref={chainRef} className="flex-1 overflow-y-auto">
                <OptionChainModal
                  ticker={optionChainTicker}
                  currentPrice={priceMap.get(optionChainTicker)?.price ?? 0}
                  onClose={() => onOptionChainChange(null)}
                  onWatchAdded={handleAddOptionWatch}
                  ownedKeys={ownedKeys}
                  watchedKeys={watchedKeys}
                  initialExpiry={chainInitialExpiry ?? undefined}
                  highlights={aiHighlights}
                />
              </div>
            </>
          );
        })()}

      </div>

      <div className="px-4 py-1.5 text-xs text-slate-600 border-t border-slate-800 flex-shrink-0 flex items-center gap-3">
        <button
          onClick={onRefreshPrices}
          disabled={pricesLoading}
          className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-[11px] font-semibold rounded-md px-2.5 py-1 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={`flex-shrink-0 ${pricesLoading ? 'animate-spin' : ''}`}>
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          {pricesLoading ? 'Updating…' : 'Refresh'}
        </button>
        {lastRefreshed && (
          <span className="text-slate-500 tabular-nums">
            {lastRefreshed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} at {lastRefreshed.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
          </span>
        )}
        <span className="text-slate-700">~15 min delay</span>
        <span className="text-slate-700">·</span>
        <span>Chart icon → option chain · ✕ → remove · Double-click to edit</span>
      </div>

      {showAddModal && <AddStockModal existingTickers={existingTickers} onAdd={handleAddStock} onClose={() => setShowAddModal(false)} />}
      {showAddOptionModal && (
        <AddOptionModal
          existingKeys={Object.keys(holdings.options)}
          onAddOwned={handleAddOptionWatch}
          onAddWatch={handleAddOptionWatchPost}
          onClose={() => setShowAddOptionModal(false)}
        />
      )}
    </div>
  );
}

function SectionLabel({ children, onAdd, addSlot, collapsed, onToggle }: { children: React.ReactNode; onAdd?: () => void; addSlot?: React.ReactNode; collapsed?: boolean; onToggle?: () => void }) {
  return (
    <div className="px-5 pt-3 pb-1.5 flex items-center gap-3 flex-shrink-0">
      {onToggle ? (
        <button onClick={onToggle} className="flex items-center gap-2 group" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
          <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor" stroke="none"
            className="text-slate-500 group-hover:text-slate-300 transition-transform"
            style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>
            <path d="M6 4l12 8-12 8z" />
          </svg>
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest group-hover:text-slate-300 transition-colors">{children}</span>
        </button>
      ) : (
        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">{children}</span>
      )}
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
      {addSlot}
    </div>
  );
}

function ColumnChooserButton({ columns, hidden, onToggle }: {
  columns: { field: string; headerName: string }[];
  hidden: Set<string>;
  onToggle: (field: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(v => !v)}
        title="Choose columns"
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          background: open ? 'rgba(71,85,105,0.35)' : 'rgba(71,85,105,0.15)',
          border: '1px solid rgba(71,85,105,0.4)',
          borderRadius: 6, padding: '2px 8px', cursor: 'pointer',
          color: '#94a3b8', fontSize: 11, fontWeight: 700,
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(71,85,105,0.35)')}
        onMouseLeave={e => (e.currentTarget.style.background = open ? 'rgba(71,85,105,0.35)' : 'rgba(71,85,105,0.15)')}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
        </svg>
        Columns
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', right: 0,
          background: '#1e293b', border: '1px solid #334155',
          borderRadius: 8, padding: '4px 0', minWidth: 148,
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)', zIndex: 200,
        }}>
          {columns.map(col => {
            const visible = !hidden.has(col.field);
            return (
              <label
                key={col.field}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px', cursor: 'pointer', userSelect: 'none', color: visible ? '#e2e8f0' : '#64748b', fontSize: 12 }}
                onMouseEnter={e => (e.currentTarget.style.background = '#334155')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <input type="checkbox" checked={visible} onChange={() => onToggle(col.field)} style={{ accentColor: '#34d399', cursor: 'pointer' }} />
                {col.headerName}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
