import { useMemo } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';
import type { Trade } from '../types';

// Same P&L logic used in TradesPanel — keep in sync
function tradeTotal(t: Trade) {
  return t.qty * t.price * (t.assetType === 'option' ? 100 : 1);
}

interface Props {
  trades: Trade[];
}

function dollar(n: number) {
  return (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export function PnLChart({ trades }: Props) {
  const data = useMemo(() => {
    // Build a simple cumulative P&L by date using closed/sell trade values
    // We approximate P&L using inflow/outflow matching per day
    // Group by date, accumulate net realized P&L
    const ACTION_INFLOW = new Set(['sell', 'open', 'assigned', 'rolled']);
    const ACTION_OUTFLOW = new Set(['buy', 'close', 'expired']);

    // Collect all dates with realized P&L
    const byDate = new Map<string, number>();
    for (const t of trades) {
      const total = tradeTotal(t);
      if (ACTION_INFLOW.has(t.action)) {
        byDate.set(t.date, (byDate.get(t.date) ?? 0) + total);
      } else if (ACTION_OUTFLOW.has(t.action)) {
        byDate.set(t.date, (byDate.get(t.date) ?? 0) - total);
      }
    }

    const sorted = [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    let cum = 0;
    return sorted.map(([date, pnl]) => {
      cum += pnl;
      return { date: date.slice(2).replace(/-/g, '/'), cumPnL: Math.round(cum) };
    });
  }, [trades]);

  if (data.length === 0) {
    return (
      <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', fontSize: 13 }}>
        No trade data to chart
      </div>
    );
  }

  const finalPnL = data[data.length - 1]?.cumPnL ?? 0;
  const lineColor = finalPnL >= 0 ? '#34d399' : '#f87171';

  return (
    <div style={{ height: 180, padding: '8px 0 0 0' }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 24, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="date" tick={{ fill: '#475569', fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
          <YAxis tickFormatter={dollar} tick={{ fill: '#475569', fontSize: 10 }} axisLine={false} tickLine={false} width={72} />
          <ReferenceLine y={0} stroke="#334155" strokeDasharray="4 2" />
          <Tooltip
            contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: '#94a3b8' }}
            formatter={(v) => [dollar(Number(v ?? 0)), 'Cumulative P&L']}
          />
          <Line type="monotone" dataKey="cumPnL" stroke={lineColor} strokeWidth={2} dot={false} activeDot={{ r: 4, fill: lineColor }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
