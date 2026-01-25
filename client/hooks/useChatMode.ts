import { useState, useCallback, useRef, useMemo } from 'react';
import { GraphNode, GraphEdge, NodeType } from '../types';

export interface ChatModeState {
  focusedNodeId: string | null;
  panelStack: string[];           // Ancestry chain [grandparent, parent, focused]
  expandedBubbleId: string | null;     // Bubble showing title preview
  isAnimating: boolean;
}

export interface UseChatModeProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  initialNodeId: string | null;
  onCreateNode: (parentId: string, type: NodeType, selectedText?: string) => string;
}

export interface UseChatModeReturn {
  state: ChatModeState;
  focusNode: (nodeId: string) => void;
  createChildPanel: (parentId: string, type: NodeType, selectedText?: string) => string;
  expandBubble: (nodeId: string) => void;
  previewBubble: (nodeId: string) => void;
  collapseBubblePreview: () => void;
  navigateToParent: () => void;
  getVisiblePanels: () => GraphNode[];
  getChildBubbles: () => Array<{ node: GraphNode; isExpanded: boolean }>;
  scrollContainerRef: React.RefObject<HTMLDivElement>;
  animateScrollToPanel: (nodeId: string) => void;
}

// Build ancestry chain by walking up parentId relationships
function buildPanelStack(nodeId: string, nodes: GraphNode[]): string[] {
  const stack: string[] = [];
  let currentId: string | null = nodeId;
  const visited = new Set<string>();

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    stack.unshift(currentId);
    const node = nodes.find(n => n.id === currentId);
    currentId = node?.parentId ?? null;
  }

  return stack;
}

export function useChatMode({
  nodes,
  edges,
  initialNodeId,
  onCreateNode,
}: UseChatModeProps): UseChatModeReturn {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const collapseTimerRef = useRef<number | null>(null);

  // Initialize state
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(() => {
    if (initialNodeId && nodes.find(n => n.id === initialNodeId)) {
      return initialNodeId;
    }
    return nodes[0]?.id ?? null;
  });

  const [panelStack, setPanelStack] = useState<string[]>(() => {
    const id = initialNodeId && nodes.find(n => n.id === initialNodeId)
      ? initialNodeId
      : nodes[0]?.id;
    return id ? buildPanelStack(id, nodes) : [];
  });

  const [expandedBubbleId, setExpandedBubbleId] = useState<string | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);

  // Animate scroll to a specific panel
  const animateScrollToPanel = useCallback((nodeId: string) => {
    if (!scrollContainerRef.current) return;

    setIsAnimating(true);

    // Find the panel index
    const panelIndex = panelStack.indexOf(nodeId);
    if (panelIndex === -1) return;

    // Calculate scroll position
    // Each panel is ~66.67vw on desktop, but we need to account for the parent peek
    const container = scrollContainerRef.current;
    const isMobile = window.innerWidth < 768;
    const panelWidth = isMobile ? window.innerWidth : window.innerWidth * 0.6667;
    const peekWidth = 50;

    // Scroll so the focused panel is visible with parent peeking
    let scrollTarget: number;
    if (panelIndex === 0) {
      scrollTarget = 0;
    } else {
      // Show parent peek + focused panel
      scrollTarget = (panelIndex - 1) * panelWidth + (panelWidth - peekWidth);
    }

    container.scrollTo({
      left: scrollTarget,
      behavior: 'smooth',
    });

    // Clear animating flag after transition
    setTimeout(() => setIsAnimating(false), 350);
  }, [panelStack]);

  // Focus on a node - rebuilds panel stack from that node's ancestry
  const focusNode = useCallback((nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    // Build new panel stack from this node's ancestry
    const newStack = buildPanelStack(nodeId, nodes);

    setPanelStack(newStack);
    setFocusedNodeId(nodeId);
    setExpandedBubbleId(null);

    // Scroll to show the focused panel
    setTimeout(() => animateScrollToPanel(nodeId), 50);
  }, [nodes, animateScrollToPanel]);

  // Create a child panel from selected text
  const createChildPanel = useCallback((parentId: string, type: NodeType, selectedText?: string) => {
    // Create new child node
    const newChildId = onCreateNode(parentId, type, selectedText);

    // Add to panel stack after parent
    setPanelStack(prev => {
      const parentIndex = prev.indexOf(parentId);
      if (parentIndex === -1) return [...prev, newChildId];

      const newStack = [...prev.slice(0, parentIndex + 1), newChildId];
      return newStack;
    });

    // Focus the new child
    setFocusedNodeId(newChildId);

    // Scroll to show new panel
    setTimeout(() => animateScrollToPanel(newChildId), 100);

    return newChildId;
  }, [onCreateNode, animateScrollToPanel]);

  // Preview a bubble (first tap - show title)
  const previewBubble = useCallback((nodeId: string) => {
    // Clear any existing timer
    if (collapseTimerRef.current) {
      clearTimeout(collapseTimerRef.current);
    }

    setExpandedBubbleId(nodeId);

    // Auto-collapse after 3 seconds
    collapseTimerRef.current = window.setTimeout(() => {
      setExpandedBubbleId(null);
    }, 3000);
  }, []);

  // Collapse bubble preview
  const collapseBubblePreview = useCallback(() => {
    if (collapseTimerRef.current) {
      clearTimeout(collapseTimerRef.current);
    }
    setExpandedBubbleId(null);
  }, []);

  // Expand a bubble to full panel (second tap)
  const expandBubble = useCallback((nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    const parentId = node.parentId;
    if (!parentId) return;

    // Update panel stack: keep up to parent, then add expanded node
    setPanelStack(prev => {
      const parentIndex = prev.indexOf(parentId);
      if (parentIndex === -1) return [...prev, nodeId];
      return [...prev.slice(0, parentIndex + 1), nodeId];
    });

    setFocusedNodeId(nodeId);
    setExpandedBubbleId(null);

    // Scroll to show expanded panel
    setTimeout(() => animateScrollToPanel(nodeId), 100);
  }, [nodes, animateScrollToPanel]);

  // Navigate to parent panel
  const navigateToParent = useCallback(() => {
    if (!focusedNodeId) return;

    const focusedIndex = panelStack.indexOf(focusedNodeId);
    if (focusedIndex > 0) {
      const parentId = panelStack[focusedIndex - 1];
      focusNode(parentId);
    }
  }, [focusedNodeId, panelStack, focusNode]);

  // Get visible panels (nodes in the stack)
  const getVisiblePanels = useCallback((): GraphNode[] => {
    return panelStack
      .map(id => nodes.find(n => n.id === id))
      .filter((n): n is GraphNode => n !== undefined);
  }, [panelStack, nodes]);

  // Get child bubbles for the focused node (derived from edges)
  const getChildBubbles = useCallback((): Array<{ node: GraphNode; isExpanded: boolean }> => {
    if (!focusedNodeId) return [];

    // Get child IDs from edges where this node is the source
    const childIds = edges
      .filter(e => e.source === focusedNodeId)
      .map(e => e.target);

    // Filter out nodes already visible in panel stack
    return childIds
      .filter(id => !panelStack.includes(id))
      .map(id => {
        const node = nodes.find(n => n.id === id);
        if (!node) return null;
        return {
          node,
          isExpanded: expandedBubbleId === id,
        };
      })
      .filter((b): b is { node: GraphNode; isExpanded: boolean } => b !== null);
  }, [focusedNodeId, edges, nodes, panelStack, expandedBubbleId]);

  // Compose state object
  const state = useMemo((): ChatModeState => ({
    focusedNodeId,
    panelStack,
    expandedBubbleId,
    isAnimating,
  }), [focusedNodeId, panelStack, expandedBubbleId, isAnimating]);

  return {
    state,
    focusNode,
    createChildPanel,
    expandBubble,
    previewBubble,
    collapseBubblePreview,
    navigateToParent,
    getVisiblePanels,
    getChildBubbles,
    scrollContainerRef,
    animateScrollToPanel,
  };
}
