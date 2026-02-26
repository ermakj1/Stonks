import React from 'react';
import type { AIProvider } from '../types';

interface Props {
  provider: AIProvider;
  onProviderChange: (p: AIProvider) => void;
  onRefreshPrices: () => void;
  pricesLoading: boolean;
  lastRefreshed: Date | null;
}

export function SettingsBar({ provider, onProviderChange, onRefreshPrices, pricesLoading, lastRefreshed }: Props) {
  const timeLabel = lastRefreshed
    ? lastRefreshed.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })
    : null;

  return (
    <div className="flex items-center justify-between px-5 py-2.5 bg-slate-900 border-b border-slate-800 flex-shrink-0">
      {/* Brand */}
      <div className="flex items-center gap-2">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-emerald-400 flex-shrink-0">
          <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
          <polyline points="16 7 22 7 22 13" />
        </svg>
        <span className="text-white font-bold text-lg tracking-tight">Stonks</span>
        <span className="text-slate-700 text-sm mx-1">|</span>
        <span className="text-slate-500 text-xs tracking-wide">AI Trading Assistant</span>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-4">
        {/* Model selector */}
        <div className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${provider === 'none' ? 'bg-slate-600' : 'bg-emerald-400 animate-pulse'}`} />
          <div className="relative">
            <select
              value={provider}
              onChange={(e) => onProviderChange(e.target.value as AIProvider)}
              style={{ backgroundColor: 'transparent', color: '#f1f5f9' }}
              className="appearance-none text-xs font-medium pr-5 focus:outline-none cursor-pointer"
            >
              <option value="anthropic" style={{ backgroundColor: '#1e293b' }}>Claude (Anthropic)</option>
              <option value="gemini" style={{ backgroundColor: '#1e293b' }}>Gemini (Google)</option>
              <option value="none" style={{ backgroundColor: '#1e293b' }}>No AI</option>
            </select>
            <span className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]">▾</span>
          </div>
        </div>

        {/* Refresh section */}
        <div className="flex items-center gap-2">
          {timeLabel && (
            <span className="text-slate-500 text-xs tabular-nums">
              Updated {timeLabel}
            </span>
          )}
          <button
            onClick={onRefreshPrices}
            disabled={pricesLoading}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-sm font-semibold rounded-lg px-4 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-md shadow-emerald-900/40"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={`flex-shrink-0 ${pricesLoading ? 'animate-spin' : ''}`}>
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
            {pricesLoading ? 'Updating…' : 'Refresh Prices'}
          </button>
        </div>
      </div>
    </div>
  );
}
