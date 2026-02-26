import React, { useMemo } from 'react';
import { diffLines } from 'diff';
import type { FileUpdate, Holdings } from '../types';

interface Props {
  update: FileUpdate;
  currentHoldings: Holdings | null;
  currentStrategy: string;
  onApprove: () => void;
  onReject: () => void;
}

function holdingsToText(h: Holdings): string {
  return JSON.stringify(h, null, 2);
}

export function FileDiffModal({ update, currentHoldings, currentStrategy, onApprove, onReject }: Props) {
  const { oldText, newText } = useMemo(() => {
    if (update.file === 'holdings') {
      return {
        oldText: currentHoldings ? holdingsToText(currentHoldings) : '',
        newText: typeof update.content === 'string'
          ? update.content
          : holdingsToText(update.content as Holdings),
      };
    } else {
      return {
        oldText: currentStrategy,
        newText: update.content as string,
      };
    }
  }, [update, currentHoldings, currentStrategy]);

  const diffResult = useMemo(() => diffLines(oldText, newText), [oldText, newText]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-[700px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800">
          <div>
            <h2 className="text-base font-semibold text-gray-100">
              Proposed Update: <span className="text-green-400">{update.file}.{update.file === 'holdings' ? 'json' : 'md'}</span>
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">Review the changes below before approving</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onReject}
              className="px-4 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-gray-300 transition-colors"
            >
              Reject
            </button>
            <button
              onClick={onApprove}
              className="px-4 py-1.5 text-sm bg-green-700 hover:bg-green-600 rounded text-white font-medium transition-colors"
            >
              Approve & Save
            </button>
          </div>
        </div>

        {/* Diff view */}
        <div className="overflow-y-auto flex-1 p-4 font-mono text-xs">
          {diffResult.map((part, i) => (
            <div
              key={i}
              className={`whitespace-pre-wrap leading-5 px-2 rounded ${
                part.added
                  ? 'bg-green-950/50 text-green-300 border-l-2 border-green-500'
                  : part.removed
                  ? 'bg-red-950/50 text-red-300 border-l-2 border-red-500 line-through opacity-60'
                  : 'text-gray-500'
              }`}
            >
              {part.added ? '+ ' : part.removed ? '- ' : '  '}
              {part.value}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
