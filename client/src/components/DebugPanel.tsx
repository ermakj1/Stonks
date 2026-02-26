import React, { useState, useCallback } from 'react';

interface ContextData {
  systemPrompt: string;
  prices: unknown;
  holdings: unknown;
}

interface Section {
  id: string;
  label: string;
  description: string;
}

const SECTIONS: Section[] = [
  { id: 'systemPrompt', label: 'System Prompt',  description: 'Full text sent to the AI on every message (persona + strategy + holdings + prices)' },
  { id: 'holdings',     label: 'Holdings JSON',  description: 'Raw holdings.json as loaded from disk' },
  { id: 'prices',       label: 'Prices (Raw)',   description: 'Live prices fetched for all positions — this feeds the system prompt' },
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      onClick={copy}
      style={{
        background: 'none', border: '1px solid #334155', borderRadius: 5,
        color: copied ? '#34d399' : '#64748b', fontSize: 11, fontWeight: 600,
        padding: '2px 9px', cursor: 'pointer', letterSpacing: '0.03em',
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function Block({ content }: { content: string }) {
  return (
    <div style={{ position: 'relative' }}>
      <pre style={{
        background: '#0a0f1a', border: '1px solid #1e293b', borderRadius: 8,
        padding: '14px 16px', margin: 0, overflowX: 'auto', overflowY: 'auto',
        maxHeight: 420, fontSize: 12, lineHeight: 1.6, color: '#94a3b8',
        fontFamily: "ui-monospace, 'Cascadia Code', 'Fira Code', monospace",
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>
        {content}
      </pre>
      <div style={{ position: 'absolute', top: 8, right: 10 }}>
        <CopyButton text={content} />
      </div>
    </div>
  );
}

export function DebugPanel() {
  const [context, setContext] = useState<ContextData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({ systemPrompt: true });

  // Options chain inspector
  const [optTicker, setOptTicker] = useState('');
  const [optData, setOptData] = useState<unknown>(null);
  const [optLoading, setOptLoading] = useState(false);
  const [optError, setOptError] = useState<string | null>(null);

  const fetchContext = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/chat/context');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setContext(await res.json() as ContextData);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchOptions = useCallback(async () => {
    const t = optTicker.trim().toUpperCase();
    if (!t) return;
    setOptLoading(true);
    setOptError(null);
    setOptData(null);
    try {
      const res = await fetch(`/api/options/${t}`);
      const json = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`);
      setOptData(json);
    } catch (e) {
      setOptError(e instanceof Error ? e.message : 'Failed to fetch');
    } finally {
      setOptLoading(false);
    }
  }, [optTicker]);

  const toggle = (id: string) => setOpen(o => ({ ...o, [id]: !o[id] }));

  const labelStyle: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, color: '#64748b',
    textTransform: 'uppercase', letterSpacing: '0.08em',
  };

  return (
    <div className="flex flex-col h-full bg-slate-950 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800 bg-slate-900 flex-shrink-0">
        <div>
          <span className="text-sm font-semibold text-slate-200">AI Context Inspector</span>
          <p className="text-xs text-slate-500 mt-0.5">Inspect the exact data the AI receives on each message</p>
        </div>
        <button
          onClick={fetchContext}
          disabled={loading}
          className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg px-4 py-2 transition-colors"
        >
          {loading ? (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
              Fetching…
            </>
          ) : (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
              {context ? 'Refresh' : 'Load Context'}
            </>
          )}
        </button>
      </div>

      <div className="flex-1 px-5 py-4 flex flex-col gap-4">

        {error && (
          <div className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-3">{error}</div>
        )}

        {!context && !loading && !error && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-slate-700">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <p className="text-slate-500 text-sm">Click <span className="text-slate-300 font-medium">Load Context</span> to fetch the current AI context</p>
          </div>
        )}

        {/* Context sections */}
        {context && SECTIONS.map(sec => {
          const raw = context[sec.id as keyof ContextData];
          const text = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
          const isOpen = open[sec.id] ?? false;
          return (
            <div key={sec.id} style={{ border: '1px solid #1e293b', borderRadius: 10, overflow: 'hidden' }}>
              <button
                onClick={() => toggle(sec.id)}
                style={{
                  width: '100%', background: '#0f172a', border: 'none', cursor: 'pointer',
                  padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10,
                  textAlign: 'left',
                }}
              >
                <span style={{ color: isOpen ? '#34d399' : '#475569', fontSize: 13, lineHeight: 1, flexShrink: 0 }}>
                  {isOpen ? '▾' : '▸'}
                </span>
                <span style={{ fontWeight: 700, color: '#e2e8f0', fontSize: 13 }}>{sec.label}</span>
                <span style={{ ...labelStyle, marginLeft: 4 }}>
                  {typeof raw === 'string' ? `${raw.length} chars` : `${JSON.stringify(raw).length} chars`}
                </span>
                <span style={{ fontSize: 11, color: '#475569', marginLeft: 'auto' }}>{sec.description}</span>
              </button>
              {isOpen && (
                <div style={{ padding: '0 12px 12px' }}>
                  <Block content={text} />
                </div>
              )}
            </div>
          );
        })}

        {/* Options chain inspector */}
        <div style={{ border: '1px solid #1e293b', borderRadius: 10, overflow: 'hidden' }}>
          <button
            onClick={() => toggle('options')}
            style={{
              width: '100%', background: '#0f172a', border: 'none', cursor: 'pointer',
              padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10,
              textAlign: 'left',
            }}
          >
            <span style={{ color: open['options'] ? '#34d399' : '#475569', fontSize: 13, lineHeight: 1, flexShrink: 0 }}>
              {open['options'] ? '▾' : '▸'}
            </span>
            <span style={{ fontWeight: 700, color: '#e2e8f0', fontSize: 13 }}>Options Chain</span>
            <span style={{ fontSize: 11, color: '#475569', marginLeft: 'auto' }}>
              Raw response from /api/options/:ticker for any symbol
            </span>
          </button>

          {open['options'] && (
            <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  value={optTicker}
                  onChange={e => setOptTicker(e.target.value.toUpperCase())}
                  onKeyDown={e => e.key === 'Enter' && fetchOptions()}
                  placeholder="Ticker e.g. AAPL"
                  style={{
                    background: '#0a0f1a', border: '1px solid #334155', borderRadius: 7,
                    color: '#e2e8f0', padding: '6px 12px', fontSize: 13, outline: 'none',
                    fontWeight: 700, letterSpacing: '0.04em', width: 160,
                  }}
                />
                <button
                  onClick={fetchOptions}
                  disabled={optLoading || !optTicker.trim()}
                  className="flex items-center gap-2 bg-blue-700 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg px-4 py-2 transition-colors"
                >
                  {optLoading ? 'Fetching…' : 'Fetch Chain'}
                </button>
                {optData && (
                  <span style={labelStyle}>
                    {(() => {
                      const d = optData as { calls?: unknown[]; puts?: unknown[]; expirationDates?: unknown[] };
                      return `${d.calls?.length ?? 0} calls · ${d.puts?.length ?? 0} puts · ${d.expirationDates?.length ?? 0} expiries`;
                    })()}
                  </span>
                )}
              </div>
              {optError && <div className="text-red-400 text-xs">{optError}</div>}
              {optData && <Block content={JSON.stringify(optData, null, 2)} />}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
