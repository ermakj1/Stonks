import React, { useState, useCallback, useEffect } from 'react';
import { ChainTable, type ChainResult } from './ChainTable';

interface ContextData {
  systemPrompt: string;
  prices: unknown;
  holdings: unknown;
}

interface Section {
  id:          string;
  label:       string;
  description: string;
}

const SECTIONS: Section[] = [
  { id: 'systemPrompt', label: 'System Prompt', description: 'Full text sent to the AI on every message (persona + strategy + holdings + prices)' },
  { id: 'prices',       label: 'Prices (Raw)',  description: 'Live prices fetched for all positions — this feeds the system prompt' },
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

// ── Main panel ────────────────────────────────────────────────────────────

export function DebugPanel() {
  const [context, setContext]   = useState<ContextData | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [open, setOpen]         = useState<Record<string, boolean>>({ systemPrompt: true });

  // Chain inspector state
  const [chainTicker,    setChainTicker]    = useState('');
  const [chainType,      setChainType]      = useState<'calls' | 'puts' | 'both'>('calls');
  const [chainDteMin,    setChainDteMin]    = useState(20);
  const [chainDteMax,    setChainDteMax]    = useState(90);
  const [chainOtm,       setChainOtm]       = useState(true);
  const [chainMax,       setChainMax]       = useState(100);
  const [chainDeltaMin,  setChainDeltaMin]  = useState('');
  const [chainDeltaMax,  setChainDeltaMax]  = useState('');
  const [chainStrikeMin, setChainStrikeMin] = useState('');
  const [chainStrikeMax, setChainStrikeMax] = useState('');
  const [chainPriceMin,  setChainPriceMin]  = useState('');
  const [chainPriceMax,  setChainPriceMax]  = useState('');
  const [chainResult,    setChainResult]    = useState<ChainResult | null>(null);
  const [chainLoading,   setChainLoading]   = useState(false);
  const [chainError,     setChainError]     = useState<string | null>(null);
  const [chainView,      setChainView]      = useState<'table' | 'text'>('table');

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

  useEffect(() => { fetchContext(); }, [fetchContext]);

  const fetchChain = useCallback(async () => {
    const t = chainTicker.trim().toUpperCase();
    if (!t) return;
    setChainLoading(true);
    setChainError(null);
    setChainResult(null);
    try {
      const params = new URLSearchParams({
        ticker:      t,
        type:        chainType,
        dte_min:     String(chainDteMin),
        dte_max:     String(chainDteMax),
        otm_only:    String(chainOtm),
        max_results: String(chainMax),
        ...(chainDeltaMin  !== '' ? { delta_min:  chainDeltaMin  } : {}),
        ...(chainDeltaMax  !== '' ? { delta_max:  chainDeltaMax  } : {}),
        ...(chainStrikeMin !== '' ? { strike_min: chainStrikeMin } : {}),
        ...(chainStrikeMax !== '' ? { strike_max: chainStrikeMax } : {}),
        ...(chainPriceMin  !== '' ? { price_min:  chainPriceMin  } : {}),
        ...(chainPriceMax  !== '' ? { price_max:  chainPriceMax  } : {}),
      });
      const res = await fetch(`/api/chat/chain?${params}`);
      const json = await res.json() as ChainResult & { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setChainResult(json);
    } catch (e) {
      setChainError(e instanceof Error ? e.message : 'Failed to fetch');
    } finally {
      setChainLoading(false);
    }
  }, [chainTicker, chainType, chainDteMin, chainDteMax, chainOtm, chainMax,
      chainDeltaMin, chainDeltaMax, chainStrikeMin, chainStrikeMax, chainPriceMin, chainPriceMax]);

  const toggle = (id: string) => setOpen(o => ({ ...o, [id]: !o[id] }));

  const inputCls: React.CSSProperties = {
    background: '#0a0f1a', border: '1px solid #334155', borderRadius: 6,
    color: '#e2e8f0', padding: '5px 10px', fontSize: 12, outline: 'none',
  };
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
              Refresh
            </>
          )}
        </button>
      </div>

      <div className="flex-1 px-5 py-4 flex flex-col gap-4">

        {error && (
          <div className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-3">{error}</div>
        )}

        {!context && loading && (
          <div className="flex items-center justify-center py-16 text-slate-500 text-sm">Loading context…</div>
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

        {/* ── AI Option Chain Preview ── */}
        <div style={{ border: '1px solid #1e293b', borderRadius: 10, overflow: 'hidden' }}>
          <button
            onClick={() => toggle('chain')}
            style={{
              width: '100%', background: '#0f172a', border: 'none', cursor: 'pointer',
              padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10,
              textAlign: 'left',
            }}
          >
            <span style={{ color: open['chain'] ? '#34d399' : '#475569', fontSize: 13, lineHeight: 1, flexShrink: 0 }}>
              {open['chain'] ? '▾' : '▸'}
            </span>
            <span style={{ fontWeight: 700, color: '#e2e8f0', fontSize: 13 }}>AI Option Chain Preview</span>
            {chainResult && (
              <span style={{ ...labelStyle, marginLeft: 4 }}>
                {chainResult.contracts.length} contracts · {chainResult.params.ticker} · ${chainResult.underlyingPrice?.toFixed(2) ?? 'N/A'}
              </span>
            )}
            <span style={{ fontSize: 11, color: '#475569', marginLeft: 'auto' }}>
              Exact data the AI receives from <code style={{ color: '#60a5fa', fontSize: 10 }}>get_option_chain</code>
            </span>
          </button>

          {open['chain'] && (
            <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: 12 }}>

              {/* ── Parameters bar ── */}
              <div style={{
                display: 'flex', flexWrap: 'wrap', gap: '10px 16px', alignItems: 'flex-end',
                background: '#0a0f1a', border: '1px solid #1e293b', borderRadius: 8,
                padding: '12px 14px',
              }}>
                {/* Ticker */}
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={labelStyle}>Ticker</span>
                  <input
                    value={chainTicker}
                    onChange={e => setChainTicker(e.target.value.toUpperCase())}
                    onKeyDown={e => e.key === 'Enter' && fetchChain()}
                    placeholder="AAPL"
                    style={{ ...inputCls, width: 88, fontWeight: 700, letterSpacing: '0.04em' }}
                  />
                </label>

                {/* Type */}
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={labelStyle}>Type</span>
                  <select
                    value={chainType}
                    onChange={e => setChainType(e.target.value as 'calls' | 'puts' | 'both')}
                    style={{ ...inputCls, cursor: 'pointer', paddingRight: 22 }}
                  >
                    <option value="calls">Calls</option>
                    <option value="puts">Puts</option>
                    <option value="both">Both</option>
                  </select>
                </label>

                {/* DTE range */}
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={labelStyle}>DTE Min</span>
                  <input
                    type="number" min="0" value={chainDteMin}
                    onChange={e => setChainDteMin(Number(e.target.value))}
                    style={{ ...inputCls, width: 64 }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={labelStyle}>DTE Max</span>
                  <input
                    type="number" min="0" value={chainDteMax}
                    onChange={e => setChainDteMax(Number(e.target.value))}
                    style={{ ...inputCls, width: 64 }}
                  />
                </label>

                {/* OTM Only */}
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={labelStyle}>OTM Only</span>
                  <div style={{ display: 'flex', alignItems: 'center', height: 29 }}>
                    <input
                      type="checkbox" checked={chainOtm}
                      onChange={e => setChainOtm(e.target.checked)}
                      style={{ width: 15, height: 15, cursor: 'pointer', accentColor: '#34d399' }}
                    />
                  </div>
                </label>

                {/* Max results */}
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={labelStyle}>Max Results</span>
                  <input
                    type="number" min="1" max="120" value={chainMax}
                    onChange={e => setChainMax(Math.min(Number(e.target.value), 120))}
                    style={{ ...inputCls, width: 64 }}
                  />
                </label>

                {/* Delta range */}
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ ...labelStyle, color: '#7c3aed' }}>Delta Min</span>
                  <input
                    type="number" min="0" max="1" step="0.05" placeholder="e.g. 0.10"
                    value={chainDeltaMin}
                    onChange={e => setChainDeltaMin(e.target.value)}
                    style={{ ...inputCls, width: 80 }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ ...labelStyle, color: '#7c3aed' }}>Delta Max</span>
                  <input
                    type="number" min="0" max="1" step="0.05" placeholder="e.g. 0.35"
                    value={chainDeltaMax}
                    onChange={e => setChainDeltaMax(e.target.value)}
                    style={{ ...inputCls, width: 80 }}
                  />
                </label>

                {/* Price range */}
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ ...labelStyle, color: '#b45309' }}>Mid Min $</span>
                  <input
                    type="number" min="0" step="0.25" placeholder="e.g. 0.50"
                    value={chainPriceMin}
                    onChange={e => setChainPriceMin(e.target.value)}
                    style={{ ...inputCls, width: 80 }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ ...labelStyle, color: '#b45309' }}>Mid Max $</span>
                  <input
                    type="number" min="0" step="0.25" placeholder="e.g. 5.00"
                    value={chainPriceMax}
                    onChange={e => setChainPriceMax(e.target.value)}
                    style={{ ...inputCls, width: 80 }}
                  />
                </label>

                {/* Strike range */}
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ ...labelStyle, color: '#0369a1' }}>Strike Min</span>
                  <input
                    type="number" min="0" step="1" placeholder="optional"
                    value={chainStrikeMin}
                    onChange={e => setChainStrikeMin(e.target.value)}
                    style={{ ...inputCls, width: 80 }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ ...labelStyle, color: '#0369a1' }}>Strike Max</span>
                  <input
                    type="number" min="0" step="1" placeholder="optional"
                    value={chainStrikeMax}
                    onChange={e => setChainStrikeMax(e.target.value)}
                    style={{ ...inputCls, width: 80 }}
                  />
                </label>

                {/* Fetch button */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ ...labelStyle, visibility: 'hidden' }}>x</span>
                  <button
                    onClick={fetchChain}
                    disabled={chainLoading || !chainTicker.trim()}
                    style={{
                      background: chainLoading || !chainTicker.trim() ? '#1e293b' : '#1d4ed8',
                      border: 'none', borderRadius: 6, color: '#fff', fontWeight: 700,
                      fontSize: 12, padding: '5px 16px', cursor: chainLoading || !chainTicker.trim() ? 'not-allowed' : 'pointer',
                      opacity: chainLoading || !chainTicker.trim() ? 0.5 : 1, whiteSpace: 'nowrap',
                      transition: 'background 0.12s',
                    }}
                    onMouseEnter={e => { if (!chainLoading && chainTicker.trim()) (e.currentTarget as HTMLButtonElement).style.background = '#2563eb'; }}
                    onMouseLeave={e => { if (!chainLoading && chainTicker.trim()) (e.currentTarget as HTMLButtonElement).style.background = '#1d4ed8'; }}
                  >
                    {chainLoading ? 'Fetching…' : 'Fetch Chain'}
                  </button>
                </div>
              </div>

              {/* Error */}
              {chainError && (
                <div style={{ color: '#f87171', fontSize: 12, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, padding: '8px 12px' }}>
                  {chainError}
                </div>
              )}

              {/* Result */}
              {chainResult && (
                <>
                  {/* Result header + view toggle */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 12, color: '#e2e8f0', fontWeight: 700 }}>
                      {chainResult.contracts.length === 0
                        ? 'No contracts matched'
                        : `${chainResult.contracts.length} contract${chainResult.contracts.length !== 1 ? 's' : ''}`}
                    </span>
                    {chainResult.underlyingPrice != null && (
                      <span style={{ fontSize: 11, color: '#64748b' }}>
                        · {chainResult.params.ticker} @ ${chainResult.underlyingPrice.toFixed(2)}
                      </span>
                    )}
                    <span style={{ fontSize: 11, color: '#475569' }}>
                      · {chainResult.params.type}, DTE {chainResult.params.dteMin}–{chainResult.params.dteMax}, OTM: {String(chainResult.params.otmOnly)}
                    </span>
                    {/* View toggle */}
                    {chainResult.contracts.length > 0 && (
                      <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                        {(['table', 'text'] as const).map(v => (
                          <button
                            key={v}
                            onClick={() => setChainView(v)}
                            style={{
                              padding: '2px 10px', borderRadius: 5, fontSize: 11, fontWeight: 700,
                              cursor: 'pointer', border: chainView === v ? '1px solid #334155' : '1px solid transparent',
                              background: chainView === v ? '#1e293b' : 'none',
                              color: chainView === v ? '#e2e8f0' : '#475569',
                              transition: 'all 0.1s',
                            }}
                          >
                            {v === 'table' ? '⊞ Table' : '≡ AI Text'}
                          </button>
                        ))}
                        <CopyButton text={chainResult.formattedText} />
                      </div>
                    )}
                  </div>

                  {chainResult.contracts.length === 0 && (
                    <div style={{ color: '#64748b', fontSize: 12, padding: '12px', background: '#0a0f1a', borderRadius: 8, border: '1px solid #1e293b' }}>
                      {chainResult.formattedText}
                    </div>
                  )}

                  {chainResult.contracts.length > 0 && chainView === 'table' && (
                    <ChainTable contracts={chainResult.contracts} underlyingPrice={chainResult.underlyingPrice} />
                  )}

                  {chainResult.contracts.length > 0 && chainView === 'text' && (
                    <Block content={chainResult.formattedText} />
                  )}
                </>
              )}

            </div>
          )}
        </div>

        {/* ── Price Lookup ── */}
        <PriceLookupSection inputCls={inputCls} labelStyle={labelStyle} open={open} toggle={toggle} />

      </div>
    </div>
  );
}

// ── Price Lookup Section ───────────────────────────────────────────────────

interface OptionDetailResult {
  found:   boolean;
  detail?: {
    ticker: string; type: string; strike: number; expiry: string; dte: number;
    bid: number; ask: number; mid: number; last: number;
    iv: number; delta: number; volume: number; openInterest: number;
    underlyingClose: number | null;
  };
}

function PriceLookupSection({ inputCls, labelStyle, open, toggle }: {
  inputCls:   React.CSSProperties;
  labelStyle: React.CSSProperties;
  open:       Record<string, boolean>;
  toggle:     (id: string) => void;
}) {
  const [ticker,     setTicker]     = useState('');
  const [type,       setType]       = useState<'call' | 'put'>('call');
  const [strike,     setStrike]     = useState('');
  const [expiration, setExpiration] = useState('');
  const [result,     setResult]     = useState<OptionDetailResult | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  const fetchPrice = useCallback(async () => {
    const t = ticker.trim().toUpperCase();
    if (!t || !strike || !expiration) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const params = new URLSearchParams({ ticker: t, type, strike, expiration });
      const res  = await fetch(`/api/chat/price?${params}`);
      const json = await res.json() as OptionDetailResult & { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setResult(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, [ticker, type, strike, expiration]);

  const d = result?.detail;
  const isOpen = open['price'] ?? false;

  return (
    <div style={{ border: '1px solid #1e293b', borderRadius: 10, overflow: 'hidden' }}>
      <button
        onClick={() => toggle('price')}
        style={{ width: '100%', background: '#0f172a', border: 'none', cursor: 'pointer', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left' }}
      >
        <span style={{ color: isOpen ? '#34d399' : '#475569', fontSize: 13, lineHeight: 1, flexShrink: 0 }}>
          {isOpen ? '▾' : '▸'}
        </span>
        <span style={{ fontWeight: 700, color: '#e2e8f0', fontSize: 13 }}>AI Option Price Lookup</span>
        {d && <span style={{ fontSize: 10, fontWeight: 700, color: '#64748b', marginLeft: 4 }}>mid ${d.mid.toFixed(2)} · Δ {d.delta.toFixed(3)}</span>}
        <span style={{ fontSize: 11, color: '#475569', marginLeft: 'auto' }}>
          Exact data from <code style={{ color: '#60a5fa', fontSize: 10 }}>get_option_price</code>
        </span>
      </button>

      {isOpen && (
        <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* params */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 16px', alignItems: 'flex-end', background: '#0a0f1a', border: '1px solid #1e293b', borderRadius: 8, padding: '12px 14px' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={labelStyle}>Ticker</span>
              <input value={ticker} onChange={e => setTicker(e.target.value.toUpperCase())} onKeyDown={e => e.key === 'Enter' && fetchPrice()} placeholder="AAPL" style={{ ...inputCls, width: 88, fontWeight: 700 }} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={labelStyle}>Type</span>
              <select value={type} onChange={e => setType(e.target.value as 'call' | 'put')} style={{ ...inputCls, cursor: 'pointer' }}>
                <option value="call">Call</option>
                <option value="put">Put</option>
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={labelStyle}>Strike</span>
              <input type="number" value={strike} onChange={e => setStrike(e.target.value)} onKeyDown={e => e.key === 'Enter' && fetchPrice()} placeholder="480" style={{ ...inputCls, width: 80 }} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={labelStyle}>Expiration</span>
              <input type="date" value={expiration} onChange={e => setExpiration(e.target.value)} style={{ ...inputCls, width: 140, colorScheme: 'dark' }} />
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ ...labelStyle, visibility: 'hidden' }}>x</span>
              <button
                onClick={fetchPrice}
                disabled={loading || !ticker.trim() || !strike || !expiration}
                style={{ background: loading || !ticker.trim() || !strike || !expiration ? '#1e293b' : '#1d4ed8', border: 'none', borderRadius: 6, color: '#fff', fontWeight: 700, fontSize: 12, padding: '5px 16px', cursor: 'pointer', opacity: loading || !ticker.trim() || !strike || !expiration ? 0.5 : 1 }}
              >
                {loading ? 'Fetching…' : 'Fetch Price'}
              </button>
            </div>
          </div>

          {error && <div style={{ color: '#f87171', fontSize: 12, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, padding: '8px 12px' }}>{error}</div>}

          {result && !result.found && (
            <div style={{ color: '#64748b', fontSize: 12, padding: '10px 12px', background: '#0a0f1a', border: '1px solid #1e293b', borderRadius: 8 }}>
              Contract not found in CBOE chain. It may not exist, have no market, or the expiration may be wrong.
            </div>
          )}

          {d && (
            <div style={{ background: '#0a0f1a', border: '1px solid #1e293b', borderRadius: 8, padding: '14px 16px' }}>
              <div style={{ fontWeight: 700, color: '#e2e8f0', fontSize: 13, marginBottom: 12 }}>
                {d.ticker} {d.type.toUpperCase()} ${d.strike} exp {d.expiry} &nbsp;
                <span style={{ fontSize: 11, color: '#475569', fontWeight: 400 }}>{d.dte}d</span>
                {d.underlyingClose != null && <span style={{ fontSize: 11, color: '#475569', fontWeight: 400 }}> · underlying ${d.underlyingClose.toFixed(2)}</span>}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, auto)', gap: '8px 28px', width: 'fit-content' }}>
                {([
                  ['Bid',    `$${d.bid.toFixed(2)}`],
                  ['Ask',    `$${d.ask.toFixed(2)}`],
                  ['Mid',    `$${d.mid.toFixed(2)}`],
                  ['Last',   `$${d.last.toFixed(2)}`],
                  ['IV',     `${(d.iv * 100).toFixed(1)}%`],
                  ['Delta',  d.delta.toFixed(3)],
                  ['Volume', d.volume.toLocaleString()],
                  ['OI',     d.openInterest.toLocaleString()],
                ] as [string, string][]).map(([label, value]) => (
                  <React.Fragment key={label}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</span>
                    <span style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 600 }}>{value}</span>
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
