import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { GraphNode, GraphEdge, NodeType, SelectionTooltipState } from '../../types';
import { useChatMode } from '../../hooks/useChatMode';
import { ChatModePanel } from './ChatModePanel';
import { BubbleColumn } from './BubbleColumn';
import { SelectionTooltip } from '../SelectionTooltip';

interface ChatModeContainerProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  initialNodeId: string | null;
  selectionHistory: string[];
  onClose: () => void;
  onUpdateNode: (id: string, updates: Partial<GraphNode>) => void;
  onCreateNode: (parentId: string | null, type: NodeType, content?: string) => GraphNode;
  onDeleteNode: (id: string) => void;
  onNavigateToNode?: (title: string) => void;
  onOpenLink?: (url: string) => void;
  onExpandNode?: (id: string, text: string) => void;
  aiProvider?: 'gemini' | 'huggingface';
  autoGraphEnabled?: boolean;
}

export const ChatModeContainer: React.FC<ChatModeContainerProps> = ({
  nodes,
  edges,
  initialNodeId,
  selectionHistory,
  onClose,
  onUpdateNode,
  onCreateNode,
  onDeleteNode,
  onNavigateToNode,
  onOpenLink,
  onExpandNode,
  aiProvider = 'gemini',
  autoGraphEnabled = false,
}) => {
  // Local selection tooltip state for Chat mode
  const [selectionTooltip, setSelectionTooltip] = useState<SelectionTooltipState | null>(null);
  // Determine entry node
  const entryNodeId = useMemo(() => {
    if (initialNodeId && nodes.find(n => n.id === initialNodeId)) {
      return initialNodeId;
    }
    if (selectionHistory.length > 0) {
      const recentId = selectionHistory.find(id => nodes.find(n => n.id === id));
      if (recentId) return recentId;
    }
    return nodes[0]?.id ?? null;
  }, [initialNodeId, selectionHistory, nodes]);

  // Create node wrapper that returns the node ID
  const handleCreateNode = useCallback((parentId: string, type: NodeType, selectedText?: string) => {
    const newNode = onCreateNode(parentId, type, selectedText);
    return newNode.id;
  }, [onCreateNode]);

  const {
    state,
    focusNode,
    createChildPanel,
    expandBubble,
    previewBubble,
    getVisiblePanels,
    getChildBubbles,
    scrollContainerRef,
  } = useChatMode({
    nodes,
    edges,
    initialNodeId: entryNodeId,
    onCreateNode: handleCreateNode,
  });

  const visiblePanels = getVisiblePanels();
  const childBubbles = getChildBubbles();

  // Handle bubble tap
  const handleBubbleTap = useCallback((nodeId: string, isExpanded: boolean) => {
    if (isExpanded) {
      // Second tap - expand to full panel
      expandBubble(nodeId);
    } else {
      // First tap - show title preview
      previewBubble(nodeId);
    }
  }, [expandBubble, previewBubble]);

  // Handle horizontal scroll with shift+wheel
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      // Allow horizontal scroll with shift+wheel or trackpad horizontal gesture
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        // Native horizontal scroll will handle it
        return;
      }
      // Convert vertical scroll to horizontal when not using shift
      // Only do this if there's significant vertical scroll
      if (Math.abs(e.deltaY) > 10) {
        e.preventDefault();
        container.scrollLeft += e.deltaY;
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [scrollContainerRef]);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Empty state
  if (nodes.length === 0) {
    return (
      <div className="chat-mode-container fixed inset-0 z-50 bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="text-slate-500 text-lg mb-4">No notes yet</div>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
          >
            Return to Graph
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-mode-container fixed inset-0 z-50 bg-slate-900 flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 h-14 bg-slate-800 border-b border-slate-700 flex items-center justify-between px-4">
        <div className="flex items-center gap-4">
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-700 rounded-lg transition-colors text-slate-400 hover:text-white"
            title="Return to Graph (Esc)"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
          </button>
          <div className="text-slate-300 font-medium">
            Chat Mode
          </div>
        </div>

        {/* Breadcrumb trail */}
        <div className="flex items-center gap-2 text-sm text-slate-400 overflow-x-auto">
          {visiblePanels.slice(0, -1).map((panel, idx) => (
            <React.Fragment key={panel.id}>
              <button
                onClick={() => focusNode(panel.id)}
                className="hover:text-white transition-colors truncate max-w-[100px]"
              >
                {panel.title || panel.summary || 'Untitled'}
              </button>
              <span className="text-slate-600">/</span>
            </React.Fragment>
          ))}
          {visiblePanels.length > 0 && (
            <span className="text-white font-medium truncate max-w-[150px]">
              {visiblePanels[visiblePanels.length - 1]?.title ||
                visiblePanels[visiblePanels.length - 1]?.summary ||
                'Untitled'}
            </span>
          )}
        </div>

        <div className="w-10" /> {/* Spacer for balance */}
      </div>

      {/* Panels container */}
      <div className="flex-1 relative overflow-hidden">
        <div
          ref={scrollContainerRef}
          className="chat-mode-scroll-container h-full overflow-x-auto overflow-y-hidden flex scroll-smooth"
          style={{
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
          }}
        >
          {visiblePanels.map((panel, index) => {
            const isFocused = panel.id === state.focusedNodeId;
            const isParentPeek = index < visiblePanels.length - 1 && !isFocused;

            // Only show as parent peek if it's before the focused panel
            const focusedIndex = visiblePanels.findIndex(p => p.id === state.focusedNodeId);
            const showAsPeek = index < focusedIndex;

            return (
              <ChatModePanel
                key={panel.id}
                node={panel}
                allNodes={nodes}
                isFocused={isFocused}
                isParentPeek={showAsPeek}
                onFocus={() => focusNode(panel.id)}
                onUpdate={onUpdateNode}
                onSelectionTooltip={setSelectionTooltip}
                onNavigateToNode={onNavigateToNode}
                onOpenLink={onOpenLink}
                aiProvider={aiProvider}
                autoGraphEnabled={autoGraphEnabled}
                onExpand={onExpandNode}
              />
            );
          })}
        </div>

        {/* Bubble column - positioned relative to the focused panel */}
        {childBubbles.length > 0 && (
          <BubbleColumn
            bubbles={childBubbles}
            onBubbleTap={handleBubbleTap}
          />
        )}
      </div>

      {/* Scroll hint indicators */}
      {visiblePanels.length > 1 && (
        <>
          {/* Left scroll indicator */}
          <div className="absolute left-0 top-1/2 -translate-y-1/2 h-20 w-8 bg-gradient-to-r from-slate-900/80 to-transparent pointer-events-none flex items-center justify-start pl-1">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-slate-500 animate-pulse"
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </div>
        </>
      )}

      {/* CSS for animations and scrollbar hiding */}
      <style>{`
        .chat-mode-scroll-container::-webkit-scrollbar {
          display: none;
        }

        .chat-mode-container {
          animation: fadeIn 200ms ease-out;
        }

        .chat-mode-panel {
          animation: slideInFromRight 300ms ease-out;
        }

        .chat-mode-panel.parent-peek {
          animation: none;
        }

        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        @keyframes slideInFromRight {
          from {
            opacity: 0;
            transform: translateX(50px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
      `}</style>

      {/* Selection Tooltip - Chat Mode handles its own to create child panels */}
      {selectionTooltip && (
        <SelectionTooltip
          tooltip={selectionTooltip}
          onClose={() => setSelectionTooltip(null)}
          onCreateNote={() => {
            if (selectionTooltip.sourceId) {
              createChildPanel(selectionTooltip.sourceId, NodeType.NOTE, selectionTooltip.text);
              setSelectionTooltip(null);
              window.getSelection()?.removeAllRanges();
            }
          }}
          onCreateChat={() => {
            if (selectionTooltip.sourceId) {
              createChildPanel(selectionTooltip.sourceId, NodeType.CHAT, selectionTooltip.text);
              setSelectionTooltip(null);
              window.getSelection()?.removeAllRanges();
            }
          }}
          onExpandGraph={() => {
            if (selectionTooltip.sourceId && onExpandNode) {
              onExpandNode(selectionTooltip.sourceId, selectionTooltip.text);
              setSelectionTooltip(null);
              window.getSelection()?.removeAllRanges();
            }
          }}
          onFindRelationships={() => {
            // Not implemented in Chat mode
          }}
          isMobile={
            typeof window !== 'undefined' &&
            window.matchMedia('(max-width: 768px)').matches
          }
        />
      )}
    </div>
  );
};

// Export child creation handler type for App.tsx integration
export type { ChatModeContainerProps };
