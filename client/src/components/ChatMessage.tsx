import React from 'react';
import Markdown from 'react-markdown';
import type { Message } from '../types';

interface Props {
  message: Message;
}

export function ChatMessage({ message }: Props) {
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
            prose-hr:border-slate-600">
            <Markdown>{message.content || (message.streaming ? '▍' : '')}</Markdown>
          </div>
        </div>
        {message.streaming && (
          <div className="mt-1 ml-1 flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: '0ms' }} />
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: '150ms' }} />
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        )}
      </div>
    </div>
  );
}
