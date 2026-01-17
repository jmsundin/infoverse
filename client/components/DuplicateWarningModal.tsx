import React, { useState, useMemo } from 'react';
import { DuplicateCheckResult } from '../types';
import { deriveTitleFromContent } from '../utils/titleUtils';

interface DuplicateWarningModalProps {
  isOpen: boolean;
  duplicates: DuplicateCheckResult[];
  onCreateAll: () => void;
  onLinkToExisting: (mapping: Map<number, string>) => void;
  onCancel: () => void;
}

export const DuplicateWarningModal: React.FC<DuplicateWarningModalProps> = ({
  isOpen,
  duplicates,
  onCreateAll,
  onLinkToExisting,
  onCancel,
}) => {
  // Track which duplicates should link to existing nodes
  // Map: proposedIndex -> existingNodeId
  const [linkSelections, setLinkSelections] = useState<Map<number, string>>(new Map());

  // Initialize with high-similarity matches (>95%) pre-selected
  useMemo(() => {
    const initial = new Map<number, string>();
    duplicates.forEach((dup) => {
      const highMatch = dup.matches.find((m) => m.similarity >= 0.95);
      if (highMatch) {
        initial.set(dup.proposedIndex, highMatch.id);
      }
    });
    setLinkSelections(initial);
  }, [duplicates]);

  if (!isOpen || duplicates.length === 0) return null;

  const toggleLink = (proposedIndex: number, existingId: string) => {
    setLinkSelections((prev) => {
      const next = new Map(prev);
      if (next.get(proposedIndex) === existingId) {
        next.delete(proposedIndex);
      } else {
        next.set(proposedIndex, existingId);
      }
      return next;
    });
  };

  const handleApplySelections = () => {
    onLinkToExisting(linkSelections);
  };

  const selectedCount = linkSelections.size;
  const createCount = duplicates.length - selectedCount;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden animate-in fade-in zoom-in duration-200 flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-slate-700">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-amber-500/20 rounded-full flex items-center justify-center">
              <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Potential Duplicates Found</h2>
              <p className="text-slate-400 text-sm">
                {duplicates.length} proposed node{duplicates.length > 1 ? 's' : ''} may already exist in your graph
              </p>
            </div>
          </div>
        </div>

        {/* Scrollable duplicate list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {duplicates.map((dup) => (
            <div key={dup.proposedIndex} className="bg-slate-900/50 rounded-lg p-4 border border-slate-700">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-white font-medium">{dup.proposedName}</span>
                <span className="text-slate-500">→</span>
              </div>

              <div className="space-y-2 ml-4">
                {dup.matches.map((match) => {
                  const isSelected = linkSelections.get(dup.proposedIndex) === match.id;
                  const title = deriveTitleFromContent(match.content) || 'Untitled';
                  const similarityPct = Math.round(match.similarity * 100);

                  return (
                    <button
                      key={match.id}
                      onClick={() => toggleLink(dup.proposedIndex, match.id)}
                      className={`w-full text-left p-3 rounded-lg border transition-all ${
                        isSelected
                          ? 'bg-sky-900/30 border-sky-500'
                          : 'bg-slate-800 border-slate-600 hover:border-slate-500'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {}}
                            className="w-4 h-4 rounded border-slate-500 text-sky-500 focus:ring-sky-500 focus:ring-offset-slate-800"
                          />
                          <span className="text-slate-200 truncate">{title}</span>
                        </div>
                        <span className={`text-xs font-medium px-2 py-1 rounded-full shrink-0 ${
                          similarityPct >= 95
                            ? 'bg-red-500/20 text-red-400'
                            : 'bg-amber-500/20 text-amber-400'
                        }`}>
                          {similarityPct}% similar
                        </span>
                      </div>
                      {match.summary && (
                        <p className="text-slate-400 text-sm mt-1 ml-6 line-clamp-2">{match.summary}</p>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Footer with actions */}
        <div className="p-4 border-t border-slate-700 bg-slate-800/50">
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={onCancel}
              className="px-4 py-2 text-slate-400 hover:text-slate-300 transition-colors"
            >
              Cancel
            </button>
            <div className="flex-1" />
            <button
              onClick={onCreateAll}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-all"
            >
              Create All Anyway
            </button>
            <button
              onClick={handleApplySelections}
              className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white font-medium rounded-lg transition-all"
            >
              {selectedCount > 0
                ? `Link ${selectedCount}, Create ${createCount}`
                : `Create All (${duplicates.length})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
