import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { AIProvider, Holdings, PricesResponse, AccountMeta } from './types';
import { SettingsBar } from './components/SettingsBar';
import { HoldingsPanel } from './components/HoldingsPanel';
import { Chat } from './components/Chat';
import { StrategyPanel } from './components/StrategyPanel';
import { DebugPanel } from './components/DebugPanel';

type RightTab = 'chat' | 'strategy' | 'prompt' | 'debug';

export default function App() {
  const [provider, setProvider] = useState<AIProvider>('anthropic');
  const [rightTab, setRightTab] = useState<RightTab>('chat');
  const [holdings, setHoldings] = useState<Holdings | null>(null);
  const [strategy, setStrategy] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [prices, setPrices] = useState<PricesResponse | null>(null);
  const [pricesLoading, setPricesLoading] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  // Account state
  const [accounts, setAccounts] = useState<AccountMeta[]>([]);
  const [activeAccount, setActiveAccount] = useState<AccountMeta | null>(null);

  // Resizable split pane
  const [splitPct, setSplitPct] = useState(62); // holdings gets 62% by default
  const dragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const onMouseDown = () => { dragging.current = true; };
  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    setSplitPct(Math.min(85, Math.max(30, pct)));
  }, []);
  const onMouseUp = () => { dragging.current = false; };

  useEffect(() => {
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [onMouseMove]);

  const fetchHoldings = useCallback(async () => {
    try {
      const res = await fetch('/api/holdings');
      setHoldings(await res.json() as Holdings);
    } catch (err) {
      console.error('Failed to fetch holdings:', err);
    }
  }, []);

  const fetchStrategy = useCallback(async () => {
    try {
      const res = await fetch('/api/strategy');
      const data = await res.json() as { content: string };
      setStrategy(data.content);
    } catch (err) {
      console.error('Failed to fetch strategy:', err);
    }
  }, []);

  const fetchSystemPrompt = useCallback(async () => {
    try {
      const res = await fetch('/api/system-prompt');
      const data = await res.json() as { content: string };
      setSystemPrompt(data.content);
    } catch (err) {
      console.error('Failed to fetch system prompt:', err);
    }
  }, []);

  const fetchPrices = useCallback(async () => {
    setPricesLoading(true);
    try {
      const res = await fetch('/api/prices');
      setPrices(await res.json() as PricesResponse);
      setLastRefreshed(new Date());
    } catch (err) {
      console.error('Failed to fetch prices:', err);
    } finally {
      setPricesLoading(false);
    }
  }, []);

  const fetchAccounts = useCallback(async () => {
    try {
      const [listRes, activeRes] = await Promise.all([
        fetch('/api/accounts'),
        fetch('/api/accounts/active'),
      ]);
      const list = await listRes.json() as AccountMeta[];
      const { id, account } = await activeRes.json() as { id: string; account: { id: string; name: string } };
      setAccounts(list);
      setActiveAccount({ id, name: account.name });
    } catch (err) {
      console.error('Failed to fetch accounts:', err);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
    fetchHoldings();
    fetchStrategy();
    fetchSystemPrompt();
    fetchPrices();
  }, [fetchAccounts, fetchHoldings, fetchStrategy, fetchSystemPrompt, fetchPrices]);

  const handleHoldingsUpdated = useCallback(async () => {
    await fetchHoldings();
    await fetchPrices();
  }, [fetchHoldings, fetchPrices]);

  const handleStrategyUpdated = useCallback(async () => {
    await fetchStrategy();
  }, [fetchStrategy]);

  const handleSystemPromptUpdated = useCallback(async () => {
    await fetchSystemPrompt();
  }, [fetchSystemPrompt]);

  const switchAccount = useCallback(async (id: string) => {
    try {
      const res = await fetch('/api/accounts/active', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const { account } = await res.json() as { id: string; account: { id: string; name: string } };
      setActiveAccount({ id, name: account.name });
      // Re-fetch all account-specific data
      await Promise.all([fetchHoldings(), fetchStrategy(), fetchPrices()]);
    } catch (err) {
      console.error('Failed to switch account:', err);
    }
  }, [fetchHoldings, fetchStrategy, fetchPrices]);

  const createAccount = useCallback(async (name: string) => {
    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const newAccount = await res.json() as { id: string; name: string };
      await fetchAccounts();
      await switchAccount(newAccount.id);
    } catch (err) {
      console.error('Failed to create account:', err);
    }
  }, [fetchAccounts, switchAccount]);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-950">
      <SettingsBar
        provider={provider}
        onProviderChange={setProvider}
        onRefreshPrices={fetchPrices}
        pricesLoading={pricesLoading}
        lastRefreshed={lastRefreshed}
        accounts={accounts}
        activeAccount={activeAccount}
        onSwitchAccount={switchAccount}
        onCreateAccount={createAccount}
      />

      <div ref={containerRef} className="flex flex-1 overflow-hidden">
        {/* Holdings pane */}
        <div style={{ width: `${splitPct}%` }} className="flex flex-col overflow-hidden border-r border-slate-800">
          <HoldingsPanel holdings={holdings} prices={prices} loading={pricesLoading && !prices} onHoldingsUpdated={handleHoldingsUpdated} />
        </div>

        {/* Drag handle */}
        <div
          onMouseDown={onMouseDown}
          className="w-1 flex-shrink-0 bg-slate-800 hover:bg-blue-500 cursor-col-resize transition-colors active:bg-blue-400"
          title="Drag to resize"
        />

        {/* Right pane */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Tab bar */}
          <div className="flex border-b border-slate-800 bg-slate-900 flex-shrink-0">
            {([['chat', 'AI Chat'], ['strategy', 'Strategy'], ['prompt', 'System Prompt'], ['debug', 'AI Context']] as [RightTab, string][]).map(([tab, label]) => (
              <button
                key={tab}
                onClick={() => setRightTab(tab)}
                className={`px-5 py-2.5 text-xs font-semibold uppercase tracking-widest transition-colors border-b-2 ${
                  rightTab === tab
                    ? 'text-white border-emerald-500'
                    : 'text-slate-500 border-transparent hover:text-slate-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-hidden">
            {rightTab === 'chat' && (
              <Chat
                provider={provider}
                holdings={holdings}
                strategy={strategy}
                onHoldingsUpdated={handleHoldingsUpdated}
                onStrategyUpdated={handleStrategyUpdated}
              />
            )}
            {rightTab === 'strategy' && (
              <StrategyPanel
                value={strategy}
                apiPath="/api/strategy"
                onSaved={handleStrategyUpdated}
                placeholder={'Write your trading strategy in Markdown…\n\n## Goals\n- Long-term growth\n\n## Rules\n- Never trade on emotion'}
              />
            )}
            {rightTab === 'prompt' && (
              <StrategyPanel
                value={systemPrompt}
                apiPath="/api/system-prompt"
                onSaved={handleSystemPromptUpdated}
                hint="Strategy, holdings & live prices are appended automatically"
                placeholder={'You are a stock trading assistant…\n\nDescribe the AI\'s personality, tone, and any standing instructions.'}
              />
            )}
            {rightTab === 'debug' && <DebugPanel />}
          </div>
        </div>
      </div>
    </div>
  );
}
