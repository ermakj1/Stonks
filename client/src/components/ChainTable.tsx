import React from 'react';

export interface FilteredContract {
  type:         'call' | 'put';
  strike:       number;
  expiry:       string;
  dte:          number;
  bid:          number;
  ask:          number;
  mid:          number;
  iv:           number;
  delta:        number;
  volume:       number;
  openInterest: number;
}

export interface ChainResult {
  contracts:       FilteredContract[];
  formattedText:   string;
  underlyingPrice: number | null;
  params: {
    ticker:     string;
    type:       string;
    dteMin:     number;
    dteMax:     number;
    otmOnly:    boolean;
    maxResults: number;
  };
}

function deltaColor(delta: number, type: 'call' | 'put'): string {
  const abs = Math.abs(delta);
  if (abs >= 0.5) return type === 'call' ? '#34d399' : '#f87171';
  if (abs >= 0.25) return '#fbbf24';
  return '#94a3b8';
}

export function ChainTable({ contracts, underlyingPrice }: {
  contracts:       FilteredContract[];
  underlyingPrice: number | null;
}) {
  // Group by expiry, preserving order
  const expiries: string[] = [];
  const byExpiry = new Map<string, FilteredContract[]>();
  for (const c of contracts) {
    if (!byExpiry.has(c.expiry)) { expiries.push(c.expiry); byExpiry.set(c.expiry, []); }
    byExpiry.get(c.expiry)!.push(c);
  }

  const th: React.CSSProperties = {
    padding: '5px 10px', textAlign: 'right', fontSize: 10, fontWeight: 700,
    color: '#475569', textTransform: 'uppercase', letterSpacing: '0.07em',
    borderBottom: '1px solid #1e293b', background: '#0a0f1a', whiteSpace: 'nowrap',
  };
  const td: React.CSSProperties = {
    padding: '4px 10px', fontSize: 12, textAlign: 'right',
    borderBottom: '1px solid #0f172a', color: '#94a3b8', whiteSpace: 'nowrap',
  };

  return (
    <div style={{ overflowX: 'auto', maxHeight: 440, overflowY: 'auto', border: '1px solid #1e293b', borderRadius: 8, background: '#0a0f1a' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 580 }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: 'left' }}>Strike</th>
            <th style={th}>Type</th>
            <th style={th}>Bid</th>
            <th style={th}>Ask</th>
            <th style={th}>Mid</th>
            <th style={th}>IV%</th>
            <th style={th}>Delta</th>
            <th style={th}>Vol</th>
            <th style={th}>OI</th>
          </tr>
        </thead>
        <tbody>
          {expiries.map(expiry => {
            const rows = byExpiry.get(expiry)!;
            const date  = new Date(expiry + 'T12:00:00Z');
            const label = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            const dte   = rows[0].dte;
            const isCallOnly = rows.every(r => r.type === 'call');
            const isPutOnly  = rows.every(r => r.type === 'put');
            const hdrColor   = isCallOnly ? '#34d399' : isPutOnly ? '#f87171' : '#60a5fa';
            return (
              <React.Fragment key={expiry}>
                <tr>
                  <td colSpan={9} style={{
                    padding: '6px 10px', background: '#111827',
                    borderBottom: '1px solid #1e293b', borderTop: '1px solid #1e293b',
                  }}>
                    <span style={{ fontWeight: 700, color: hdrColor, fontSize: 12 }}>{label}</span>
                    <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 600, color: '#475569', background: '#1e293b', borderRadius: 4, padding: '1px 6px' }}>
                      {dte}d
                    </span>
                    {underlyingPrice != null && (
                      <span style={{ marginLeft: 8, fontSize: 10, color: '#475569' }}>
                        underlying ${underlyingPrice.toFixed(2)}
                      </span>
                    )}
                    <span style={{ marginLeft: 8, fontSize: 10, color: '#334155' }}>
                      {rows.length} contract{rows.length !== 1 ? 's' : ''}
                    </span>
                  </td>
                </tr>
                {rows.map((c, i) => {
                  const isCall = c.type === 'call';
                  const isItm  = underlyingPrice != null
                    ? (isCall ? underlyingPrice > c.strike : underlyingPrice < c.strike)
                    : false;
                  return (
                    <tr key={i} style={{ background: isItm ? 'rgba(16,185,129,0.06)' : undefined }}>
                      <td style={{ ...td, textAlign: 'left', fontWeight: 700, color: isItm ? (isCall ? '#34d399' : '#f87171') : '#e2e8f0' }}>
                        ${c.strike.toLocaleString()}
                      </td>
                      <td style={{ ...td, color: isCall ? '#34d399' : '#f87171', fontWeight: 700, fontSize: 10, letterSpacing: '0.05em' }}>
                        {c.type.toUpperCase()}
                      </td>
                      <td style={td}>${c.bid.toFixed(2)}</td>
                      <td style={td}>${c.ask.toFixed(2)}</td>
                      <td style={{ ...td, color: '#e2e8f0', fontWeight: 600 }}>${c.mid.toFixed(2)}</td>
                      <td style={td}>{(c.iv * 100).toFixed(1)}%</td>
                      <td style={{ ...td, color: deltaColor(c.delta, c.type), fontWeight: 600 }}>
                        {c.delta.toFixed(3)}
                      </td>
                      <td style={td}>{(c.volume ?? 0).toLocaleString()}</td>
                      <td style={td}>{(c.openInterest ?? 0).toLocaleString()}</td>
                    </tr>
                  );
                })}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
