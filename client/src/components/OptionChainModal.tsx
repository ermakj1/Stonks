import React, { useState, useRef, useEffect } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { themeBalham, type ColDef, type RowClassParams } from 'ag-grid-community';
import type { OptionContract, OptionEntry } from '../types';
import { useOptionChain, getExpiryType, type ExpiryGroup, type ExpiryFreq } from '../hooks/useOptionChain';

// Parse call/put from OCC symbol (e.g. "AAPL260321C00190000" → 'call')
function contractType(symbol: string): 'call' | 'put' {
  return /\d{6}C/.test(symbol) ? 'call' : 'put';
}

// ── Watch cell renderer ───────────────────────────────────────────────
type WatchCtx = { onWatch: (c: OptionContract) => void };

function WatchCell(p: { data: OptionContract; context: WatchCtx }) {
  if (!p.data) return null;
  return (
    <button
      onClick={e => { e.stopPropagation(); p.context.onWatch(p.data); }}
      title="Add to option watchlist"
      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569', padding: '2px 6px', display: 'flex', alignItems: 'center' }}
      onMouseEnter={e => (e.currentTarget.style.color = '#34d399')}
      onMouseLeave={e => (e.currentTarget.style.color = '#475569')}
    >
      {/* eye icon */}
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
      </svg>
    </button>
  );
}

const darkTheme = themeBalham.withParams({
  backgroundColor: '#0f172a',
  oddRowBackgroundColor: '#111827',
  headerBackgroundColor: '#1e293b',
  borderColor: '#334155',
  rowBorder: { color: '#1e293b', width: 1 },
  foregroundColor: '#e2e8f0',
  headerTextColor: '#94a3b8',
  rowHoverColor: '#1e3a5f',
  fontSize: 12,
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  cellHorizontalPaddingScale: 0.7,
  rowHeight: 36,
  headerHeight: 32,
});

// ── helpers ────────────────────────────────────────────────────────────

function fmtExpiry(ts: number, short = false) {
  return new Date(ts * 1000).toLocaleDateString('en-US', short
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' }
  );
}
function fmtDollar(v: number) {
  return v != null ? `$${v.toFixed(2)}` : '—';
}
function dte(ts: number) {
  return Math.round((ts - Date.now() / 1000) / 86400);
}

// Visual config per expiry frequency type
const FREQ_META: Record<ExpiryFreq, { label: string; letter: string; color: string; bg: string; border: string }> = {
  monthly: { label: 'Monthly', letter: 'M', color: '#34d399', bg: 'rgba(16,185,129,0.12)',  border: 'rgba(16,185,129,0.4)' },
  weekly:  { label: 'Weekly',  letter: 'W', color: '#60a5fa', bg: 'rgba(96,165,250,0.12)',  border: 'rgba(96,165,250,0.4)' },
  daily:   { label: 'Daily',   letter: 'D', color: '#fbbf24', bg: 'rgba(251,191,36,0.12)',  border: 'rgba(251,191,36,0.4)' },
};

// ── grid ───────────────────────────────────────────────────────────────

function makeCols(isCall: boolean): ColDef<OptionContract>[] {
  return [
    {
      headerName: 'Strike', field: 'strike', width: 80, pinned: 'left',
      cellStyle: (p) => ({
        fontWeight: 700,
        color: p.data?.inTheMoney ? (isCall ? '#34d399' : '#f87171') : '#e2e8f0',
      }),
      valueFormatter: p => `$${p.value}`,
    },
    { headerName: 'Delta', field: 'delta',            width: 72, valueFormatter: p => p.value != null ? p.value.toFixed(3) : '—' },
    { headerName: 'IV %',  field: 'impliedVolatility', width: 72, valueFormatter: p => p.value != null ? `${(p.value * 100).toFixed(1)}%` : '—' },
    { headerName: 'Bid',   field: 'bid',               width: 72, valueFormatter: p => fmtDollar(p.value) },
    { headerName: 'Ask',   field: 'ask',               width: 72, valueFormatter: p => fmtDollar(p.value) },
    { headerName: 'Mid',   field: 'midpoint',          width: 72, valueFormatter: p => fmtDollar(p.value ?? 0) },
    { headerName: 'Last',  field: 'lastPrice',         width: 72, valueFormatter: p => fmtDollar(p.value) },
    { headerName: 'Vol',   field: 'volume',            width: 80, valueFormatter: p => p.value?.toLocaleString() ?? '—' },
    { headerName: 'OI',    field: 'openInterest',      width: 80, valueFormatter: p => p.value?.toLocaleString() ?? '—' },
  ];
}

const callCols = makeCols(true);
const putCols  = makeCols(false);
const defaultColDef: ColDef = { resizable: true, sortable: true, suppressHeaderMenuButton: true };

function getRowStyle(params: RowClassParams<OptionContract>) {
  if (params.data?.inTheMoney) return { background: 'rgba(16,185,129,0.08)' };
  return undefined;
}

const watchCol: ColDef<OptionContract> = {
  headerName: '', width: 40, sortable: false, resizable: false, cellRenderer: WatchCell,
};

function ContractGrid({ rows, isCall, onWatch }: { rows: OptionContract[]; isCall: boolean; onWatch: (c: OptionContract) => void }) {
  const cols = React.useMemo(() => [...(isCall ? callCols : putCols), watchCol], [isCall]);
  if (rows.length === 0) {
    return <div style={{ padding: '6px 0 8px', color: '#475569', fontSize: 12 }}>No contracts match filters</div>;
  }
  return (
    <div style={{ height: Math.min(32 + rows.length * 36, 300) }}>
      <AgGridReact<OptionContract>
        theme={darkTheme}
        rowData={rows}
        columnDefs={cols}
        defaultColDef={defaultColDef}
        rowHeight={36}
        headerHeight={32}
        getRowStyle={getRowStyle}
        context={{ onWatch }}
      />
    </div>
  );
}

// ── expiry group section ───────────────────────────────────────────────

function ExpirySection({ group, view, onWatch }: { group: ExpiryGroup; view: 'calls' | 'puts' | 'both'; onWatch: (c: OptionContract) => void }) {
  const d    = dte(group.expiry);
  const freq = getExpiryType(group.expiry);
  const meta = FREQ_META[freq];

  return (
    <div style={{ marginBottom: 28 }}>
      {/* date header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
        paddingBottom: 8, borderBottom: '1px solid #1e293b',
      }}>
        {/* frequency badge */}
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
          background: meta.bg, border: `1px solid ${meta.border}`, color: meta.color,
          letterSpacing: '0.04em', textTransform: 'uppercase', flexShrink: 0,
        }}>
          {meta.label}
        </span>
        <span style={{ fontWeight: 700, color: '#e2e8f0', fontSize: 14 }}>
          {fmtExpiry(group.expiry)}
        </span>
        <span style={{
          fontSize: 11, fontWeight: 600, color: '#64748b',
          background: '#1e293b', borderRadius: 4, padding: '1px 7px',
        }}>
          {d}d
        </span>
        {(view === 'calls' || view === 'both') && (
          <span style={{ fontSize: 11, color: '#34d399' }}>{group.calls.length} calls</span>
        )}
        {view === 'both' && <span style={{ color: '#334155' }}>·</span>}
        {(view === 'puts' || view === 'both') && (
          <span style={{ fontSize: 11, color: '#f87171' }}>{group.puts.length} puts</span>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {(view === 'calls' || view === 'both') && (
          <div>
            {view === 'both' && (
              <div style={{ fontSize: 11, fontWeight: 600, color: '#34d399', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Calls</div>
            )}
            <ContractGrid rows={group.calls} isCall={true} onWatch={onWatch} />
          </div>
        )}
        {(view === 'puts' || view === 'both') && (
          <div>
            {view === 'both' && (
              <div style={{ fontSize: 11, fontWeight: 600, color: '#f87171', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Puts</div>
            )}
            <ContractGrid rows={group.puts} isCall={false} onWatch={onWatch} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── frequency toggle button ────────────────────────────────────────────

function FreqToggle({ freq, active, onToggle }: { freq: ExpiryFreq; active: boolean; onToggle: () => void }) {
  const meta = FREQ_META[freq];
  return (
    <button
      onClick={onToggle}
      style={{
        padding: '3px 10px', borderRadius: 5, fontSize: 11, fontWeight: 700,
        cursor: 'pointer', transition: 'all 0.12s', letterSpacing: '0.03em',
        border: active ? `1px solid ${meta.border}` : '1px solid #334155',
        background: active ? meta.bg : '#1e293b',
        color: active ? meta.color : '#475569',
      }}
    >
      {meta.label}
    </button>
  );
}

// ── main modal ─────────────────────────────────────────────────────────

const inputCls = 'bg-slate-800 border border-slate-600 text-white rounded px-2 py-1 text-xs placeholder-slate-600 focus:outline-none focus:border-emerald-500';
const selectCls = `appearance-none ${inputCls} cursor-pointer`;

interface WatchForm {
  contract: OptionContract;
  savedPrice: number;
  targetPrice: string;
  notes: string;
}

interface Props {
  ticker: string;
  currentPrice: number;
  onClose: () => void;
  onWatchAdded?: (key: string, entry: OptionEntry) => Promise<void>;
}

export function OptionChainModal({ ticker, currentPrice, onClose, onWatchAdded }: Props) {
  const { loading, loadingExpiries, error, expiryDates, groups, filters, setFilters, toggleExpiry, underlyingPrice } = useOptionChain(ticker);

  const price = underlyingPrice || currentPrice;
  const [view, setView] = useState<'calls' | 'puts' | 'both'>('calls');
  const [watchForm, setWatchForm] = useState<WatchForm | null>(null);
  const targetRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (watchForm) targetRef.current?.focus(); }, [watchForm]);

  function set<K extends keyof typeof filters>(key: K, val: typeof filters[K]) {
    setFilters(f => ({ ...f, [key]: val }));
  }

  function toggleFreq(freq: ExpiryFreq) {
    setFilters(f => {
      const current = f.expiryFreq;
      if (current.includes(freq)) {
        if (current.length === 1) return f;
        return { ...f, expiryFreq: current.filter(q => q !== freq) };
      }
      return { ...f, expiryFreq: [...current, freq] };
    });
  }

  const handleWatch = (contract: OptionContract) => {
    const mid = ((contract.bid ?? 0) + (contract.ask ?? 0)) / 2;
    setWatchForm({ contract, savedPrice: mid, targetPrice: mid > 0 ? mid.toFixed(2) : '', notes: '' });
  };

  const handleSaveWatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!watchForm || !onWatchAdded) return;
    const { contract, savedPrice, targetPrice, notes } = watchForm;
    const expDateStr = new Date(contract.expiration * 1000).toISOString().split('T')[0];
    const type = contractType(contract.contractSymbol);
    const entry: OptionEntry = {
      ticker,
      type,
      strike: contract.strike,
      expiration: expDateStr,
      contracts: 0,
      premium_paid: 0,
      saved_price: savedPrice,
      target_price: Number(targetPrice) || 0,
      notes,
    };
    await onWatchAdded(contract.contractSymbol, entry);
    setWatchForm(null);
  };

  const stopProp = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl flex flex-col"
        style={{ width: '92vw', maxWidth: 960, maxHeight: '90vh', position: 'relative' }}
        onClick={stopProp}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700 flex-shrink-0">
          <div className="flex items-baseline gap-3">
            <span className="text-white font-bold text-lg">{ticker}</span>
            <span className="text-slate-400 text-sm">Option Chain</span>
            {price > 0 && (
              <span className="text-emerald-400 text-sm font-semibold">${price.toFixed(2)}</span>
            )}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none px-2">✕</button>
        </div>

        {/* ── Controls ── */}
        <div className="flex flex-wrap items-start gap-x-5 gap-y-3 px-5 py-3 border-b border-slate-800 flex-shrink-0">

          {/* DTE range */}
          <label className="flex items-center gap-1.5 text-xs text-slate-400 flex-shrink-0">
            DTE
            <input
              type="number" min="0" placeholder="min"
              value={filters.dteMin}
              onChange={e => set('dteMin', Number(e.target.value))}
              className={`w-14 ${inputCls}`}
            />
            –
            <input
              type="number" min="0" placeholder="max (0=∞)"
              value={filters.dteMax}
              onChange={e => set('dteMax', Number(e.target.value))}
              className={`w-20 ${inputCls}`}
            />
            <span className="text-slate-600 text-[10px]">days</span>
          </label>

          {/* Frequency toggles */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {(['monthly', 'weekly', 'daily'] as ExpiryFreq[]).map(freq => (
              <FreqToggle
                key={freq}
                freq={freq}
                active={filters.expiryFreq.includes(freq)}
                onToggle={() => toggleFreq(freq)}
              />
            ))}
          </div>

          {/* Show calls/puts/both */}
          <label className="flex items-center gap-2 text-xs text-slate-400 flex-shrink-0">
            Show
            <select
              style={{ backgroundColor: '#1e293b', color: '#f1f5f9', borderColor: '#475569' }}
              className={selectCls}
              value={view}
              onChange={e => setView(e.target.value as 'calls' | 'puts' | 'both')}
            >
              <option value="calls">Calls</option>
              <option value="puts">Puts</option>
              <option value="both">Both</option>
            </select>
          </label>

          {/* Strike range */}
          <label className="flex items-center gap-1.5 text-xs text-slate-400 flex-shrink-0">
            Strike
            <input type="number" placeholder="min" value={filters.strikeMin}
              onChange={e => set('strikeMin', e.target.value)} className={`w-20 ${inputCls}`} />
            –
            <input type="number" placeholder="max" value={filters.strikeMax}
              onChange={e => set('strikeMax', e.target.value)} className={`w-20 ${inputCls}`} />
          </label>

          {/* Delta range */}
          <label className="flex items-center gap-1.5 text-xs text-slate-400 flex-shrink-0">
            Delta
            <input type="number" placeholder="0" step="0.05" value={filters.deltaMin}
              onChange={e => set('deltaMin', e.target.value)} className={`w-16 ${inputCls}`} />
            –
            <input type="number" placeholder="1" step="0.05" value={filters.deltaMax}
              onChange={e => set('deltaMax', e.target.value)} className={`w-16 ${inputCls}`} />
          </label>

          {/* Expiry pills */}
          <div className="w-full flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-slate-500 mr-1 flex-shrink-0">Expiry</span>
            {loading && expiryDates.length === 0 && (
              <span className="text-xs text-slate-600">Loading…</span>
            )}
            {expiryDates.map(ts => {
              const selected  = filters.selectedExpiries.includes(ts);
              const fetching  = loadingExpiries.has(ts);
              const freq      = getExpiryType(ts);
              const meta      = FREQ_META[freq];
              const d         = dte(ts);

              return (
                <button
                  key={ts}
                  onClick={() => toggleExpiry(ts)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '3px 9px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                    cursor: fetching ? 'wait' : 'pointer', transition: 'all 0.12s',
                    border: selected ? `1px solid ${meta.border}` : '1px solid #1e293b',
                    background: selected ? meta.bg : '#111827',
                    color: selected ? meta.color : '#475569',
                    opacity: fetching ? 0.6 : 1,
                  }}
                >
                  {/* frequency dot */}
                  <span style={{
                    width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
                    background: selected ? meta.color : '#334155',
                  }} />
                  {fetching ? '…' : `${fmtExpiry(ts, true)} (${d}d)`}
                </button>
              );
            })}
            {!loading && expiryDates.length === 0 && (
              <span className="text-xs text-slate-600">No expiries match current filters</span>
            )}
          </div>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto px-5 pt-4 pb-4">
          {loading && groups.length === 0 && (
            <div className="text-slate-400 text-sm py-8 text-center">Loading option chain…</div>
          )}
          {error && (
            <div className="text-red-400 text-sm py-8 text-center">{error}</div>
          )}
          {!loading && !error && groups.length === 0 && (
            <div className="text-slate-500 text-sm py-8 text-center">Select one or more expiry dates above</div>
          )}
          {groups.map(group => (
            <ExpirySection key={group.expiry} group={group} view={view} onWatch={handleWatch} />
          ))}
        </div>

        <div className="px-5 py-2 border-t border-slate-800 text-xs text-slate-600 flex-shrink-0 flex gap-4">
          <span>ITM highlighted</span>
          <span>·</span>
          <span>
            <span style={{ color: FREQ_META.monthly.color }}>M</span>onthly &nbsp;
            <span style={{ color: FREQ_META.weekly.color }}>W</span>eekly &nbsp;
            <span style={{ color: FREQ_META.daily.color }}>D</span>aily
          </span>
          <span>·</span>
          <span>Eye icon → add to watchlist</span>
          <span>·</span>
          <span>~15 min delayed (CBOE)</span>
        </div>

        {/* ── Watch form overlay ── */}
        {watchForm && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 12, zIndex: 10 }}
            onClick={() => setWatchForm(null)}>
            <form onSubmit={handleSaveWatch} onClick={e => e.stopPropagation()}
              style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 10, padding: 22, width: 340, boxShadow: '0 20px 40px rgba(0,0,0,0.5)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div>
                  <div style={{ fontWeight: 700, color: '#e2e8f0', fontSize: 14 }}>
                    Watch {ticker} ${watchForm.contract.strike} {contractType(watchForm.contract.contractSymbol).toUpperCase()}
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                    {new Date(watchForm.contract.expiration * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    &nbsp;· Saved premium: ${watchForm.savedPrice.toFixed(2)}
                  </div>
                </div>
                <button type="button" onClick={() => setWatchForm(null)}
                  style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 4px' }}>✕</button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 4 }}>
                    Target Option Mid Price
                  </label>
                  <input ref={targetRef} type="number" step="0.01" min="0"
                    value={watchForm.targetPrice}
                    onChange={e => setWatchForm(f => f ? { ...f, targetPrice: e.target.value } : null)}
                    placeholder={watchForm.savedPrice > 0 ? watchForm.savedPrice.toFixed(2) : '0.00'}
                    style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', padding: '7px 10px', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
                  />
                  <div style={{ fontSize: 10, color: '#475569', marginTop: 3 }}>
                    Buy when the option mid hits this price — saved mid: ${watchForm.savedPrice.toFixed(2)}
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 4 }}>
                    Notes (optional)
                  </label>
                  <input type="text" value={watchForm.notes}
                    onChange={e => setWatchForm(f => f ? { ...f, notes: e.target.value } : null)}
                    placeholder="e.g. watching for pullback"
                    style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', padding: '7px 10px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setWatchForm(null)}
                  style={{ padding: '7px 14px', borderRadius: 6, border: '1px solid #334155', background: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 13 }}>
                  Cancel
                </button>
                <button type="submit" disabled={!onWatchAdded}
                  style={{ padding: '7px 14px', borderRadius: 6, border: 'none', background: '#059669', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 13, opacity: onWatchAdded ? 1 : 0.5 }}>
                  Add to Watchlist
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
