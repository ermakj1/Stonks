import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { Message, AIProvider, FileUpdate, Holdings, OptionSuggestion, ToolCallRecord } from '../types';
import { ChatMessage } from './ChatMessage';
import { FileDiffModal } from './FileDiffModal';

interface Props {
  provider: AIProvider;
  model: string;
  providerKeys: Record<string, boolean>;
  holdings: Holdings | null;
  strategy: string;
  activeAccountId: string | null;
  onHoldingsUpdated: () => void;
  onStrategyUpdated: () => void;
  onOpenChain?: (ticker: string, highlights: OptionSuggestion[]) => void;
}

const FILE_UPDATE_RE = /<<<FILE_UPDATE>>>([\s\S]*?)<<<END_FILE_UPDATE>>>/;

const WELCOME_MESSAGE: Message = {
  id: 'welcome',
  role: 'assistant',
  content: "Hi! I'm your AI trading assistant. I have full context of your holdings, strategy, and live market prices. Ask me anything about your portfolio, or tell me to update your holdings or strategy.",
};
const AI_CONTEXT_MESSAGES = 20; // last N messages sent to AI (10 turns)
const MAX_STORED_MESSAGES = 200;
const storageKey = (id: string | null) => id ? `stonks_chat_${id}` : null;
const OPTION_SUGGESTION_RE = /<<<OPTION_SUGGESTION>>>([\s\S]*?)<<<END_OPTION_SUGGESTION>>>/g;

function extractFileUpdate(text: string): { clean: string; update: FileUpdate | null } {
  const match = FILE_UPDATE_RE.exec(text);
  if (!match) return { clean: text, update: null };

  try {
    const update = JSON.parse(match[1].trim()) as FileUpdate;
    const clean = text.replace(FILE_UPDATE_RE, '').trim();
    return { clean, update };
  } catch {
    return { clean: text, update: null };
  }
}

function extractOptionSuggestions(text: string): { clean: string; suggestions: OptionSuggestion[] } {
  const suggestions: OptionSuggestion[] = [];
  const clean = text.replace(OPTION_SUGGESTION_RE, (_, json) => {
    try { suggestions.push(JSON.parse(json.trim()) as OptionSuggestion); } catch {}
    return '';
  }).trim();
  return { clean, suggestions };
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', userSelect: 'none' }} onClick={onChange}>
      <div style={{ position: 'relative', width: 26, height: 14, flexShrink: 0 }}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: 7, background: checked ? '#059669' : '#334155', transition: 'background 0.18s' }} />
        <div style={{ position: 'absolute', top: 2, left: checked ? 12 : 2, width: 10, height: 10, borderRadius: '50%', background: 'white', transition: 'left 0.18s', boxShadow: '0 1px 3px rgba(0,0,0,0.4)' }} />
      </div>
      <span style={{ fontSize: 11, color: checked ? '#94a3b8' : '#475569', transition: 'color 0.18s' }}>{label}</span>
    </label>
  );
}

export function Chat({ provider, model, providerKeys, holdings, strategy, activeAccountId, onHoldingsUpdated, onStrategyUpdated, onOpenChain }: Props) {
  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState<FileUpdate | null>(null);
  const [includeHoldings, setIncludeHoldings] = useState(true);
  const [includeHistory, setIncludeHistory] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load history from localStorage when account changes
  useEffect(() => {
    const key = storageKey(activeAccountId);
    if (!key) { setMessages([WELCOME_MESSAGE]); return; }
    try {
      const stored = localStorage.getItem(key);
      if (stored) {
        const parsed = JSON.parse(stored) as Message[];
        setMessages(parsed.filter(m => !m.streaming).length > 0 ? parsed.filter(m => !m.streaming) : [WELCOME_MESSAGE]);
      } else {
        setMessages([WELCOME_MESSAGE]);
      }
    } catch {
      setMessages([WELCOME_MESSAGE]);
    }
  }, [activeAccountId]);

  // Persist history to localStorage after each completed exchange
  useEffect(() => {
    const key = storageKey(activeAccountId);
    if (!key || isStreaming) return;
    const toStore = messages.filter(m => !m.streaming).slice(-MAX_STORED_MESSAGES);
    try { localStorage.setItem(key, JSON.stringify(toStore)); } catch {}
  }, [messages, isStreaming, activeAccountId]);

  const clearHistory = useCallback(() => {
    setMessages([WELCOME_MESSAGE]);
    const key = storageKey(activeAccountId);
    if (key) localStorage.removeItem(key);
  }, [activeAccountId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming || provider === 'none') return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
    };

    const assistantId = (Date.now() + 1).toString();
    const assistantMessage: Message = {
      id: assistantId,
      role: 'assistant',
      content: '',
      streaming: true,
    };

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setInput('');
    setIsStreaming(true);

    try {
      const chatMessages = [...messages, userMessage]
        .filter(m => !m.streaming)
        .slice(-AI_CONTEXT_MESSAGES)
        .map(m => ({ role: m.role, content: m.content }));

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: chatMessages, provider, model, includeHoldings, includeHistory }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!response.body) throw new Error('No response body');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let buffer = '';
      const toolCallsAccum: ToolCallRecord[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') break;

          try {
            const parsed = JSON.parse(data) as {
              text?: string;
              tool_call?: { name: string; input: Record<string, unknown> };
            };

            if (parsed.text) {
              fullText += parsed.text;
            } else if (parsed.tool_call) {
              const inp = parsed.tool_call.input;
              // Store structured data — rendered as a card, not markdown text
              toolCallsAccum.push({
                name:  parsed.tool_call.name,
                input: {
                  // get_option_chain fields
                  ticker:      inp.ticker      ? String(inp.ticker).toUpperCase() : undefined,
                  type:        inp.type        ? String(inp.type)                 : undefined,
                  dte_min:     inp.dte_min     != null ? Number(inp.dte_min)      : undefined,
                  dte_max:     inp.dte_max     != null ? Number(inp.dte_max)      : undefined,
                  otm_only:    inp.otm_only    != null ? Boolean(inp.otm_only)    : undefined,
                  max_results: inp.max_results != null ? Number(inp.max_results)  : undefined,
                  delta_min:   inp.delta_min   != null ? Number(inp.delta_min)    : undefined,
                  delta_max:   inp.delta_max   != null ? Number(inp.delta_max)    : undefined,
                  strike_min:  inp.strike_min  != null ? Number(inp.strike_min)   : undefined,
                  strike_max:  inp.strike_max  != null ? Number(inp.strike_max)   : undefined,
                  price_min:   inp.price_min   != null ? Number(inp.price_min)    : undefined,
                  price_max:   inp.price_max   != null ? Number(inp.price_max)    : undefined,
                  // get_option_price fields
                  strike:      inp.strike      != null ? Number(inp.strike)       : undefined,
                  expiration:  inp.expiration  ? String(inp.expiration)           : undefined,
                },
              });
              // Show a lightweight in-progress indicator during streaming
              setMessages(prev => prev.map(m => m.id === assistantId
                ? { ...m, toolCalls: [...toolCallsAccum], streaming: true }
                : m
              ));
            }

            // During streaming, hide any partial/complete suggestion blocks
            const displayText = fullText.replace(/<<<OPTION_SUGGESTION>>>[\s\S]*$/s, '').trim();
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: displayText, streaming: true }
                  : m
              )
            );
          } catch {
            // skip malformed SSE data
          }
        }
      }

      // Extract file updates and option suggestions from the final text
      const { clean: afterFileUpdate, update } = extractFileUpdate(fullText);
      const { clean, suggestions } = extractOptionSuggestions(afterFileUpdate);

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content: clean,
                streaming: false,
                optionSuggestions: suggestions.length > 0 ? suggestions : undefined,
                toolCalls: toolCallsAccum.length > 0 ? toolCallsAccum : undefined,
              }
            : m
        )
      );

      // Auto-open option chain with AI suggestions highlighted
      if (suggestions.length > 0 && onOpenChain) {
        onOpenChain(suggestions[0].ticker, suggestions);
      }

      if (update) {
        setPendingUpdate(update);
      }
    } catch (err) {
      console.error('Chat error:', err);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: 'Error: Failed to get response. Please try again.', streaming: false }
            : m
        )
      );
    } finally {
      setIsStreaming(false);
    }
  }, [input, isStreaming, messages, provider]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleApprove = async () => {
    if (!pendingUpdate) return;

    try {
      if (pendingUpdate.file === 'holdings') {
        await fetch('/api/holdings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pendingUpdate.content),
        });
        onHoldingsUpdated();
      } else {
        await fetch('/api/strategy', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: pendingUpdate.content }),
        });
        onStrategyUpdated();
      }

      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: 'assistant',
          content: `Changes to ${pendingUpdate.file} saved successfully.`,
        },
      ]);
    } catch (err) {
      console.error('Save error:', err);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: 'assistant',
          content: `Failed to save changes to ${pendingUpdate.file}.`,
        },
      ]);
    }

    setPendingUpdate(null);
  };

  const handleWatchOption = useCallback(async (suggestion: OptionSuggestion) => {
    await fetch('/api/holdings/watch-option', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(suggestion),
    });
    onHoldingsUpdated();
  }, [onHoldingsUpdated]);

  const handleReject = () => {
    setMessages((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        role: 'assistant',
        content: `Changes to ${pendingUpdate?.file} were rejected.`,
      },
    ]);
    setPendingUpdate(null);
  };

  if (provider === 'none') {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-4 px-8 text-center">
        <div className="w-12 h-12 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-slate-500">
            <circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
          </svg>
        </div>
        <div>
          <p className="text-slate-300 font-semibold text-sm mb-1">AI chat is disabled</p>
          <p className="text-slate-500 text-xs leading-relaxed max-w-xs">
            Select <span className="text-slate-300 font-medium">Claude (Anthropic)</span> or <span className="text-slate-300 font-medium">Gemini (Google)</span> from the provider menu above to enable AI chat.
          </p>
        </div>
      </div>
    );
  }

  const KEY_NAME: Record<string, string> = { anthropic: 'ANTHROPIC_API_KEY', gemini: 'GEMINI_API_KEY' };
  const PROVIDER_LABEL: Record<string, string> = { anthropic: 'Anthropic (Claude)', gemini: 'Google (Gemini)' };
  const PROVIDER_URL: Record<string, string> = {
    anthropic: 'https://console.anthropic.com/settings/keys',
    gemini: 'https://aistudio.google.com/app/apikey',
  };

  if (providerKeys[provider] === false) {
    const keyName = KEY_NAME[provider] ?? 'API_KEY';
    const label   = PROVIDER_LABEL[provider] ?? provider;
    const url     = PROVIDER_URL[provider];
    return (
      <div className="flex flex-col h-full items-center justify-center gap-5 px-10 text-center">
        <div className="w-14 h-14 rounded-full bg-amber-400/10 border border-amber-400/30 flex items-center justify-center">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-amber-400">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
        <div className="flex flex-col gap-2 max-w-sm">
          <p className="text-slate-200 font-semibold text-sm">No API key for {label}</p>
          <p className="text-slate-500 text-xs leading-relaxed">
            Add your key to the <code className="text-slate-300 bg-slate-800 px-1.5 py-0.5 rounded text-[11px]">.env</code> file in the project root, then restart the server.
          </p>
          <div className="mt-1 bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-left">
            <p className="text-slate-500 text-[10px] font-semibold uppercase tracking-wider mb-1.5">In your .env file:</p>
            <code className="text-emerald-400 text-xs font-mono">{keyName}=your_key_here</code>
          </div>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 text-xs text-blue-400 hover:text-blue-300 underline underline-offset-2 transition-colors"
          >
            Get a {label} API key →
          </a>
          <p className="text-slate-600 text-[11px] mt-1">
            Or switch to a different provider in the menu above.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full relative">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-2">
        {messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} onWatchOption={handleWatchOption} onViewChain={onOpenChain ? (s) => onOpenChain(s.ticker, [s]) : undefined} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 pb-4 pt-3 border-t border-slate-800 bg-slate-900/40">
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your portfolio…"
            rows={2}
            disabled={isStreaming}
            className="flex-1 bg-slate-800 border border-slate-700 text-white text-sm rounded-xl px-4 py-3 resize-none focus:outline-none focus:border-emerald-500/70 focus:ring-1 focus:ring-emerald-500/20 placeholder-slate-500 disabled:opacity-50 transition-colors"
          />
          <button
            onClick={sendMessage}
            disabled={isStreaming || !input.trim()}
            className="px-4 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-30 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-colors flex items-center gap-2 whitespace-nowrap shadow-lg shadow-emerald-900/30"
          >
            {isStreaming ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin flex-shrink-0">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                Thinking
              </>
            ) : (
              <>
                Send
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="flex-shrink-0">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </>
            )}
          </button>
        </div>
        <div className="flex items-center gap-4 mt-2 ml-0.5">
          <Toggle checked={includeHoldings} onChange={() => setIncludeHoldings(v => !v)} label="Holdings" />
          <Toggle checked={includeHistory} onChange={() => setIncludeHistory(v => !v)} label="Trade History" />
          <span className="flex-1" />
          <button onClick={clearHistory} className="text-[10px] text-slate-600 hover:text-slate-400 transition-colors">Clear history</button>
          <p className="text-[10px] text-slate-600">Enter to send · Shift+Enter for new line</p>
        </div>
      </div>

      {/* File diff modal */}
      {pendingUpdate && (
        <FileDiffModal
          update={pendingUpdate}
          currentHoldings={holdings}
          currentStrategy={strategy}
          onApprove={handleApprove}
          onReject={handleReject}
        />
      )}
    </div>
  );
}
