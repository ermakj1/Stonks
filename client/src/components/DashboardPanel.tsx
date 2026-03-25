import { useState, useEffect, useMemo, useCallback } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts';
import type { Holdings, PricesResponse, UnrealizedPosition } from '../types';

interface Trade {
  id: string;
  date: string;
  action: string;
  ticker: string;
  assetType: 'stock' | 'option';
  optionType?: string;
  strike?: number;
  expiration?: string;
  qty: number;
  price: number;
  notes: string;
}

interface Props {
  holdings: Holdings | null;
  prices: PricesResponse | null;
  pricesLoading: boolean;
  activeAccountId: string | null;
}

function dollar(n: number, opts?: { sign?: boolean; decimals?: number }) {
  const dec = opts?.decimals ?? 0;
  const s = Math.abs(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: dec, maximumFractionDigits: dec });
  if (!opts?.sign) return s;
  return n < 0 ? `-${s}` : `+${s}`;
}

// FIFO P&L engine (mirrors TradesPanel logic)
function buildFIFOPnL(trades: Trade[]): Map<string, number> {
  const sorted = [...trades].sort((a, b) => a.date.localeCompare(b.date));
  const lots = new Map<string, { price: number; qty: number }[]>();
  const pnlMap = new Map<string, number>();

  const key = (t: Trade) => t.assetType === 'option'
    ? `${t.ticker}-${t.optionType}-${t.strike}-${t.expiration}`
    : `${t.ticker}-stock`;

  for (const t of sorted) {
    const k = key(t);
    if (t.action === 'open' || (t.action === 'buy' && t.assetType === 'stock')) {
      const q = lots.get(k) ?? [];
      q.push({ price: t.price, qty: t.qty });
      lots.set(k, q);
    } else if (
      t.action === 'close' || t.action === 'expired' || t.action === 'assigned' ||
      (t.action === 'sell' && t.assetType === 'stock')
    ) {
      const q = lots.get(k) ?? [];
      let rem = t.qty; let pnl = 0;
      while (rem > 0 && q.length > 0) {
        const lot = q[0];
        const c = Math.min(rem, lot.qty);
        if (t.action === 'expired')                          pnl += -(lot.price * c * 100);
        else if (t.action === 'close' || t.action === 'assigned') pnl += (lot.price - t.price) * c * 100;
        else                                                  pnl += (t.price - lot.price) * c;
        lot.qty -= c; rem -= c;
        if (lot.qty <= 0) q.shift();
      }
      lots.set(k, q);
      pnlMap.set(t.id, pnl);
    }
  }
  return pnlMap;
}

const TICKER_COLORS = ['#818cf8','#34d399','#60a5fa','#f472b6','#fb923c','#a78bfa','#22d3ee','#fbbf24','#4ade80','#f87171'];

const ACTION_COLORS: Record<string, string> = {
  buy: '#60a5fa', sell: '#34d399', open: '#818cf8', close: '#34d399',
  expired: '#fb923c', assigned: '#a78bfa', rolled: '#22d3ee',
};

function StatCard({ label, value, sub, color, loading }: { label: string; value: string; sub?: string; color?: string; loading?: boolean }) {
  return (
    <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: '16px 20px', minWidth: 0 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>{label}</div>
      {loading
        ? <div style={{ height: 26, background: '#1e293b', borderRadius: 4, width: '55%' }} />
        : <div style={{ fontSize: 22, fontWeight: 700, color: color ?? '#e2e8f0', lineHeight: 1.2 }}>{value}</div>
      }
      {sub && !loading && <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

export function DashboardPanel({ holdings, prices, pricesLoading, activeAccountId }: Props) {
  const [trades, setTrades]               = useState<Trade[]>([]);
  const [tradesLoading, setTradesLoading] = useState(true);
  const [unrealized, setUnrealized]       = useState<UnrealizedPosition[]>([]);
  const [unLoading, setUnLoading]         = useState(true);

  const fetchData = useCallback(async () => {
    setTradesLoading(true);
    setUnLoading(true);
    try {
      const [trRes, unRes] = await Promise.all([fetch('/api/trades'), fetch('/api/positions/unrealized')]);
      const trData: unknown = await trRes.json();
      const unData: unknown = await unRes.json();
      setTrades(Array.isArray(trData) ? (trData as Trade[]) : []);
      setUnrealized(Array.isArray(unData) ? (unData as UnrealizedPosition[]) : []);
    } catch { /* ignore */ } finally {
      setTradesLoading(false);
      setUnLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData, activeAccountId]);

  const priceMap = useMemo(() => new Map((prices?.stocks ?? []).map(s => [s.ticker, s])), [prices]);

  // Stock positions
  const stockPositions = useMemo(() => {
    if (!holdings?.stocks) return [];
    return Object.entries(holdings.stocks)
      .filter(([t, s]) => s.shares > 0 && !['$CASH', '$OTHER'].includes(t))
      .map(([ticker, s]) => {
        const q = priceMap.get(ticker);
        const cur = q?.price ?? 0;
        const mv = cur * s.shares;
        const cost = s.cost_basis * s.shares;
        return {
          ticker,
          shares: s.shares,
          costBasis: s.cost_basis,
          target: s.target_allocation_pct ?? 0,
          currentPrice: cur,
          marketValue: mv,
          gain: mv - cost,
          gainPct: cost > 0 ? ((mv - cost) / cost) * 100 : 0,
          todayChange: (q?.change ?? 0) * s.shares,
          changePct: q?.changePercent ?? 0,
        };
      })
      .sort((a, b) => b.marketValue - a.marketValue);
  }, [holdings, priceMap]);

  const totalStockValue  = useMemo(() => stockPositions.reduce((s, p) => s + p.marketValue, 0), [stockPositions]);
  const totalCost        = useMemo(() => stockPositions.reduce((s, p) => s + p.costBasis * p.shares, 0), [stockPositions]);
  const totalStockGain   = totalStockValue - totalCost;
  const totalTodayChange = useMemo(() => stockPositions.reduce((s, p) => s + p.todayChange, 0), [stockPositions]);

  const fifoMap       = useMemo(() => buildFIFOPnL(trades), [trades]);
  const totalRealized = useMemo(() => [...fifoMap.values()].reduce((s, p) => s + p, 0), [fifoMap]);
  const totalUnrealized = useMemo(() => unrealized.reduce((s, p) => s + (p.unrealizedGain ?? 0), 0), [unrealized]);

  const recentTrades = useMemo(() => [...trades].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6), [trades]);
  const closedCount  = useMemo(() => trades.filter(t => ['close','sell','expired','assigned'].includes(t.action)).length, [trades]);

  const isLoading = pricesLoading && !prices;
  const openOptions = unrealized.filter(p => p.assetType === 'option');

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: '#020617', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── Summary cards ── */}
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>Portfolio Overview</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <StatCard
            label="Stock Value"
            value={dollar(totalStockValue)}
            sub={totalStockGain !== 0 ? `${dollar(totalStockGain, { sign: true, decimals: 0 })} total gain` : undefined}
            color="#e2e8f0"
            loading={isLoading}
          />
          <StatCard
            label="Today's Change"
            value={dollar(totalTodayChange, { sign: true })}
            sub={totalStockValue > 0 ? `${((totalTodayChange / totalStockValue) * 100).toFixed(2)}% of portfolio` : undefined}
            color={totalTodayChange >= 0 ? '#34d399' : '#f87171'}
            loading={isLoading}
          />
          <StatCard
            label="Realized P&L"
            value={dollar(totalRealized, { sign: true, decimals: 2 })}
            sub={`${closedCount} closed trade${closedCount !== 1 ? 's' : ''}`}
            color={totalRealized >= 0 ? '#34d399' : '#f87171'}
            loading={tradesLoading}
          />
          <StatCard
            label="Unrealized (Options)"
            value={dollar(totalUnrealized, { sign: true, decimals: 2 })}
            sub={`${unrealized.filter(p => p.unrealizedGain != null).length} position${unrealized.length !== 1 ? 's' : ''} priced`}
            color={totalUnrealized >= 0 ? '#34d399' : '#f87171'}
            loading={unLoading}
          />
        </div>
      </div>

      {/* ── Stock positions + allocation ── */}
      {stockPositions.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: 12 }}>

          {/* Positions table */}
          <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '10px 16px', borderBottom: '1px solid #1e293b', fontSize: 10, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Stock Positions
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #1e293b' }}>
                  {['Ticker','Shares','Cost','Price','Value','Gain / Loss','Today'].map(h => (
                    <th key={h} style={{ textAlign: h === 'Ticker' ? 'left' : 'right', padding: '7px 12px', color: '#475569', fontWeight: 600, fontSize: 11 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stockPositions.map((p, i) => (
                  <tr key={p.ticker} style={{ borderBottom: '1px solid #0a0f1a', cursor: 'default' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#111827')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <td style={{ padding: '9px 12px' }}>
                      <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: TICKER_COLORS[i % TICKER_COLORS.length], marginRight: 6 }} />
                      <span style={{ fontWeight: 700, color: '#e2e8f0' }}>{p.ticker}</span>
                    </td>
                    <td style={{ padding: '9px 12px', textAlign: 'right', color: '#94a3b8' }}>{p.shares.toLocaleString()}</td>
                    <td style={{ padding: '9px 12px', textAlign: 'right', color: '#64748b' }}>${p.costBasis.toFixed(2)}</td>
                    <td style={{ padding: '9px 12px', textAlign: 'right' }}>
                      <span style={{ color: '#e2e8f0', fontWeight: 500 }}>${p.currentPrice.toFixed(2)}</span>
                      <span style={{ fontSize: 10, marginLeft: 4, color: p.changePct >= 0 ? '#34d399' : '#f87171' }}>
                        {p.changePct >= 0 ? '+' : ''}{p.changePct.toFixed(2)}%
                      </span>
                    </td>
                    <td style={{ padding: '9px 12px', textAlign: 'right', color: '#e2e8f0', fontWeight: 600 }}>{dollar(p.marketValue)}</td>
                    <td style={{ padding: '9px 12px', textAlign: 'right', color: p.gain >= 0 ? '#34d399' : '#f87171', fontWeight: 600 }}>
                      {dollar(p.gain, { sign: true, decimals: 2 })}
                      <span style={{ fontSize: 10, marginLeft: 3, opacity: 0.7 }}>({p.gainPct >= 0 ? '+' : ''}{p.gainPct.toFixed(1)}%)</span>
                    </td>
                    <td style={{ padding: '9px 12px', textAlign: 'right', color: p.todayChange >= 0 ? '#34d399' : '#f87171' }}>
                      {dollar(p.todayChange, { sign: true, decimals: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>
              {stockPositions.length > 1 && (
                <tfoot>
                  <tr style={{ borderTop: '1px solid #1e293b' }}>
                    <td style={{ padding: '7px 12px', color: '#475569', fontSize: 11, fontWeight: 600 }}>Total</td>
                    <td /><td /><td />
                    <td style={{ padding: '7px 12px', textAlign: 'right', color: '#e2e8f0', fontWeight: 700 }}>{dollar(totalStockValue)}</td>
                    <td style={{ padding: '7px 12px', textAlign: 'right', color: totalStockGain >= 0 ? '#34d399' : '#f87171', fontWeight: 700 }}>
                      {dollar(totalStockGain, { sign: true, decimals: 2 })}
                    </td>
                    <td style={{ padding: '7px 12px', textAlign: 'right', color: totalTodayChange >= 0 ? '#34d399' : '#f87171', fontWeight: 700 }}>
                      {dollar(totalTodayChange, { sign: true, decimals: 2 })}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Allocation */}
          <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '10px 16px', borderBottom: '1px solid #1e293b', fontSize: 10, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Allocation
            </div>
            <div style={{ padding: '12px 16px', flex: 1 }}>
              {stockPositions.map((p, i) => {
                const pct = totalStockValue > 0 ? (p.marketValue / totalStockValue) * 100 : 0;
                return (
                  <div key={p.ticker} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#e2e8f0' }}>{p.ticker}</span>
                      <span style={{ fontSize: 11, color: '#64748b' }}>{pct.toFixed(1)}%</span>
                    </div>
                    <div style={{ height: 5, background: '#1e293b', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: TICKER_COLORS[i % TICKER_COLORS.length], borderRadius: 3 }} />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Target vs actual bar chart */}
            {stockPositions.some(p => p.target > 0) && (
              <div style={{ borderTop: '1px solid #1e293b', padding: '10px 8px 8px' }}>
                <div style={{ fontSize: 10, color: '#334155', fontWeight: 600, marginBottom: 6, paddingLeft: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Actual <span style={{ color: '#818cf8' }}>■</span> vs Target <span style={{ color: '#1e3a5f' }}>■</span>
                </div>
                <ResponsiveContainer width="100%" height={100}>
                  <BarChart
                    data={stockPositions.map(p => ({
                      t: p.ticker,
                      actual: totalStockValue > 0 ? parseFloat(((p.marketValue / totalStockValue) * 100).toFixed(1)) : 0,
                      target: p.target,
                    }))}
                    margin={{ top: 0, right: 4, left: -20, bottom: 0 }}
                    barSize={7} barGap={1}
                  >
                    <XAxis dataKey="t" tick={{ fill: '#475569', fontSize: 9 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#334155', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
                    <Tooltip
                      contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 6, fontSize: 11 }}
                      formatter={(v, name) => [`${Number(v ?? 0)}%`, name === 'actual' ? 'Actual' : 'Target']}
                    />
                    <Bar dataKey="actual" fill="#818cf8" radius={[2,2,0,0]} />
                    <Bar dataKey="target" fill="#1e3a5f" radius={[2,2,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Open option positions ── */}
      {openOptions.length > 0 && (
        <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '10px 16px', borderBottom: '1px solid #1e293b', fontSize: 10, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Open Option Positions
            {unLoading && <span style={{ fontWeight: 400, color: '#334155', fontStyle: 'italic', marginLeft: 8 }}>fetching prices…</span>}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1e293b' }}>
                {['Contract','Qty','Avg Open','Current','Unrealized'].map(h => (
                  <th key={h} style={{ textAlign: h === 'Contract' ? 'left' : 'right', padding: '7px 12px', color: '#475569', fontWeight: 600, fontSize: 11 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {openOptions.map(p => {
                const tc = p.optionType === 'call' ? '#34d399' : '#f87171';
                return (
                  <tr key={p.id} style={{ borderBottom: '1px solid #0a0f1a' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#111827')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <td style={{ padding: '9px 12px' }}>
                      <span style={{ fontWeight: 700, color: '#e2e8f0', marginRight: 6 }}>{p.ticker}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, color: tc, marginRight: 4 }}>{p.optionType?.toUpperCase()}</span>
                      <span style={{ color: '#64748b', fontSize: 11 }}>${p.strike} · {p.expiration?.slice(2).replace(/-/g,'/')}</span>
                    </td>
                    <td style={{ padding: '9px 12px', textAlign: 'right', color: '#94a3b8' }}>{p.netQty}</td>
                    <td style={{ padding: '9px 12px', textAlign: 'right', color: '#64748b' }}>${p.avgCostBasis.toFixed(2)}/c</td>
                    <td style={{ padding: '9px 12px', textAlign: 'right', color: '#e2e8f0' }}>
                      {p.currentPrice != null ? `$${p.currentPrice.toFixed(2)}/c` : <span style={{ color: '#334155' }}>—</span>}
                    </td>
                    <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 600, color: p.unrealizedGain == null ? '#334155' : p.unrealizedGain >= 0 ? '#34d399' : '#f87171' }}>
                      {p.unrealizedGain != null ? dollar(p.unrealizedGain, { sign: true, decimals: 2 }) : '—'}
                      {p.unrealizedGainPct != null && (
                        <span style={{ fontSize: 10, marginLeft: 3, opacity: 0.7 }}>({p.unrealizedGainPct >= 0 ? '+' : ''}{p.unrealizedGainPct.toFixed(1)}%)</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Recent trades ── */}
      {recentTrades.length > 0 && (
        <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '10px 16px', borderBottom: '1px solid #1e293b', fontSize: 10, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Recent Activity
          </div>
          {recentTrades.map(t => {
            const color = ACTION_COLORS[t.action] ?? '#94a3b8';
            const asset = t.assetType === 'option'
              ? `${t.ticker} ${t.optionType?.toUpperCase()} $${t.strike} ${t.expiration?.slice(2).replace(/-/g,'/')}`
              : t.ticker;
            const total = t.qty * t.price * (t.assetType === 'option' ? 100 : 1);
            return (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', borderBottom: '1px solid #0a0f1a' }}>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: `${color}1a`, color, textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0 }}>
                  {t.action}
                </span>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{asset}</span>
                <span style={{ fontSize: 11, color: '#64748b', flexShrink: 0 }}>×{t.qty} @ ${t.price.toFixed(2)}</span>
                <span style={{ fontSize: 11, color: '#94a3b8', flexShrink: 0 }}>{dollar(total, { decimals: 2 })}</span>
                <span style={{ fontSize: 10, color: '#334155', flexShrink: 0 }}>{t.date}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && stockPositions.length === 0 && trades.length === 0 && !unLoading && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#475569', paddingTop: 60 }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: '#1e293b' }}>
            <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8m-4-4v4"/>
          </svg>
          <span style={{ fontSize: 13 }}>No portfolio data yet</span>
          <span style={{ fontSize: 11, color: '#334155' }}>Add holdings or log trades to see your dashboard</span>
        </div>
      )}

      <div style={{ height: 8, flexShrink: 0 }} />
    </div>
  );
}
