import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { Message, AIProvider, FileUpdate, Holdings } from '../types';
import { ChatMessage } from './ChatMessage';
import { FileDiffModal } from './FileDiffModal';

interface Props {
  provider: AIProvider;
  holdings: Holdings | null;
  strategy: string;
  onHoldingsUpdated: () => void;
  onStrategyUpdated: () => void;
}

const FILE_UPDATE_RE = /<<<FILE_UPDATE>>>([\s\S]*?)<<<END_FILE_UPDATE>>>/;

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

export function Chat({ provider, holdings, strategy, onHoldingsUpdated, onStrategyUpdated }: Props) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: "Hi! I'm your AI trading assistant. I have full context of your holdings, strategy, and live market prices. Ask me anything about your portfolio, or tell me to update your holdings or strategy.",
    },
  ]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState<FileUpdate | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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
      const chatMessages = [...messages, userMessage].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: chatMessages, provider }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!response.body) throw new Error('No response body');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let buffer = '';

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
            const parsed = JSON.parse(data) as { text: string };
            fullText += parsed.text;

            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: fullText, streaming: true }
                  : m
              )
            );
          } catch {
            // skip malformed SSE data
          }
        }
      }

      // Extract file updates from the final text
      const { clean, update } = extractFileUpdate(fullText);

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: clean, streaming: false }
            : m
        )
      );

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
            Select <span className="text-slate-300 font-medium">Claude (Anthropic)</span> or <span className="text-slate-300 font-medium">Gemini (Google)</span> from the provider menu above to enable AI chat. No API credits will be used while "No AI" is selected.
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
          <ChatMessage key={msg.id} message={msg} />
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
        <p className="text-[10px] text-slate-600 mt-1.5 ml-1">Enter to send · Shift+Enter for new line</p>
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
