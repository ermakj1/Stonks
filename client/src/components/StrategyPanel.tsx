import React, { useState, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';

interface Props {
  value: string;
  apiPath: string;
  onSaved: () => void;
  placeholder?: string;
  hint?: string;
}

export function StrategyPanel({ value, apiPath, onSaved, placeholder, hint }: Props) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [editing, setEditing] = useState(false);

  // Sync if parent reloads content (e.g. after AI update)
  useEffect(() => { setDraft(value); }, [value]);

  const isDirty = draft !== value;

  const save = useCallback(async () => {
    setSaving(true);
    try {
      await fetch(apiPath, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: draft }),
      });
      setSavedAt(new Date());
      onSaved();
    } catch (err) {
      console.error('Failed to save:', err);
    } finally {
      setSaving(false);
    }
  }, [draft, apiPath, onSaved]);

  const saveAndPreview = useCallback(async () => {
    if (isDirty) await save();
    setEditing(false);
  }, [isDirty, save]);

  // Ctrl/Cmd+S to save (and return to preview)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (editing) saveAndPreview();
        else if (isDirty) save();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [editing, isDirty, save, saveAndPreview]);

  const timeLabel = savedAt?.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });

  return (
    <div className="flex flex-col h-full bg-slate-950">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-slate-900 flex-shrink-0">
        <div className="flex items-center gap-2">
          {hint && <span className="text-xs text-slate-600 hidden sm:block">{hint}</span>}
          {isDirty && (
            <span className="text-[10px] font-semibold text-amber-400 uppercase tracking-wide bg-amber-400/10 px-2 py-0.5 rounded">
              Unsaved
            </span>
          )}
          {!isDirty && timeLabel && (
            <span className="text-[10px] text-slate-600 tabular-nums">Saved {timeLabel}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <span className="text-[10px] text-slate-600 hidden sm:block">⌘S to save</span>
              <button
                onClick={() => { setDraft(value); setEditing(false); }}
                className="text-xs text-slate-500 hover:text-slate-300 px-2 py-1.5 rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveAndPreview}
                disabled={saving}
                className="flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-md px-3 py-1.5 transition-colors"
              >
                {saving ? (
                  <>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin">
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                    Saving…
                  </>
                ) : (
                  <>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                      <polyline points="17 21 17 13 7 13 7 21" />
                      <polyline points="7 3 7 8 15 8" />
                    </svg>
                    Save
                  </>
                )}
              </button>
            </>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-semibold rounded-md px-3 py-1.5 transition-colors"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              Edit
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      {editing ? (
        <textarea
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          spellCheck={false}
          className="flex-1 w-full resize-none bg-slate-950 text-slate-300 p-5 font-mono text-sm leading-relaxed focus:outline-none"
          style={{ tabSize: 2 }}
          placeholder={placeholder}
        />
      ) : (
        <div
          className="flex-1 overflow-y-auto px-8 py-6 cursor-text"
          onDoubleClick={() => setEditing(true)}
          title="Double-click to edit"
        >
          {draft.trim() ? (
            <div className="prose-stonks max-w-2xl">
              <ReactMarkdown
                components={{
                  h1: ({ children }) => <h1 style={{ fontSize: 22, fontWeight: 700, color: '#e2e8f0', marginBottom: 12, marginTop: 24, borderBottom: '1px solid #1e293b', paddingBottom: 8 }}>{children}</h1>,
                  h2: ({ children }) => <h2 style={{ fontSize: 17, fontWeight: 700, color: '#e2e8f0', marginBottom: 8, marginTop: 20 }}>{children}</h2>,
                  h3: ({ children }) => <h3 style={{ fontSize: 14, fontWeight: 600, color: '#cbd5e1', marginBottom: 6, marginTop: 16 }}>{children}</h3>,
                  p: ({ children }) => <p style={{ color: '#94a3b8', fontSize: 14, lineHeight: 1.7, marginBottom: 12 }}>{children}</p>,
                  ul: ({ children }) => <ul style={{ color: '#94a3b8', fontSize: 14, lineHeight: 1.7, paddingLeft: 20, marginBottom: 12 }}>{children}</ul>,
                  ol: ({ children }) => <ol style={{ color: '#94a3b8', fontSize: 14, lineHeight: 1.7, paddingLeft: 20, marginBottom: 12 }}>{children}</ol>,
                  li: ({ children }) => <li style={{ marginBottom: 4 }}>{children}</li>,
                  strong: ({ children }) => <strong style={{ color: '#e2e8f0', fontWeight: 600 }}>{children}</strong>,
                  em: ({ children }) => <em style={{ color: '#cbd5e1' }}>{children}</em>,
                  code: ({ children }) => <code style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 4, padding: '1px 5px', fontSize: 12, color: '#7dd3fc', fontFamily: "ui-monospace, 'Fira Code', monospace" }}>{children}</code>,
                  pre: ({ children }) => <pre style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: '12px 16px', fontSize: 12, overflowX: 'auto', marginBottom: 12, color: '#94a3b8', fontFamily: "ui-monospace, 'Fira Code', monospace" }}>{children}</pre>,
                  blockquote: ({ children }) => <blockquote style={{ borderLeft: '3px solid #334155', paddingLeft: 16, margin: '12px 0', color: '#64748b', fontStyle: 'italic' }}>{children}</blockquote>,
                  hr: () => <hr style={{ border: 'none', borderTop: '1px solid #1e293b', margin: '20px 0' }} />,
                  a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: '#34d399', textDecoration: 'underline', textDecorationColor: 'rgba(52,211,153,0.4)' }}>{children}</a>,
                }}
              >
                {draft}
              </ReactMarkdown>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-slate-700">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              <p className="text-slate-600 text-sm">Nothing written yet.</p>
              <button onClick={() => setEditing(true)} className="text-emerald-600 hover:text-emerald-400 text-sm font-medium transition-colors">
                Click to write
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
