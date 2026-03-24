import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { ModuleRegistry, AllCommunityModule, themeBalham, type ColDef } from 'ag-grid-community';
import type { Trade, TradeAction } from '../types';
import { PnLChart } from './PnLChart';

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
  fontSize: 13,
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  cellHorizontalPaddingScale: 0.8,
  rowHeight: 44,
  headerHeight: 34,
  columnBorder: { style: 'solid', color: '#1e293b', width: 1 },
  headerColumnBorder: { style: 'solid', color: '#334155', width: 1 },
});

// ── helpers ──────────────────────────────────────────────────────────

type DateRange = '30d' | '90d' | '1y' | 'ytd' | 'all';

const DATE_RANGE_LABELS: Record<DateRange, string> = {
  '30d': '30D',
  '90d': '90D',
  '1y':  '1Y',
  'ytd': 'YTD',
  'all': 'All',
};

const DATE_RANGES: DateRange[] = ['30d', '90d', '1y', 'ytd', 'all'];

function getDateCutoff(range: DateRange): string | null {
  if (range === 'all') return null;
  const now = new Date();
  if (range === 'ytd') return `${now.getFullYear()}-01-01`;
  const days = range === '30d' ? 30 : range === '90d' ? 90 : 365;
  now.setDate(now.getDate() - days);
  return now.toISOString().split('T')[0];
}

function today() {
  return new Date().toISOString().split('T')[0];
}

function dollar(n: number, opts?: { sign?: boolean }) {
  const s = Math.abs(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (!opts?.sign) return s;
  return n < 0 ? `-${s}` : `+${s}`;
}

function dteFromExpiry(expiration: string): number {
  return Math.max(0, Math.round((new Date(expiration).getTime() - Date.now()) / 86400000));
}

interface TradeStats {
  count: number;
  winners: number;
  losers: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
}

function computeStats(rows: { pnl: number | null }[]): TradeStats | null {
  const pnls = rows.map(r => r.pnl).filter((p): p is number => p !== null);
  if (pnls.length < 2) return null;
  const wins  = pnls.filter(p => p > 0);
  const losses = pnls.filter(p => p < 0);
  return {
    count: pnls.length,
    winners: wins.length,
    losers: losses.length,
    winRate: wins.length / pnls.length,
    avgWin: wins.length > 0 ? wins.reduce((s, p) => s + p, 0) / wins.length : 0,
    avgLoss: losses.length > 0 ? losses.reduce((s, p) => s + p, 0) / losses.length : 0,
    largestWin: wins.length > 0 ? Math.max(...wins) : 0,
    largestLoss: losses.length > 0 ? Math.min(...losses) : 0,
  };
}

type TradeRowForExport = { date: string; action: string; ticker: string; assetType: string; optionType?: string; strike?: number; expiration?: string; qty: number; price: number; total: number; pnl: number | null; notes: string };

function exportCSV(rows: TradeRowForExport[], filename: string) {
  const headers = ['Date','Action','Ticker','AssetType','OptionType','Strike','Expiration','Qty','Price','Total','PnL','Notes'];
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [
    headers.join(','),
    ...rows.map(r => [
      r.date, r.action, r.ticker, r.assetType, r.optionType ?? '', r.strike ?? '', r.expiration ?? '',
      r.qty, r.price.toFixed(2), r.total.toFixed(2), r.pnl?.toFixed(2) ?? '', r.notes,
    ].map(esc).join(',')),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

const ACTION_META: Record<TradeAction, { label: string; color: string; bg: string; isInflow: boolean }> = {
  buy:      { label: 'Buy',      color: '#60a5fa', bg: 'rgba(96,165,250,0.12)',  isInflow: false },
  sell:     { label: 'Sell',     color: '#34d399', bg: 'rgba(52,211,153,0.12)',  isInflow: true  },
  open:     { label: 'Open',     color: '#818cf8', bg: 'rgba(129,140,248,0.12)', isInflow: true  },
  close:    { label: 'Close',    color: '#34d399', bg: 'rgba(52,211,153,0.12)',  isInflow: false },
  expired:  { label: 'Expired',  color: '#fb923c', bg: 'rgba(251,146,60,0.12)',  isInflow: false },
  assigned: { label: 'Assigned', color: '#a78bfa', bg: 'rgba(167,139,250,0.12)', isInflow: true  },
  rolled:   { label: 'Rolled',   color: '#22d3ee', bg: 'rgba(34,211,238,0.12)',  isInflow: true  },
};

// Compute total dollar value of a trade
function tradeTotal(t: Trade): number {
  return t.qty * t.price * (t.assetType === 'option' ? 100 : 1);
}

// Returns true if this trade represents a still-open position
function isOpenPosition(trade: Trade, allTrades: Trade[]): boolean {
  if (trade.action === 'open') {
    return !allTrades.some(t =>
      t.id !== trade.id &&
      (t.action === 'close' || t.action === 'expired' || t.action === 'assigned') &&
      t.ticker === trade.ticker &&
      t.optionType === trade.optionType &&
      t.strike === trade.strike &&
      t.expiration === trade.expiration
    );
  }
  if (trade.action === 'buy' && trade.assetType === 'stock') {
    return !allTrades.some(t =>
      t.id !== trade.id &&
      t.action === 'sell' &&
      t.ticker === trade.ticker &&
      t.assetType === 'stock'
    );
  }
  return false;
}

// FIFO lot-based P&L engine
type Lot = { price: number; qty: number };

function buildFIFOPnL(trades: Trade[]): Map<string, number> {
  const sorted = [...trades].sort((a, b) => a.date.localeCompare(b.date));
  const lots = new Map<string, Lot[]>();
  const pnlMap = new Map<string, number>();

  function lotKey(t: Trade): string {
    return t.assetType === 'option'
      ? `${t.ticker}-${t.optionType}-${t.strike}-${t.expiration}`
      : `${t.ticker}-stock`;
  }

  for (const t of sorted) {
    const key = lotKey(t);

    if (t.action === 'open' || (t.action === 'buy' && t.assetType === 'stock')) {
      const q = lots.get(key) ?? [];
      q.push({ price: t.price, qty: t.qty });
      lots.set(key, q);

    } else if (
      t.action === 'close' || t.action === 'expired' || t.action === 'assigned' ||
      (t.action === 'sell' && t.assetType === 'stock')
    ) {
      const q = lots.get(key) ?? [];
      let remaining = t.qty;
      let pnl = 0;

      while (remaining > 0 && q.length > 0) {
        const lot = q[0];
        const consumed = Math.min(remaining, lot.qty);

        if (t.action === 'expired') {
          // Short option expires worthless — keep full premium (shown as negative to match close semantics)
          pnl += -(lot.price * consumed * 100);
        } else if (t.action === 'close' || t.action === 'assigned') {
          pnl += (lot.price - t.price) * consumed * 100;
        } else {
          // stock sell
          pnl += (t.price - lot.price) * consumed;
        }

        lot.qty -= consumed;
        remaining -= consumed;
        if (lot.qty <= 0) q.shift();
      }

      lots.set(key, q);
      pnlMap.set(t.id, pnl);
    }
  }

  return pnlMap;
}

// ── cell renderers ────────────────────────────────────────────────────

function ActionCell({ value }: { value: TradeAction }) {
  const m = ACTION_META[value] ?? ACTION_META.buy;
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: m.bg, color: m.color, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
      {m.label}
    </span>
  );
}

function AssetCell({ data }: { data: Trade }) {
  if (!data) return null;
  if (data.assetType === 'stock') {
    return <span style={{ fontWeight: 600, color: '#e2e8f0' }}>{data.ticker}</span>;
  }
  const typeColor = data.optionType === 'call' ? '#34d399' : '#f87171';
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <span style={{ fontWeight: 600, color: '#e2e8f0' }}>{data.ticker}</span>
      <span style={{ fontSize: 10, fontWeight: 700, color: typeColor }}>{data.optionType?.toUpperCase()}</span>
      <span style={{ fontSize: 11, color: '#94a3b8' }}>${data.strike} · {data.expiration?.slice(2).replace(/-/g, '/')}</span>
    </span>
  );
}

function TotalCell({ value, data }: { value: number; data: Trade }) {
  if (!data) return null;
  const m = ACTION_META[data.action];
  const color = m?.isInflow ? '#34d399' : '#f87171';
  const sign = m?.isInflow ? '+' : '-';
  return <span style={{ color, fontWeight: 600 }}>{sign}{dollar(value)}</span>;
}

function PnLCell({ value }: { value: number | null }) {
  if (value == null) return <span style={{ color: '#475569' }}>—</span>;
  const color = value >= 0 ? '#34d399' : '#f87171';
  return <span style={{ color, fontWeight: 600 }}>{dollar(value, { sign: true })}</span>;
}

function CloseCell({ data, context }: { data: Trade; context: { onClosePosition: (trade: Trade) => void } }) {
  if (!data) return null;
  const label = data.assetType === 'stock' ? 'Sell' : 'Close';
  return (
    <button
      onClick={e => { e.stopPropagation(); context.onClosePosition(data); }}
      style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.3)', cursor: 'pointer', color: '#34d399', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700, lineHeight: '18px' }}
      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(52,211,153,0.22)'; e.currentTarget.style.borderColor = 'rgba(52,211,153,0.6)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(52,211,153,0.1)'; e.currentTarget.style.borderColor = 'rgba(52,211,153,0.3)'; }}
      title={`${label} position`}
    >
      {label}
    </button>
  );
}

function DeleteCell({ data, context }: { data: Trade; context: { onDelete: (id: string) => void } }) {
  if (!data) return null;
  return (
    <button
      onClick={e => { e.stopPropagation(); context.onDelete(data.id); }}
      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#334155', padding: '2px 4px', borderRadius: 4, lineHeight: 1 }}
      onMouseEnter={e => (e.currentTarget.style.color = '#f87171')}
      onMouseLeave={e => (e.currentTarget.style.color = '#334155')}
      title="Delete trade"
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  );
}

// ── AddTradeModal ─────────────────────────────────────────────────────

const ACTIONS: TradeAction[] = ['buy', 'sell', 'open', 'close', 'expired', 'assigned', 'rolled'];

interface AddTradeModalProps {
  onClose: () => void;
  onAdd: (trade: Omit<Trade, 'id'>) => Promise<void>;
}

// ── Broker import parser ─────────────────────────────────────────────

function parseSettlementDate(s: string): string {
  // M/D/YY or M/D/YYYY
  const parts = s.trim().split('/');
  if (parts.length !== 3) return today();
  const [m, d, y] = parts.map(Number);
  const year = y < 100 ? 2000 + y : y;
  return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Parse OCC-ish symbol: [-]TICKER YYMMDD C|P STRIKE
// e.g. -TSLA260417C450 or MSFT260327C430
function parseOptionSymbol(raw: string): { ticker: string; expiration: string; optionType: 'call' | 'put'; strike: number } | null {
  const symbol = raw.replace(/^-/, '');
  const m = symbol.match(/^([A-Z]+)(\d{6})([CP])(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const [, ticker, dateStr, typeChar, strikeStr] = m;
  const yy = parseInt(dateStr.slice(0, 2), 10);
  const mm = dateStr.slice(2, 4);
  const dd = dateStr.slice(4, 6);
  return {
    ticker,
    expiration: `${2000 + yy}-${mm}-${dd}`,
    optionType: typeChar === 'C' ? 'call' : 'put',
    strike: parseFloat(strikeStr),
  };
}

export interface ParsedImportRow {
  parsed: Omit<Trade, 'id'>;
  rawSymbol: string;
  commission: number;
  fees: number;
  amount: number;
  selected: boolean;
  duplicate: boolean;
}

export function parseBrokerText(text: string): ParsedImportRow[] {
  const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean);
  const rows: ParsedImportRow[] = [];

  for (const line of lines) {
    const cols = line.split('\t');
    if (cols.length < 10) continue;

    const [symbolRaw, , , priceStr, qtyStr, commStr, feesStr, , amountStr, settlementStr] = cols;
    const symbol = symbolRaw.trim();

    // Skip header row
    if (symbol.toLowerCase() === 'symbol' || symbol.toLowerCase().startsWith('symbol')) continue;

    const qtyNum = parseFloat(qtyStr);
    const price  = Math.abs(parseFloat(priceStr));
    const date   = parseSettlementDate(settlementStr ?? '');

    if (isNaN(qtyNum) || isNaN(price)) continue;

    const optParsed = parseOptionSymbol(symbol);

    if (optParsed) {
      // Negative qty = sold (sell-to-open/short); positive = bought (buy-to-close)
      const action: TradeAction = qtyNum < 0 ? 'open' : 'close';
      rows.push({
        rawSymbol: symbol,
        commission: parseFloat(commStr) || 0,
        fees: parseFloat(feesStr) || 0,
        amount: parseFloat(amountStr) || 0,
        selected: true,
        duplicate: false,
        parsed: {
          date, action,
          ticker: optParsed.ticker,
          assetType: 'option',
          optionType: optParsed.optionType,
          strike: optParsed.strike,
          expiration: optParsed.expiration,
          qty: Math.abs(qtyNum),
          price,
          notes: '',
        },
      });
    } else {
      // Stock trade
      const ticker = symbol.replace(/^-/, '').toUpperCase();
      const action: TradeAction = qtyNum < 0 ? 'sell' : 'buy';
      rows.push({
        rawSymbol: symbol,
        commission: parseFloat(commStr) || 0,
        fees: parseFloat(feesStr) || 0,
        amount: parseFloat(amountStr) || 0,
        selected: true,
        duplicate: false,
        parsed: {
          date, action,
          ticker,
          assetType: 'stock',
          qty: Math.abs(qtyNum),
          price,
          notes: '',
        },
      });
    }
  }
  return rows;
}

function isDuplicate(parsed: Omit<Trade, 'id'>, existing: Trade[]): boolean {
  return existing.some(t =>
    t.date === parsed.date &&
    t.ticker === parsed.ticker &&
    t.qty === parsed.qty &&
    Math.abs(t.price - parsed.price) < 0.005 &&
    t.assetType === parsed.assetType &&
    t.optionType === parsed.optionType &&
    t.strike === parsed.strike
  );
}

// ── ImportModal ───────────────────────────────────────────────────────

interface ImportModalProps {
  onClose: () => void;
  onImport: (trades: Omit<Trade, 'id'>[]) => Promise<void>;
  existingTrades: Trade[];
}

function ImportModal({ onClose, onImport, existingTrades }: ImportModalProps) {
  const [raw, setRaw]       = useState('');
  const [rows, setRows]     = useState<ParsedImportRow[]>([]);
  const [saving, setSaving] = useState(false);

  // Auto-parse whenever text changes
  useEffect(() => {
    if (!raw.trim()) { setRows([]); return; }
    const parsed = parseBrokerText(raw).map(r => ({
      ...r,
      duplicate: isDuplicate(r.parsed, existingTrades),
      selected: !isDuplicate(r.parsed, existingTrades),
    }));
    setRows(parsed);
  }, [raw, existingTrades]);

  const toggleRow = (idx: number) => {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, selected: !r.selected } : r));
  };
  const toggleAll = () => {
    const allOn = rows.every(r => r.selected);
    setRows(prev => prev.map(r => ({ ...r, selected: !allOn })));
  };

  const selected = rows.filter(r => r.selected);

  async function handleImport() {
    if (selected.length === 0) return;
    setSaving(true);
    try {
      await onImport(selected.map(r => r.parsed));
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const actionColor = (a: TradeAction) => ACTION_META[a]?.color ?? '#94a3b8';

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col w-full max-w-3xl mx-4" style={{ maxHeight: '85vh' }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 flex-shrink-0">
          <div>
            <span className="text-sm font-semibold text-white">Import Trades</span>
            <span className="text-xs text-slate-500 ml-3">Paste broker export (tab-separated)</span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', lineHeight: 1 }}
            onMouseEnter={e => (e.currentTarget.style.color = '#e2e8f0')} onMouseLeave={e => (e.currentTarget.style.color = '#64748b')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Paste area */}
        <div className="px-5 pt-4 pb-3 flex-shrink-0">
          <textarea
            value={raw}
            onChange={e => setRaw(e.target.value)}
            placeholder={'Paste your broker transaction history here…\n\nSupports tab-separated formats (Schwab, etc.).\nInclude or exclude the header row — both work.'}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-xs text-slate-300 font-mono resize-none focus:outline-none focus:border-slate-500"
            style={{ height: 100 }}
            spellCheck={false}
          />
        </div>

        {/* Preview */}
        {rows.length > 0 && (
          <div className="flex-1 overflow-y-auto px-5 pb-2 min-h-0">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs text-slate-400 font-medium">{rows.length} rows parsed</span>
              <button onClick={toggleAll} className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors">(toggle all)</button>
              {rows.filter(r => r.duplicate).length > 0 && (
                <span style={{ fontSize: 10, color: '#f59e0b', fontWeight: 600, background: 'rgba(234,179,8,0.1)', padding: '1px 7px', borderRadius: 4 }}>
                  {rows.filter(r => r.duplicate).length} duplicate{rows.filter(r => r.duplicate).length !== 1 ? 's' : ''} deselected
                </span>
              )}
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #334155' }}>
                  {['', 'Date', 'Action', 'Asset', 'Qty', 'Price', 'Total', 'Comm+Fees'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '4px 8px', color: '#64748b', fontWeight: 600, fontSize: 11 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => {
                  const t = row.parsed;
                  const total = t.qty * t.price * (t.assetType === 'option' ? 100 : 1);
                  const asset = t.assetType === 'option'
                    ? `${t.ticker} ${t.optionType?.toUpperCase()} $${t.strike} ${t.expiration?.slice(2).replace(/-/g, '/')}`
                    : t.ticker;
                  return (
                    <tr key={idx} style={{ opacity: row.selected ? 1 : 0.35, borderBottom: '1px solid #1e293b', cursor: 'pointer', backgroundColor: row.duplicate ? 'rgba(234,179,8,0.05)' : undefined }}
                      onClick={() => toggleRow(idx)}>
                      <td style={{ padding: '5px 8px' }}>
                        <input type="checkbox" checked={row.selected} onChange={() => toggleRow(idx)} onClick={e => e.stopPropagation()} style={{ accentColor: '#34d399', cursor: 'pointer' }} />
                      </td>
                      <td style={{ padding: '5px 8px', color: '#94a3b8' }}>{t.date}{row.duplicate && <span style={{fontSize:9, color:'#f59e0b', fontWeight:700, marginLeft:4}}>DUP</span>}</td>
                      <td style={{ padding: '5px 8px' }}>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: ACTION_META[t.action]?.bg, color: actionColor(t.action) }}>
                          {ACTION_META[t.action]?.label}
                        </span>
                      </td>
                      <td style={{ padding: '5px 8px', color: '#e2e8f0', fontWeight: 500 }}>{asset}</td>
                      <td style={{ padding: '5px 8px', color: '#94a3b8' }}>{t.qty}</td>
                      <td style={{ padding: '5px 8px', color: '#94a3b8' }}>${t.price.toFixed(2)}</td>
                      <td style={{ padding: '5px 8px', color: ACTION_META[t.action]?.isInflow ? '#34d399' : '#f87171', fontWeight: 600 }}>
                        {ACTION_META[t.action]?.isInflow ? '+' : '-'}{dollar(total)}
                      </td>
                      <td style={{ padding: '5px 8px', color: '#64748b' }}>{(row.commission + row.fees).toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer */}
        <div className="px-5 py-4 border-t border-slate-800 flex items-center justify-between flex-shrink-0">
          <span className="text-xs text-slate-500">
            {rows.length > 0 ? `${selected.length} of ${rows.length} selected` : 'Paste data above to preview'}
          </span>
          <div className="flex gap-2">
            <button onClick={onClose} style={{ background: 'none', border: '1px solid #334155', borderRadius: 8, padding: '6px 16px', cursor: 'pointer', color: '#64748b', fontSize: 12 }}>
              Cancel
            </button>
            <button onClick={handleImport} disabled={selected.length === 0 || saving}
              style={{ background: selected.length === 0 || saving ? '#1e293b' : '#059669', border: 'none', borderRadius: 8, padding: '6px 16px', cursor: selected.length === 0 || saving ? 'not-allowed' : 'pointer', color: selected.length === 0 || saving ? '#475569' : 'white', fontSize: 12, fontWeight: 600 }}>
              {saving ? 'Importing…' : `Import ${selected.length} Trade${selected.length !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── ClosePositionModal ────────────────────────────────────────────────

interface ClosePositionModalProps {
  trade: Trade;
  onClose: () => void;
  onConfirm: (closing: Omit<Trade, 'id'>) => Promise<void>;
}

function ClosePositionModal({ trade, onClose, onConfirm }: ClosePositionModalProps) {
  const [price, setPrice] = useState('');
  const [date, setDate]   = useState(today());
  const [saving, setSaving] = useState(false);

  const isOption = trade.assetType === 'option';
  const typeColor = trade.optionType === 'call' ? '#34d399' : '#f87171';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!price) return;
    setSaving(true);
    try {
      const closing: Omit<Trade, 'id'> = {
        date,
        action: isOption ? 'close' : 'sell',
        ticker: trade.ticker,
        assetType: trade.assetType,
        optionType: trade.optionType,
        strike: trade.strike,
        expiration: trade.expiration,
        qty: trade.qty,
        price: Number(price),
        notes: '',
      };
      await onConfirm(closing);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const inputCls = 'bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-emerald-500 w-full';
  const labelCls = 'text-xs text-slate-400 font-medium mb-1 block';
  const total = trade.qty * Number(price || 0) * (isOption ? 100 : 1);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <span className="text-sm font-semibold text-white">{isOption ? 'Close Position' : 'Sell Shares'}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', lineHeight: 1 }}
            onMouseEnter={e => (e.currentTarget.style.color = '#e2e8f0')} onMouseLeave={e => (e.currentTarget.style.color = '#64748b')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Position summary */}
        <div className="px-5 pt-4 pb-1">
          <div className="bg-slate-800/60 rounded-xl px-4 py-3 flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <span className="text-base font-bold text-white">{trade.ticker}</span>
              {isOption && (
                <>
                  <span style={{ fontSize: 11, fontWeight: 700, color: typeColor }}>{trade.optionType?.toUpperCase()}</span>
                  <span style={{ fontSize: 12, color: '#94a3b8' }}>${trade.strike} · {trade.expiration?.slice(2).replace(/-/g, '/')}</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-500">{isOption ? `${trade.qty} contract${trade.qty !== 1 ? 's' : ''}` : `${trade.qty} shares`}</span>
              <span className="text-xs text-slate-600">·</span>
              <span className="text-xs text-slate-500">opened @ <span className="text-slate-300">${trade.price.toFixed(2)}</span></span>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} required />
            </div>
            <div>
              <label className={labelCls}>{isOption ? 'Close Price / Contract' : 'Sale Price / Share'}</label>
              <input type="number" min="0" step="any" value={price} onChange={e => setPrice(e.target.value)}
                placeholder="0.00" className={inputCls} required autoFocus />
            </div>
          </div>

          {price && (
            <div className="text-xs text-slate-400 -mt-1">
              Total: <span className="text-slate-200 font-semibold">{dollar(total)}</span>
              {isOption && <span className="text-slate-500"> (× 100)</span>}
              {Number(price) > 0 && (
                <>
                  <span className="text-slate-600 mx-2">·</span>
                  {(() => {
                    const pnl = isOption
                      ? (trade.price - Number(price)) * trade.qty * 100   // sold-to-open: profit when close < open
                      : (Number(price) - trade.price) * trade.qty;         // bought stock: profit when sell > buy
                    return (
                      <span className={pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                        P&amp;L: {dollar(pnl, { sign: true })}
                      </span>
                    );
                  })()}
                </>
              )}
            </div>
          )}

          <button type="submit" disabled={saving || !price}
            className="w-full py-2 rounded-xl text-sm font-semibold transition-colors mt-1"
            style={{ background: saving || !price ? '#334155' : '#059669', color: saving || !price ? '#64748b' : 'white', border: 'none', cursor: saving || !price ? 'not-allowed' : 'pointer' }}>
            {saving ? 'Saving…' : `Log ${isOption ? 'Close' : 'Sell'}`}
          </button>
        </form>
      </div>
    </div>
  );
}

function AddTradeModal({ onClose, onAdd }: AddTradeModalProps) {
  const [date, setDate]             = useState(today());
  const [action, setAction]         = useState<TradeAction>('buy');
  const [ticker, setTicker]         = useState('');
  const [assetType, setAssetType]   = useState<'stock' | 'option'>('stock');
  const [optionType, setOptionType] = useState<'call' | 'put'>('call');
  const [strike, setStrike]         = useState('');
  const [expiration, setExpiration] = useState('');
  const [qty, setQty]               = useState('');
  const [price, setPrice]           = useState('');
  const [notes, setNotes]           = useState('');
  const [saving, setSaving]         = useState(false);

  // Sync action ↔ assetType defaults
  const isOptionAction = action === 'open' || action === 'close' || action === 'expired' || action === 'assigned' || action === 'rolled';
  useEffect(() => {
    if (isOptionAction) setAssetType('option');
    if (action === 'buy' || action === 'sell') setAssetType('stock');
  }, [action, isOptionAction]);

  const isOption = assetType === 'option';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!ticker.trim() || !qty || !price) return;
    setSaving(true);
    try {
      await onAdd({
        date, action, ticker: ticker.trim().toUpperCase(), assetType,
        optionType: isOption ? optionType : undefined,
        strike: isOption && strike ? Number(strike) : undefined,
        expiration: isOption && expiration ? expiration : undefined,
        qty: Number(qty), price: Number(price), notes: notes.trim(),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const inputCls = 'bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-emerald-500 w-full';
  const labelCls = 'text-xs text-slate-400 font-medium mb-1 block';

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-lg mx-4" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <span className="text-sm font-semibold text-white">Log Trade</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', lineHeight: 1 }}
            onMouseEnter={e => (e.currentTarget.style.color = '#e2e8f0')} onMouseLeave={e => (e.currentTarget.style.color = '#64748b')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-4">
          {/* Row 1: Date + Action */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} required />
            </div>
            <div>
              <label className={labelCls}>Action</label>
              <select value={action} onChange={e => setAction(e.target.value as TradeAction)} className={inputCls} style={{ cursor: 'pointer' }}>
                {ACTIONS.map(a => (
                  <option key={a} value={a} style={{ backgroundColor: '#1e293b' }}>
                    {ACTION_META[a].label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Row 2: Ticker + Asset type toggle */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Ticker</label>
              <input type="text" value={ticker} onChange={e => setTicker(e.target.value)} placeholder="AAPL" className={inputCls} required />
            </div>
            <div>
              <label className={labelCls}>Asset Type</label>
              <div className="flex rounded-lg overflow-hidden border border-slate-600" style={{ height: 36 }}>
                {(['stock', 'option'] as const).map(t => (
                  <button key={t} type="button" onClick={() => setAssetType(t)}
                    className="flex-1 text-xs font-semibold transition-colors"
                    style={{ background: assetType === t ? '#3b82f6' : 'transparent', color: assetType === t ? 'white' : '#94a3b8', border: 'none', cursor: 'pointer' }}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Option fields */}
          {isOption && (
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>Type</label>
                <div className="flex rounded-lg overflow-hidden border border-slate-600" style={{ height: 36 }}>
                  {(['call', 'put'] as const).map(t => (
                    <button key={t} type="button" onClick={() => setOptionType(t)}
                      className="flex-1 text-xs font-semibold transition-colors"
                      style={{ background: optionType === t ? (t === 'call' ? '#059669' : '#dc2626') : 'transparent', color: optionType === t ? 'white' : '#94a3b8', border: 'none', cursor: 'pointer' }}>
                      {t.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className={labelCls}>Strike</label>
                <input type="number" min="0" step="0.5" value={strike} onChange={e => setStrike(e.target.value)} placeholder="450" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Expiration</label>
                <input type="date" value={expiration} onChange={e => setExpiration(e.target.value)} className={inputCls} />
              </div>
            </div>
          )}

          {/* Row: Qty + Price */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>{isOption ? 'Contracts' : 'Shares'}</label>
              <input type="number" min="0.0001" step="any" value={qty} onChange={e => setQty(e.target.value)} placeholder="1" className={inputCls} required />
            </div>
            <div>
              <label className={labelCls}>{isOption ? 'Price / Contract' : 'Price / Share'}</label>
              <input type="number" min="0" step="any" value={price} onChange={e => setPrice(e.target.value)} placeholder="0.00" className={inputCls} required />
            </div>
          </div>

          {/* Total preview */}
          {qty && price && (
            <div className="text-xs text-slate-400 -mt-1">
              Total: <span className="text-slate-200 font-semibold">
                {dollar(Number(qty) * Number(price) * (isOption ? 100 : 1))}
              </span>
              {isOption && <span className="text-slate-500"> (× 100)</span>}
            </div>
          )}

          {/* Notes */}
          <div>
            <label className={labelCls}>Notes</label>
            <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional…" className={inputCls} />
          </div>

          {/* Submit */}
          <button type="submit" disabled={saving}
            className="w-full py-2 rounded-xl text-sm font-semibold transition-colors mt-1"
            style={{ background: saving ? '#334155' : '#059669', color: saving ? '#64748b' : 'white', border: 'none', cursor: saving ? 'wait' : 'pointer' }}>
            {saving ? 'Saving…' : 'Log Trade'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── TradesPanel ───────────────────────────────────────────────────────

interface Props {
  activeAccountId: string | null;
}

export function TradesPanel({ activeAccountId }: Props) {
  const [trades, setTrades]               = useState<Trade[]>([]);
  const [loading, setLoading]             = useState(true);
  const [showAdd, setShowAdd]             = useState(false);
  const [showImport, setShowImport]       = useState(false);
  const [dateRange, setDateRange]         = useState<DateRange>('all');
  const [closingTrade, setClosingTrade]   = useState<Trade | null>(null);
  const [showChart, setShowChart]         = useState(false);

  const fetchTrades = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/trades');
      const data: unknown = await res.json();
      setTrades(Array.isArray(data) ? (data as Trade[]) : []);
    } catch {
      setTrades([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTrades(); }, [fetchTrades, activeAccountId]);

  const handleAdd = useCallback(async (trade: Omit<Trade, 'id'>) => {
    await fetch('/api/trades', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(trade) });
    await fetchTrades();
  }, [fetchTrades]);

  const handleImport = useCallback(async (imported: Omit<Trade, 'id'>[]) => {
    await fetch('/api/trades/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(imported),
    });
    await fetchTrades();
  }, [fetchTrades]);

  const handleDelete = useCallback(async (id: string) => {
    await fetch(`/api/trades/${id}`, { method: 'DELETE' });
    setTrades(prev => prev.filter(t => t.id !== id));
  }, []);

  const handleClosePosition = useCallback((trade: Trade) => {
    setClosingTrade(trade);
  }, []);

  const gridCtx     = useMemo(() => ({ onDelete: handleDelete }), [handleDelete]);
  const openGridCtx = useMemo(() => ({ onDelete: handleDelete, onClosePosition: handleClosePosition }), [handleDelete, handleClosePosition]);

  const fifoMap   = useMemo(() => buildFIFOPnL(trades), [trades]);

  // Compute rows with P&L
  const rows = useMemo(() => trades.map(t => ({
    ...t,
    total: tradeTotal(t),
    pnl: fifoMap.get(t.id) ?? null,
    _isOpen: isOpenPosition(t, trades),
  })), [trades, fifoMap]);

  // Apply date range filter for display (P&L matching still uses all trades above)
  const filteredRows = useMemo(() => {
    const cutoff = getDateCutoff(dateRange);
    if (!cutoff) return rows;
    return rows.filter(r => r.date >= cutoff);
  }, [rows, dateRange]);

  const openRows   = useMemo(() => filteredRows.filter(r => r._isOpen), [filteredRows]);
  const closedRows = useMemo(() => filteredRows.filter(r => !r._isOpen), [filteredRows]);

  // Summary footer (reflects filtered view)
  const totalRealized = useMemo(() => filteredRows.reduce((s, r) => s + (r.pnl ?? 0), 0), [filteredRows]);
  const totalOutflows = useMemo(() => filteredRows.filter(r => !ACTION_META[r.action].isInflow).reduce((s, r) => s + r.total, 0), [filteredRows]);
  const totalInflows  = useMemo(() => filteredRows.filter(r =>  ACTION_META[r.action].isInflow).reduce((s, r) => s + r.total, 0), [filteredRows]);

  type TradeRow = (typeof rows)[number];

  const defaultColDef = useMemo<ColDef>(() => ({ resizable: true, sortable: true, suppressHeaderMenuButton: true }), []);

  const cols = useMemo<ColDef<TradeRow>[]>(() => [
    { field: 'date',   headerName: 'Date',    width: 105, sort: 'desc' },
    { field: 'action', headerName: 'Action',  width: 95,  cellRenderer: ActionCell },
    { headerName: 'Asset', width: 220, cellRenderer: AssetCell, valueGetter: p => `${p.data?.ticker} ${p.data?.optionType ?? ''}` },
    { field: 'qty',    headerName: 'Qty',     width: 70,  valueFormatter: p => p.value?.toLocaleString() },
    { field: 'price',  headerName: 'Price',   width: 88,  valueFormatter: p => p.data ? (p.data.assetType === 'option' ? `$${p.value?.toFixed(2)}/c` : `$${p.value?.toFixed(2)}`) : '' },
    { field: 'total',  headerName: 'Total',   width: 110, cellRenderer: TotalCell },
    { field: 'pnl',    headerName: 'Realized P&L', width: 115, cellRenderer: PnLCell },
    { field: 'notes',  headerName: 'Notes',   flex: 1, minWidth: 80, cellStyle: { color: '#64748b', fontSize: '12px' } },
    { headerName: '', width: 40, sortable: false, resizable: false, cellRenderer: DeleteCell },
  ], []);

  const openCols = useMemo<ColDef<TradeRow>[]>(() => [
    { field: 'date',   headerName: 'Date',    width: 105, sort: 'desc' },
    { field: 'action', headerName: 'Action',  width: 95,  cellRenderer: ActionCell },
    { headerName: 'Asset', width: 220, cellRenderer: AssetCell, valueGetter: p => `${p.data?.ticker} ${p.data?.optionType ?? ''}` },
    { field: 'qty',    headerName: 'Qty',     width: 70,  valueFormatter: p => p.value?.toLocaleString() },
    { field: 'price',  headerName: 'Price',   width: 88,  valueFormatter: p => p.data ? (p.data.assetType === 'option' ? `$${p.value?.toFixed(2)}/c` : `$${p.value?.toFixed(2)}`) : '' },
    { field: 'total',  headerName: 'Total',   width: 110, cellRenderer: TotalCell },
    { field: 'notes',  headerName: 'Notes',   flex: 1, minWidth: 80, cellStyle: { color: '#64748b', fontSize: '12px' } },
    { headerName: 'DTE', width: 60, sortable: true, resizable: true, suppressHeaderMenuButton: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      valueGetter: (p: any) => p.data?.assetType === 'option' && p.data.expiration ? dteFromExpiry(p.data.expiration) : null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cellStyle: (p: any) => p.value == null ? { color: '#334155', fontWeight: 400 } : p.value <= 7 ? { color: '#ef4444', fontWeight: 700 } : p.value <= 14 ? { color: '#f59e0b', fontWeight: 600 } : { color: '#64748b', fontWeight: 400 },
    },
    { headerName: '', width: 72, sortable: false, resizable: false, cellRenderer: CloseCell },
    { headerName: '', width: 40, sortable: false, resizable: false, cellRenderer: DeleteCell },
  ], []);

  const stats = useMemo(() => computeStats(filteredRows), [filteredRows]);

  const summaryRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex flex-col h-full bg-slate-950">
      {/* Header bar */}
      <div className="px-5 py-3 flex items-center gap-3 border-b border-slate-800 flex-shrink-0">
        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Trade Log</span>
        <div className="h-px bg-slate-800" style={{ width: 12 }} />
        {/* Date range pills */}
        <div className="flex items-center gap-1">
          {DATE_RANGES.map(r => (
            <button
              key={r}
              onClick={() => setDateRange(r)}
              style={{
                padding: '2px 9px',
                borderRadius: 5,
                border: dateRange === r ? '1px solid rgba(99,102,241,0.6)' : '1px solid transparent',
                background: dateRange === r ? 'rgba(99,102,241,0.18)' : 'transparent',
                color: dateRange === r ? '#a5b4fc' : '#475569',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.12s',
              }}
              onMouseEnter={e => { if (dateRange !== r) e.currentTarget.style.color = '#94a3b8'; }}
              onMouseLeave={e => { if (dateRange !== r) e.currentTarget.style.color = '#475569'; }}
            >
              {DATE_RANGE_LABELS[r]}
            </button>
          ))}
        </div>
        <div className="flex-1 h-px bg-slate-800" />
        {filteredRows.length > 0 && (
          <button
            onClick={() => setShowChart(v => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: 4, background: showChart ? 'rgba(99,102,241,0.18)' : 'rgba(71,85,105,0.15)', border: showChart ? '1px solid rgba(99,102,241,0.6)' : '1px solid rgba(71,85,105,0.4)', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', color: showChart ? '#a5b4fc' : '#94a3b8', fontSize: 12, fontWeight: 700 }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            Chart
          </button>
        )}
        {filteredRows.length > 0 && (
          <button
            onClick={() => exportCSV(filteredRows, `trades-${new Date().toISOString().slice(0,10)}.csv`)}
            style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(71,85,105,0.15)', border: '1px solid rgba(71,85,105,0.4)', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', color: '#94a3b8', fontSize: 12, fontWeight: 700 }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(71,85,105,0.3)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(71,85,105,0.15)')}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            CSV
          </button>
        )}
        <button
          onClick={() => setShowImport(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(71,85,105,0.15)', border: '1px solid rgba(71,85,105,0.4)', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', color: '#94a3b8', fontSize: 12, fontWeight: 700 }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(71,85,105,0.3)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'rgba(71,85,105,0.15)')}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          Import
        </button>
        <button
          onClick={() => setShowAdd(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(5,150,105,0.15)', border: '1px solid rgba(5,150,105,0.4)', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', color: '#34d399', fontSize: 12, fontWeight: 700 }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(5,150,105,0.3)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'rgba(5,150,105,0.15)')}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Log Trade
        </button>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {loading ? (
          <div className="flex items-center justify-center h-full text-slate-500 text-sm">Loading…</div>
        ) : trades.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-500">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-slate-700">
              <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" />
              <line x1="9" y1="12" x2="15" y2="12" /><line x1="9" y1="16" x2="13" y2="16" />
            </svg>
            <span className="text-sm">No trades logged yet</span>
            <button onClick={() => setShowAdd(true)}
              className="text-xs text-emerald-400 hover:text-emerald-300 font-medium transition-colors">
              Log your first trade →
            </button>
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-slate-500">
            <span className="text-sm">No trades in this period</span>
            <button onClick={() => setDateRange('all')} className="text-xs text-indigo-400 hover:text-indigo-300 font-medium transition-colors">
              Show all trades →
            </button>
          </div>
        ) : (
          <>
            {/* ── Chart ── */}
            {showChart && (
              <div className="flex-shrink-0 border-b border-slate-800 px-2 bg-slate-950/80" style={{ maxHeight: 200 }}>
                <PnLChart trades={filteredRows} />
              </div>
            )}

            {/* ── Stats bar ── */}
            {stats && (
              <div className="flex-shrink-0 flex items-center gap-5 px-5 py-1.5 border-b border-slate-800 bg-slate-900/40 overflow-x-auto" style={{ fontSize: 11 }}>
                <span style={{ color: '#475569', fontWeight: 600, whiteSpace: 'nowrap' }}>{stats.count} closed</span>
                <span style={{ color: stats.winRate >= 0.5 ? '#34d399' : '#f87171', fontWeight: 700, whiteSpace: 'nowrap' }}>
                  Win {(stats.winRate * 100).toFixed(0)}%
                </span>
                <span style={{ color: '#64748b', whiteSpace: 'nowrap' }}>Avg W <span style={{ color: '#34d399' }}>{dollar(stats.avgWin, { sign: true })}</span></span>
                <span style={{ color: '#64748b', whiteSpace: 'nowrap' }}>Avg L <span style={{ color: '#f87171' }}>{dollar(stats.avgLoss, { sign: true })}</span></span>
                <span style={{ color: '#64748b', whiteSpace: 'nowrap' }}>Best <span style={{ color: '#34d399' }}>{dollar(stats.largestWin, { sign: true })}</span></span>
                <span style={{ color: '#64748b', whiteSpace: 'nowrap' }}>Worst <span style={{ color: '#f87171' }}>{dollar(stats.largestLoss, { sign: true })}</span></span>
              </div>
            )}

            {/* ── Open Positions ── */}
            <div className="flex-shrink-0 border-b border-slate-800" style={{ height: openRows.length > 0 ? Math.min(openRows.length * 44 + 34 + 28, 320) : 28 }}>
              <div className="flex items-center gap-2 px-4" style={{ height: 28, background: 'rgba(52,211,153,0.04)', borderBottom: openRows.length > 0 ? '1px solid #1e293b' : 'none' }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: '#34d399', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Open Positions</span>
                <span style={{ fontSize: 10, color: '#475569', fontWeight: 600 }}>{openRows.length}</span>
              </div>
              {openRows.length > 0 && (
                <div style={{ height: Math.min(openRows.length * 44 + 34, 292) }}>
                  <AgGridReact<TradeRow>
                    theme={darkTheme}
                    rowData={openRows}
                    columnDefs={openCols}
                    defaultColDef={defaultColDef}
                    rowHeight={44}
                    headerHeight={34}
                    animateRows
                    context={openGridCtx}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    getRowStyle={(p: any) => {
                      if (p.data?.assetType !== 'option' || !p.data.expiration) return undefined;
                      const dte = dteFromExpiry(p.data.expiration);
                      if (dte <= 7)  return { background: 'rgba(239,68,68,0.10)', borderLeft: '3px solid rgba(239,68,68,0.5)' };
                      if (dte <= 14) return { background: 'rgba(245,158,11,0.07)', borderLeft: '3px solid rgba(245,158,11,0.4)' };
                      return undefined;
                    }}
                  />
                </div>
              )}
            </div>

            {/* ── Closed / History ── */}
            <div className="flex flex-col flex-1 overflow-hidden">
              <div className="flex items-center gap-2 px-4 flex-shrink-0" style={{ height: 28, background: 'rgba(15,23,42,0.6)', borderBottom: '1px solid #1e293b' }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Closed / History</span>
                <span style={{ fontSize: 10, color: '#334155', fontWeight: 600 }}>{closedRows.length}</span>
              </div>
              <div className="flex-1">
                <AgGridReact<TradeRow>
                  theme={darkTheme}
                  rowData={closedRows}
                  columnDefs={cols}
                  defaultColDef={defaultColDef}
                  rowHeight={44}
                  headerHeight={34}
                  animateRows
                  context={gridCtx}
                />
              </div>
            </div>
          </>
        )}
      </div>

      {/* Summary footer */}
      {filteredRows.length > 0 && (
        <div ref={summaryRef} className="px-5 py-2 border-t border-slate-800 flex items-center gap-6 flex-shrink-0 bg-slate-900/60">
          <span className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">{filteredRows.length} trade{filteredRows.length !== 1 ? 's' : ''}</span>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-slate-500">Outflows</span>
            <span className="text-[11px] font-semibold text-red-400">-{dollar(totalOutflows)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-slate-500">Inflows</span>
            <span className="text-[11px] font-semibold text-emerald-400">+{dollar(totalInflows)}</span>
          </div>
          {totalRealized !== 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-slate-500">Realized P&amp;L</span>
              <span className={`text-[11px] font-semibold ${totalRealized >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {dollar(totalRealized, { sign: true })}
              </span>
            </div>
          )}
        </div>
      )}

      {showAdd    && <AddTradeModal  onClose={() => setShowAdd(false)}   onAdd={handleAdd}       />}
      {showImport && <ImportModal    onClose={() => setShowImport(false)} onImport={handleImport} existingTrades={trades} />}
      {closingTrade && (
        <ClosePositionModal
          trade={closingTrade}
          onClose={() => setClosingTrade(null)}
          onConfirm={handleAdd}
        />
      )}
    </div>
  );
}
