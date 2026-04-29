import React, { useState, useCallback } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message, OptionSuggestion, ToolCallRecord } from '../types';
import { ChainTable, type ChainResult } from './ChainTable';

interface Props {
  message: Message;
  onWatchOption?: (s: OptionSuggestion) => Promise<void>;
  onViewChain?: (s: OptionSuggestion) => void;
}

function fmtExpiry(d: string) {
  const dt = new Date(d + 'T12:00:00Z');
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

// ── Tool call card (get_option_chain) ─────────────────────────────────────

function ToolCallCard({ call }: { call: ToolCallRecord }) {
  const [expanded,  setExpanded]  = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [result,    setResult]    = useState<ChainResult | null>(null);
  const [fetchErr,  setFetchErr]  = useState<string | null>(null);
  const [view,      setView]      = useState<'table' | 'text'>('table');

  const inp = call.input;
  const ticker    = inp.ticker      ?? '?';
  const type      = inp.type        ?? 'calls';
  const dteMin    = inp.dte_min     ?? 20;
  const dteMax    = inp.dte_max     ?? 90;
  const otmOnly   = inp.otm_only    !== false;
  const maxRes    = inp.max_results ?? 100;
  const deltaMin  = inp.delta_min;
  const deltaMax  = inp.delta_max;
  const strikeMin = inp.strike_min;
  const strikeMax = inp.strike_max;
  const priceMin  = inp.price_min;
  const priceMax  = inp.price_max;

  const typeColor = type === 'puts' ? '#f87171' : '#34d399';

  const fetch_ = useCallback(async () => {
    if (result) { setExpanded(e => !e); return; }
    setExpanded(true);
    setLoading(true);
    setFetchErr(null);
    try {
      const params = new URLSearchParams({
        ticker, type, dte_min: String(dteMin), dte_max: String(dteMax),
        otm_only: String(otmOnly), max_results: String(maxRes),
        ...(deltaMin  != null ? { delta_min:  String(deltaMin)  } : {}),
        ...(deltaMax  != null ? { delta_max:  String(deltaMax)  } : {}),
        ...(strikeMin != null ? { strike_min: String(strikeMin) } : {}),
        ...(strikeMax != null ? { strike_max: String(strikeMax) } : {}),
        ...(priceMin  != null ? { price_min:  String(priceMin)  } : {}),
        ...(priceMax  != null ? { price_max:  String(priceMax)  } : {}),
      });
      const res  = await fetch(`/api/chat/chain?${params}`);
      const json = await res.json() as ChainResult & { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setResult(json);
    } catch (e) {
      setFetchErr(e instanceof Error ? e.message : 'Failed to fetch');
    } finally {
      setLoading(false);
    }
  }, [result, ticker, type, dteMin, dteMax, otmOnly, maxRes, deltaMin, deltaMax, strikeMin, strikeMax, priceMin, priceMax]);

  return (
    <div style={{
      border: '1px solid #1e3a5f',
      borderRadius: 10,
      background: '#0d1e30',
      overflow: 'hidden',
      fontSize: 12,
    }}>
      {/* ── pill row ── */}
      <button
        onClick={fetch_}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
          background: 'none', border: 'none', cursor: 'pointer',
          padding: '7px 12px', textAlign: 'left',
        }}
      >
        {/* icon */}
        <span style={{ fontSize: 13, flexShrink: 0 }}>🔍</span>

        {/* ticker + type */}
        <span style={{ fontWeight: 800, color: '#e2e8f0', letterSpacing: '0.03em', fontSize: 12 }}>
          {ticker}
        </span>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
          background: type === 'puts' ? 'rgba(248,113,113,0.15)' : 'rgba(52,211,153,0.15)',
          border: `1px solid ${type === 'puts' ? 'rgba(248,113,113,0.3)' : 'rgba(52,211,153,0.3)'}`,
          color: typeColor, letterSpacing: '0.05em', textTransform: 'uppercase',
        }}>
          {type}
        </span>

        {/* param pills */}
        <span style={{ color: '#475569', fontSize: 11 }}>DTE {dteMin}–{dteMax}</span>
        {otmOnly && <span style={{ color: '#475569', fontSize: 11 }}>OTM</span>}
        {(deltaMin != null || deltaMax != null) && (
          <span style={{ color: '#a78bfa', fontSize: 11 }}>
            Δ {deltaMin ?? '0'}–{deltaMax ?? '1'}
          </span>
        )}
        {(strikeMin != null || strikeMax != null) && (
          <span style={{ color: '#60a5fa', fontSize: 11 }}>
            ${strikeMin ?? '0'}–${strikeMax ?? '∞'}
          </span>
        )}
        {(priceMin != null || priceMax != null) && (
          <span style={{ color: '#fbbf24', fontSize: 11 }}>
            ${priceMin ?? '0'}–${priceMax ?? '∞'} mid
          </span>
        )}
        <span style={{ color: '#334155', fontSize: 11 }}>max {maxRes}</span>

        {/* right side: result count or loading */}
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          {loading && (
            <span style={{ color: '#475569', fontSize: 11 }}>fetching…</span>
          )}
          {result && !loading && (
            <span style={{ color: '#64748b', fontSize: 11 }}>
              {result.contracts.length} contracts
            </span>
          )}
          <span style={{ color: expanded ? '#34d399' : '#475569', fontSize: 13, lineHeight: 1 }}>
            {expanded ? '▾' : '▸'}
          </span>
        </span>
      </button>

      {/* ── expanded body ── */}
      {expanded && (
        <div style={{ borderTop: '1px solid #1e3a5f', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {loading && (
            <div style={{ color: '#475569', fontSize: 12, padding: '8px 0' }}>Loading chain…</div>
          )}
          {fetchErr && (
            <div style={{ color: '#f87171', fontSize: 12, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, padding: '6px 10px' }}>
              {fetchErr}
            </div>
          )}
          {result && !loading && (
            <>
              {/* header row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: '#e2e8f0', fontWeight: 700 }}>
                  {result.contracts.length === 0 ? 'No contracts matched' : `${result.contracts.length} contract${result.contracts.length !== 1 ? 's' : ''}`}
                </span>
                {result.underlyingPrice != null && (
                  <span style={{ fontSize: 11, color: '#64748b' }}>
                    · {result.params.ticker} @ ${result.underlyingPrice.toFixed(2)}
                  </span>
                )}
                {/* view toggle */}
                {result.contracts.length > 0 && (
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                    {(['table', 'text'] as const).map(v => (
                      <button
                        key={v}
                        onClick={() => setView(v)}
                        style={{
                          padding: '1px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                          cursor: 'pointer', transition: 'all 0.1s',
                          border: view === v ? '1px solid #334155' : '1px solid transparent',
                          background: view === v ? '#1e293b' : 'none',
                          color: view === v ? '#e2e8f0' : '#475569',
                        }}
                      >
                        {v === 'table' ? '⊞ Table' : '≡ Text'}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {result.contracts.length === 0 && (
                <div style={{ color: '#64748b', fontSize: 12 }}>{result.formattedText}</div>
              )}
              {result.contracts.length > 0 && view === 'table' && (
                <ChainTable contracts={result.contracts} underlyingPrice={result.underlyingPrice} />
              )}
              {result.contracts.length > 0 && view === 'text' && (
                <pre style={{
                  background: '#0a0f1a', border: '1px solid #1e293b', borderRadius: 8,
                  padding: '10px 12px', fontSize: 11, lineHeight: 1.55, color: '#94a3b8',
                  fontFamily: "ui-monospace, monospace", overflowX: 'auto', overflowY: 'auto',
                  maxHeight: 340, whiteSpace: 'pre', margin: 0,
                }}>
                  {result.formattedText}
                </pre>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Price lookup card (get_option_price) ──────────────────────────────────

interface OptionDetailResult {
  found:   boolean;
  detail?: {
    ticker: string; type: string; strike: number; expiry: string; dte: number;
    bid: number; ask: number; mid: number; last: number;
    iv: number; delta: number; volume: number; openInterest: number;
    underlyingClose: number | null;
  };
}

function PriceCallCard({ call }: { call: ToolCallRecord }) {
  const [expanded, setExpanded] = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [result,   setResult]   = useState<OptionDetailResult | null>(null);
  const [err,      setErr]      = useState<string | null>(null);

  const inp        = call.input;
  const ticker     = (inp.ticker     ?? '?').toUpperCase();
  const type       = inp.type        ?? '';
  const strike     = inp.strike      ?? 0;
  const expiration = inp.expiration  ?? '';
  const isCall     = type === 'call';
  const typeColor  = isCall ? '#34d399' : '#f87171';

  const fmtExp = (s: string) => {
    const d = new Date(s + 'T12:00:00Z');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
  };

  const fetch_ = useCallback(async () => {
    if (result) { setExpanded(e => !e); return; }
    setExpanded(true);
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams({ ticker, type, strike: String(strike), expiration });
      const res  = await fetch(`/api/chat/price?${params}`);
      const json = await res.json() as OptionDetailResult & { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setResult(json);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to fetch');
    } finally {
      setLoading(false);
    }
  }, [result, ticker, type, strike, expiration]);

  const d = result?.detail;

  return (
    <div style={{ border: '1px solid #1e3a5f', borderRadius: 10, background: '#0d1e30', overflow: 'hidden', fontSize: 12 }}>
      {/* pill row */}
      <button
        onClick={fetch_}
        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '7px 12px', textAlign: 'left' }}
      >
        <span style={{ fontSize: 13, flexShrink: 0 }}>💲</span>
        <span style={{ fontWeight: 800, color: '#e2e8f0', letterSpacing: '0.03em', fontSize: 12 }}>{ticker}</span>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
          background: isCall ? 'rgba(52,211,153,0.15)' : 'rgba(248,113,113,0.15)',
          border: `1px solid ${isCall ? 'rgba(52,211,153,0.3)' : 'rgba(248,113,113,0.3)'}`,
          color: typeColor, letterSpacing: '0.05em', textTransform: 'uppercase',
        }}>{type}</span>
        <span style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 12 }}>${strike}</span>
        <span style={{ color: '#475569', fontSize: 11 }}>{expiration ? fmtExp(expiration) : ''}</span>

        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          {loading && <span style={{ color: '#475569', fontSize: 11 }}>fetching…</span>}
          {d && !loading && (
            <span style={{ color: '#64748b', fontSize: 11 }}>mid ${d.mid.toFixed(2)} · Δ {d.delta.toFixed(3)}</span>
          )}
          {result && !result.found && !loading && (
            <span style={{ color: '#f87171', fontSize: 11 }}>not found</span>
          )}
          <span style={{ color: expanded ? '#34d399' : '#475569', fontSize: 13, lineHeight: 1 }}>
            {expanded ? '▾' : '▸'}
          </span>
        </span>
      </button>

      {/* expanded body */}
      {expanded && (
        <div style={{ borderTop: '1px solid #1e3a5f', padding: '10px 12px' }}>
          {loading && <div style={{ color: '#475569', fontSize: 12 }}>Loading…</div>}
          {err && <div style={{ color: '#f87171', fontSize: 12 }}>{err}</div>}
          {result && !result.found && !loading && (
            <div style={{ color: '#64748b', fontSize: 12 }}>
              Contract not found in CBOE chain. It may not exist or have no market.
            </div>
          )}
          {d && !loading && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, auto)', gap: '6px 24px', width: 'fit-content' }}>
              {[
                ['Bid',    `$${d.bid.toFixed(2)}`],
                ['Ask',    `$${d.ask.toFixed(2)}`],
                ['Mid',    `$${d.mid.toFixed(2)}`],
                ['Last',   `$${d.last.toFixed(2)}`],
                ['IV',     `${(d.iv * 100).toFixed(1)}%`],
                ['Delta',  d.delta.toFixed(3)],
                ['Volume', d.volume.toLocaleString()],
                ['OI',     d.openInterest.toLocaleString()],
                ['DTE',    `${d.dte}d`],
                ...(d.underlyingClose != null ? [['Underlying', `$${d.underlyingClose.toFixed(2)}`]] : []),
              ].map(([label, value]) => (
                <React.Fragment key={label}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
                  <span style={{ fontSize: 12, color: '#e2e8f0', fontWeight: 600 }}>{value}</span>
                </React.Fragment>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Dispatch tool call to the right card ──────────────────────────────────

function ToolCallDispatch({ call }: { call: ToolCallRecord }) {
  if (call.name === 'get_option_price') return <PriceCallCard call={call} />;
  return <ToolCallCard call={call} />;
}

// ── Option suggestion card ─────────────────────────────────────────────────

function OptionSuggestionCard({ suggestion, onWatch, onViewChain }: {
  suggestion: OptionSuggestion;
  onWatch?: (s: OptionSuggestion) => Promise<void>;
  onViewChain?: (s: OptionSuggestion) => void;
}) {
  const [state, setState] = useState<'idle' | 'loading' | 'added'>('idle');

  const handleWatch = async () => {
    if (!onWatch || state !== 'idle') return;
    setState('loading');
    try {
      await onWatch(suggestion);
      setState('added');
    } catch {
      setState('idle');
    }
  };

  const isCall = suggestion.type === 'call';

  return (
    <div className="flex items-center gap-2.5 bg-slate-900/70 border border-slate-700/60 rounded-xl px-3 py-2">
      <div className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${
        isCall
          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25'
          : 'bg-red-500/15 text-red-400 border border-red-500/25'
      }`}>
        {suggestion.type.toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-white font-semibold">
          {suggestion.ticker} ${suggestion.strike} · {fmtExpiry(suggestion.expiration)}
        </div>
        {suggestion.notes && (
          <div className="text-[10px] text-slate-400 truncate mt-0.5">{suggestion.notes}</div>
        )}
      </div>
      {onViewChain && (
        <button
          onClick={() => onViewChain(suggestion)}
          className="text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-all flex-shrink-0 bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 border border-purple-500/25 hover:border-purple-500/40 cursor-pointer"
          title="View in option chain"
        >
          Chain
        </button>
      )}
      <button
        onClick={handleWatch}
        disabled={state !== 'idle'}
        className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-all flex-shrink-0 ${
          state === 'added'
            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 cursor-default'
            : state === 'loading'
            ? 'bg-slate-700/60 text-slate-400 cursor-wait border border-slate-600'
            : 'bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600 hover:border-slate-500 cursor-pointer'
        }`}
      >
        {state === 'added' ? '✓ Watching' : state === 'loading' ? '…' : '+ Watch'}
      </button>
    </div>
  );
}

export function ChatMessage({ message, onWatchOption, onViewChain }: Props) {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div className="flex justify-end mb-4 px-2">
        <div className="max-w-[78%] flex flex-col items-end gap-1">
          <div className="bg-blue-600 text-white rounded-2xl rounded-tr-sm px-4 py-3 text-sm leading-relaxed shadow-lg">
            <p className="whitespace-pre-wrap">{message.content}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 mb-5 px-2">
      {/* AI avatar */}
      <div className="w-5 h-5 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center flex-shrink-0 mt-1">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-emerald-400">
          <path d="M12 2a2 2 0 0 1 2 2v1a2 2 0 0 0 2 2h1a2 2 0 0 1 0 4h-1a2 2 0 0 0-2 2v1a2 2 0 0 1-4 0v-1a2 2 0 0 0-2-2H7a2 2 0 0 1 0-4h1a2 2 0 0 0 2-2V4a2 2 0 0 1 2-2z"/>
          <circle cx="9" cy="12" r="1" fill="currentColor" stroke="none"/>
          <circle cx="15" cy="12" r="1" fill="currentColor" stroke="none"/>
        </svg>
      </div>

      {/* Message bubble */}
      <div className="flex-1 min-w-0">
        <div className={`bg-slate-800 border border-slate-700 rounded-2xl rounded-tl-sm px-4 py-3 shadow-lg text-sm ${message.streaming ? 'border-emerald-700/50' : ''}`}>
          <div className="prose prose-invert prose-sm max-w-none leading-relaxed
            prose-headings:text-slate-100 prose-headings:font-semibold prose-headings:mt-3 prose-headings:mb-1
            prose-h1:text-base prose-h2:text-sm prose-h3:text-sm
            prose-p:my-1.5 prose-p:leading-relaxed
            prose-ul:my-1.5 prose-ul:pl-4 prose-li:my-0.5
            prose-ol:my-1.5 prose-ol:pl-4
            prose-strong:text-white prose-strong:font-semibold
            prose-code:text-emerald-300 prose-code:bg-slate-900 prose-code:px-1 prose-code:rounded prose-code:text-xs
            prose-pre:bg-slate-900 prose-pre:rounded prose-pre:p-3 prose-pre:text-xs prose-pre:overflow-x-auto
            prose-blockquote:border-l-2 prose-blockquote:border-slate-500 prose-blockquote:pl-3 prose-blockquote:text-slate-400
            prose-hr:border-slate-600
            prose-table:text-xs prose-table:w-full
            prose-thead:border-b prose-thead:border-slate-600
            prose-th:text-slate-300 prose-th:font-semibold prose-th:py-1.5 prose-th:px-2 prose-th:text-left
            prose-td:py-1 prose-td:px-2 prose-td:border-b prose-td:border-slate-700/50
            prose-tr:transition-colors">
            <Markdown remarkPlugins={[remarkGfm]}>{message.content || (message.streaming ? '▍' : '')}</Markdown>
          </div>
        </div>
        {/* Tool call cards — shown while streaming and after */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mt-2 flex flex-col gap-1.5">
            {message.toolCalls.map((call, i) => (
              <ToolCallDispatch key={i} call={call} />
            ))}
          </div>
        )}
        {message.streaming && (
          <div className="mt-1 ml-1 flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: '0ms' }} />
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: '150ms' }} />
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        )}
        {message.optionSuggestions && message.optionSuggestions.length > 0 && (
          <div className="mt-2 flex flex-col gap-1.5">
            <div className="text-[10px] text-slate-500 uppercase tracking-wide font-medium ml-0.5 mb-0.5">
              Suggested options
            </div>
            {message.optionSuggestions.map((s, i) => (
              <OptionSuggestionCard key={i} suggestion={s} onWatch={onWatchOption} onViewChain={onViewChain} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
