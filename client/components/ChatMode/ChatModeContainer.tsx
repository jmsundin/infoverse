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
  onUpdateNode: (id: string, updates: Partial<GraphNode>) => void;
  onCreateNode: (parentId: string | null, type: NodeType, content?: string) => GraphNode;
  onDeleteNode: (id: string) => void;
  onNavigateToNode?: (title: string) => void;
  onOpenLink?: (url: string) => void;
  onExpandNode?: (id: string, text: string) => void;
  aiProvider?: 'gemini' | 'huggingface';
  autoGraphEnabled?: boolean;
  focusNodeRef?: React.RefObject<((nodeId: string) => void) | null>;
  onSelectionChange?: (nodeId: string | null) => void;
}

export const ChatModeContainer: React.FC<ChatModeContainerProps> = ({
  nodes,
  edges,
  initialNodeId,
  selectionHistory,
  onUpdateNode,
  onCreateNode,
  onDeleteNode: _onDeleteNode,
  onNavigateToNode,
  onOpenLink,
  onExpandNode,
  aiProvider = 'gemini',
  autoGraphEnabled = false,
  focusNodeRef,
  onSelectionChange,
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

  // Expose focusNode to parent via ref (for search bar navigation)
  useEffect(() => {
    if (focusNodeRef) {
      focusNodeRef.current = focusNode;
    }
    return () => {
      if (focusNodeRef) {
        focusNodeRef.current = null;
      }
    };
  }, [focusNode, focusNodeRef]);

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

  // Sync selection changes to parent
  useEffect(() => {
    if (onSelectionChange && state.focusedNodeId) {
      onSelectionChange(state.focusedNodeId);
    }
  }, [state.focusedNodeId, onSelectionChange]);

  // Empty state
  if (nodes.length === 0) {
    return (
      <div className="chat-mode-container relative flex-1 bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl bg-slate-800 flex items-center justify-center mx-auto mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="12" y1="18" x2="12" y2="12" />
              <line x1="9" y1="15" x2="15" y2="15" />
            </svg>
          </div>
          <div className="text-slate-400 text-sm font-medium">No notes yet</div>
          <div className="text-slate-600 text-xs mt-1">Use the search bar to create your first note</div>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-mode-container relative flex-1 bg-slate-950 flex flex-col overflow-hidden">
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
            const focusedIndex = visiblePanels.findIndex(p => p.id === state.focusedNodeId);
            const isFocused = panel.id === state.focusedNodeId;
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


      {/* CSS for scrollbar hiding */}
      <style>{`
        .chat-mode-scroll-container::-webkit-scrollbar {
          display: none;
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
