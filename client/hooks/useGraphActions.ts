import { useCallback, useMemo } from 'react';
import { useDispatch } from './useAppStore';
import { GraphNode, GraphEdge, ViewportTransform } from '../types';
import { ActiveSidePane } from './useSidePanes';

/**
 * Hook providing stable action dispatchers for graph operations.
 * All returned functions depend only on dispatch (which is stable),
 * so they won't cause unnecessary re-renders.
 */
export function useGraphActions() {
  const dispatch = useDispatch();

  // --- Node actions ---
  const setNodes = useCallback(
    (nodes: GraphNode[]) => dispatch({ type: 'NODES_SET', nodes }),
    [dispatch]
  );

  const updateNodes = useCallback(
    (updater: (prev: GraphNode[]) => GraphNode[]) => dispatch({ type: 'NODES_UPDATE', updater }),
    [dispatch]
  );

  const addNodes = useCallback(
    (nodes: GraphNode[]) => dispatch({ type: 'NODES_ADD', nodes }),
    [dispatch]
  );

  const removeNodes = useCallback(
    (ids: string[]) => dispatch({ type: 'NODES_REMOVE', ids }),
    [dispatch]
  );

  const updateNode = useCallback(
    (id: string, updates: Partial<GraphNode>) => dispatch({ type: 'NODE_UPDATE', id, updates }),
    [dispatch]
  );

  // --- Edge actions ---
  const setEdges = useCallback(
    (edges: GraphEdge[]) => dispatch({ type: 'EDGES_SET', edges }),
    [dispatch]
  );

  const updateEdges = useCallback(
    (updater: (prev: GraphEdge[]) => GraphEdge[]) => dispatch({ type: 'EDGES_UPDATE', updater }),
    [dispatch]
  );

  const addEdge = useCallback(
    (edge: GraphEdge) => dispatch({ type: 'EDGE_ADD', edge }),
    [dispatch]
  );

  const addEdges = useCallback(
    (edges: GraphEdge[]) => dispatch({ type: 'EDGES_ADD', edges }),
    [dispatch]
  );

  // --- Selection actions ---
  const setSelectedNodeIds = useCallback(
    (ids: Set<string>) => dispatch({ type: 'SELECTION_SET', ids }),
    [dispatch]
  );

  const updateSelection = useCallback(
    (updater: (prev: Set<string>) => Set<string>) => dispatch({ type: 'SELECTION_UPDATE', updater }),
    [dispatch]
  );

  const selectNode = useCallback(
    (id: string, multi?: boolean | 'remove') => {
      if (multi === 'remove') {
        dispatch({ type: 'SELECTION_REMOVE', id });
      } else if (multi) {
        dispatch({ type: 'SELECTION_ADD', id });
        dispatch({ type: 'SELECTION_HISTORY_PUSH', id });
      } else {
        dispatch({ type: 'SELECTION_SET', ids: new Set([id]) });
        dispatch({ type: 'SELECTION_HISTORY_PUSH', id });
      }
    },
    [dispatch]
  );

  const clearSelection = useCallback(
    () => dispatch({ type: 'SELECTION_CLEAR' }),
    [dispatch]
  );

  // --- Scope actions ---
  const setCurrentScopeId = useCallback(
    (scopeId: string | null) => dispatch({ type: 'SCOPE_SET', scopeId }),
    [dispatch]
  );

  // --- View actions ---
  const setViewTransform = useCallback(
    (transform: ViewportTransform) => dispatch({ type: 'VIEW_TRANSFORM_SET', transform }),
    [dispatch]
  );

  const toggleViewMode = useCallback(
    () => dispatch({ type: 'VIEW_MODE_TOGGLE' }),
    [dispatch]
  );

  // --- Toast actions ---
  const showToast = useCallback(
    (message: string, action?: () => void) => dispatch({ type: 'TOAST_SHOW', message, action }),
    [dispatch]
  );

  const hideToast = useCallback(
    () => dispatch({ type: 'TOAST_HIDE' }),
    [dispatch]
  );

  // --- Cut/paste ---
  const setCutNodeId = useCallback(
    (id: string | null) => dispatch({ type: 'CUT_NODE_SET', id }),
    [dispatch]
  );

  // --- Settings ---
  const setAutoGraphEnabled = useCallback(
    (enabled: boolean) => dispatch({ type: 'AUTO_GRAPH_SET', enabled }),
    [dispatch]
  );

  const setAiProvider = useCallback(
    (provider: 'gemini' | 'huggingface') => dispatch({ type: 'AI_PROVIDER_SET', provider }),
    [dispatch]
  );

  // --- Modal actions ---
  const showLimitModal = useCallback(
    () => dispatch({ type: 'MODAL_LIMIT_SHOW' }),
    [dispatch]
  );

  const hideLimitModal = useCallback(
    () => dispatch({ type: 'MODAL_LIMIT_HIDE' }),
    [dispatch]
  );

  const showAuthModal = useCallback(
    (mode: 'login' | 'signup') => dispatch({ type: 'MODAL_AUTH_SHOW', mode }),
    [dispatch]
  );

  const hideAuthModal = useCallback(
    () => dispatch({ type: 'MODAL_AUTH_HIDE' }),
    [dispatch]
  );

  const showProfileModal = useCallback(
    () => dispatch({ type: 'MODAL_PROFILE_SHOW' }),
    [dispatch]
  );

  const hideProfileModal = useCallback(
    () => dispatch({ type: 'MODAL_PROFILE_HIDE' }),
    [dispatch]
  );

  const showUpgradeModal = useCallback(
    () => dispatch({ type: 'MODAL_UPGRADE_SHOW' }),
    [dispatch]
  );

  const hideUpgradeModal = useCallback(
    () => dispatch({ type: 'MODAL_UPGRADE_HIDE' }),
    [dispatch]
  );

  // --- Panel actions ---
  const addSidePane = useCallback(
    (pane: ActiveSidePane) => dispatch({ type: 'SIDE_PANE_ADD', pane }),
    [dispatch]
  );

  const removeSidePane = useCallback(
    (id: string) => dispatch({ type: 'SIDE_PANE_REMOVE', id }),
    [dispatch]
  );

  const updateSidePane = useCallback(
    (id: string, updates: Partial<ActiveSidePane>) => dispatch({ type: 'SIDE_PANE_UPDATE', id, updates }),
    [dispatch]
  );

  const toggleOutlinePanel = useCallback(
    () => dispatch({ type: 'OUTLINE_PANEL_TOGGLE' }),
    [dispatch]
  );

  const setOutlinePanelOpen = useCallback(
    (open: boolean) => dispatch({ type: 'OUTLINE_PANEL_SET', open }),
    [dispatch]
  );

  // --- Connection actions ---
  const setConnectingNode = useCallback(
    (id: string | null) => dispatch({ type: 'CONNECTING_NODE_SET', id }),
    [dispatch]
  );

  // --- Selection tooltip ---
  const setSelectionTooltip = useCallback(
    (tooltip: any) => dispatch({ type: 'SELECTION_TOOLTIP_SET', tooltip }),
    [dispatch]
  );

  // --- Compound actions ---
  const deleteNodes = useCallback(
    (ids: string[]) => dispatch({ type: 'DELETE_NODES', ids }),
    [dispatch]
  );

  const restoreNodes = useCallback(
    (nodes: GraphNode[], edges: GraphEdge[]) => dispatch({ type: 'RESTORE_NODES', nodes, edges }),
    [dispatch]
  );

  const focusNode = useCallback(
    (nodeId: string, transform: ViewportTransform) => dispatch({ type: 'FOCUS_NODE', nodeId, transform }),
    [dispatch]
  );

  // Return stable memoized object (all deps are already stable useCallbacks)
  return useMemo(() => ({
    // Nodes
    setNodes,
    updateNodes,
    addNodes,
    removeNodes,
    updateNode,
    // Edges
    setEdges,
    updateEdges,
    addEdge,
    addEdges,
    // Selection
    setSelectedNodeIds,
    updateSelection,
    selectNode,
    clearSelection,
    // Scope
    setCurrentScopeId,
    // View
    setViewTransform,
    toggleViewMode,
    // Toast
    showToast,
    hideToast,
    // Cut
    setCutNodeId,
    // Settings
    setAutoGraphEnabled,
    setAiProvider,
    // Modals
    showLimitModal,
    hideLimitModal,
    showAuthModal,
    hideAuthModal,
    showProfileModal,
    hideProfileModal,
    showUpgradeModal,
    hideUpgradeModal,
    // Panels
    addSidePane,
    removeSidePane,
    updateSidePane,
    toggleOutlinePanel,
    setOutlinePanelOpen,
    // Connection
    setConnectingNode,
    // Selection tooltip
    setSelectionTooltip,
    // Compound
    deleteNodes,
    restoreNodes,
    focusNode,
  }), [
    setNodes, updateNodes, addNodes, removeNodes, updateNode,
    setEdges, updateEdges, addEdge, addEdges,
    setSelectedNodeIds, updateSelection, selectNode, clearSelection,
    setCurrentScopeId,
    setViewTransform, toggleViewMode,
    showToast, hideToast,
    setCutNodeId,
    setAutoGraphEnabled, setAiProvider,
    showLimitModal, hideLimitModal, showAuthModal, hideAuthModal,
    showProfileModal, hideProfileModal, showUpgradeModal, hideUpgradeModal,
    addSidePane, removeSidePane, updateSidePane, toggleOutlinePanel, setOutlinePanelOpen,
    setConnectingNode, setSelectionTooltip,
    deleteNodes, restoreNodes, focusNode,
  ]);
}

// Export return type for use in config objects
export type GraphActions = ReturnType<typeof useGraphActions>;
