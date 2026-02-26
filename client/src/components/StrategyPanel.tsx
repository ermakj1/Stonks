import React, { useState, useEffect, useCallback } from 'react';

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

  // Ctrl/Cmd+S to save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (isDirty) save();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isDirty, save]);

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
          <span className="text-[10px] text-slate-600 hidden sm:block">⌘S to save</span>
          <button
            onClick={save}
            disabled={saving || !isDirty}
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
        </div>
      </div>

      {/* Editor */}
      <textarea
        value={draft}
        onChange={e => setDraft(e.target.value)}
        spellCheck={false}
        className="flex-1 w-full resize-none bg-slate-950 text-slate-300 p-5 font-mono text-sm leading-relaxed focus:outline-none"
        style={{ tabSize: 2 }}
        placeholder={placeholder}
      />
    </div>
  );
}
