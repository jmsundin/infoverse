import React, { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { useSelector, useDispatch, useStore } from '../../hooks/useAppStore';
import { useGraphActions } from '../../hooks/useGraphActions';
import {
  selectGraphHot,
  selectGraphCold,
  selectUiSlice,
  selectStorageSlice,
  selectAuthSlice,
  selectPanelsSlice,
  selectExpansionSlice,
  shallowEqual,
} from '../../store/selectors';
import { useAuth } from '../../context/AuthContext';
import { useStorage } from '../../context/StorageContext';
import { Canvas } from '../Canvas';
import { OutlineTreePanel } from '../OutlineTreePanel';
import { ErrorBoundary } from '../ErrorBoundary';
import { usePhysicsSimulation } from '../../hooks/usePhysicsSimulation';
import { useExpansion } from '../../hooks/useExpansion';
import { useNavigation } from '../../hooks/useNavigation';
import { useGraphOperations } from '../../hooks/useGraphOperations';
import { useBreadcrumbs } from '../../hooks/useBreadcrumbs';
import { useViewportStorage, USE_VIEWPORT_STORAGE } from '../../hooks/useViewportStorage';
import { useViewportNodes } from '../../hooks/useViewportNodes';
import { performGreedyClustering } from '../../utils/clustering';
import { GraphNode, GraphEdge, NodeType, SimulationTrigger } from '../../types';
import {
  summarizeNodeIds,
  summarizeTransform,
  viewportDebugLog,
} from '../../utils/viewportDebug';

interface GraphModeContainerProps {
  outlinePanelWidth: number;
  onOutlinePanelWidthChange: (width: number) => void;
}

/**
 * GraphModeContainer owns all graph-related logic:
 * - Physics simulation
 * - Node expansion
 * - Graph operations (create, update, delete, connect)
 * - Navigation
 * - Clustering
 * - Viewport storage sync
 */
export const GraphModeContainer: React.FC<GraphModeContainerProps> = ({
  outlinePanelWidth,
  onOutlinePanelWidthChange,
}) => {
  const dispatch = useDispatch();
  const store = useStore();

  // --- Selectors (with shallowEqual for performance) ---
  const graphHot = useSelector(selectGraphHot, shallowEqual);
  const graphCold = useSelector(selectGraphCold, shallowEqual);
  const ui = useSelector(selectUiSlice, shallowEqual);
  const storage = useSelector(selectStorageSlice, shallowEqual);
  const auth = useSelector(selectAuthSlice, shallowEqual);
  const panels = useSelector(selectPanelsSlice, shallowEqual);
  const expansion = useSelector(selectExpansionSlice, shallowEqual);

  // --- Stable actions ---
  const actions = useGraphActions();

  // --- Storage context ---
  const { deleteNode: contextDeleteNode, restoreLastDeletedNode, getDeletionStackSize } = useStorage();

  // --- Refs ---
  const deletedNodeRef = useRef<{
    nodes: GraphNode[];
    edges: GraphEdge[];
    timer: number | null;
  } | null>(null);

  // --- Viewport storage (two-phase loading) ---
  const viewportStorage = useViewportStorage({
    enabled: USE_VIEWPORT_STORAGE && !!storage.dirHandle,
    dirHandle: storage.dirHandle,
    userId: auth.user?.id ?? null,
    viewTransform: graphHot.viewTransform,
    containerWidth: ui.windowSize.width,
    containerHeight: ui.windowSize.height,
    bufferMultiplier: 1.3,
    debounceMs: 150,
  });

  // --- Viewport nodes for outline panel ---
  const { viewportNodeIds, hasViewportNodes } = useViewportNodes({
    nodes: graphHot.nodes,
    viewTransform: graphHot.viewTransform,
    containerWidth: ui.windowSize.width,
    containerHeight: ui.windowSize.height,
    debounceMs: 200,
  });

  useEffect(() => {
    const selectedInViewport = Array.from(graphHot.selectedNodeIds).filter((id) =>
      viewportNodeIds.has(id)
    );
    const selectedOutsideViewport = Array.from(graphHot.selectedNodeIds).filter(
      (id) => !viewportNodeIds.has(id)
    );

    viewportDebugLog('graph.viewport-selection', {
      scopeId: graphCold.currentScopeId,
      selectedNodeIds: summarizeNodeIds(graphHot.selectedNodeIds),
      selectedInViewport: summarizeNodeIds(selectedInViewport),
      selectedOutsideViewport: summarizeNodeIds(selectedOutsideViewport),
      viewportNodeCount: viewportNodeIds.size,
      hasViewportNodes,
      viewTransform: summarizeTransform(graphHot.viewTransform),
    });
  }, [
    graphHot.selectedNodeIds,
    graphCold.currentScopeId,
    viewportNodeIds,
    hasViewportNodes,
    graphHot.viewTransform,
  ]);

  // --- Sync viewport storage to main state ---
  useEffect(() => {
    if (USE_VIEWPORT_STORAGE && viewportStorage.isInitialized && storage.dirHandle) {
      if (viewportStorage.nodes.length > 0) {
        dispatch({ type: 'NODES_SET', nodes: viewportStorage.nodes });
      }
      if (viewportStorage.edges.length > 0) {
        dispatch({ type: 'EDGES_SET', edges: viewportStorage.edges });
      }
    }
  }, [viewportStorage.isInitialized, viewportStorage.nodes, viewportStorage.edges, storage.dirHandle, dispatch]);

  // --- Graph mutation callbacks (with dedupe + viewport sync) ---
  const setNodesCallback = useCallback(
    (newNodes: GraphNode[] | ((prev: GraphNode[]) => GraphNode[])) => {
      const prevNodes = store.getState().nodes;
      const resolvedNodes = typeof newNodes === 'function' ? newNodes(prevNodes) : newNodes;
      const uniqueNodes = Array.from(new Map(resolvedNodes.map((n) => [n.id, n])).values());

      const prevById = new Map(prevNodes.map((n) => [n.id, n]));
      for (const n of uniqueNodes) {
        const p = prevById.get(n.id);
        if (!p || p !== n) {
          const semanticChanged = !p ||
            p.content !== n.content ||
            p.summary !== n.summary ||
            JSON.stringify(p.aliases || []) !== JSON.stringify(n.aliases || []);

          if (USE_VIEWPORT_STORAGE && viewportStorage.isInitialized) {
            if (!p) {
              viewportStorage.addNode(n, !semanticChanged);
            } else {
              viewportStorage.updateNode(n, !semanticChanged);
            }
          }
        }
      }

      dispatch({ type: 'NODES_SET', nodes: uniqueNodes });
    },
    [dispatch, viewportStorage, store]
  );

  const setEdgesCallback = useCallback(
    (newEdges: GraphEdge[] | ((prev: GraphEdge[]) => GraphEdge[])) => {
      const prevEdges = store.getState().edges;
      const resolvedEdges = typeof newEdges === 'function' ? newEdges(prevEdges) : newEdges;

      if (USE_VIEWPORT_STORAGE && viewportStorage.isInitialized) {
        viewportStorage.updateEdges(resolvedEdges);
      }

      dispatch({ type: 'EDGES_SET', edges: resolvedEdges });
    },
    [dispatch, viewportStorage, store]
  );

  // --- Physics simulation ---
  const {
    isSimulating,
    startSimulation,
    stopSimulation,
    startDrag: physicsStartDrag,
    updateDragPosition: physicsUpdateDrag,
    endDrag: physicsEndDrag,
    pinNode,
    unpinNode,
    togglePinNode,
  } = usePhysicsSimulation(graphHot.nodes, graphHot.edges, setNodesCallback as any, {
    config: graphCold.physicsConfig,
  });

  // --- Toast helper ---
  const setToast = useCallback(
    (t: { visible: boolean; message: string; action?: () => void }) => {
      if (t.visible) {
        dispatch({ type: 'TOAST_SHOW', message: t.message, action: t.action });
      } else {
        dispatch({ type: 'TOAST_HIDE' });
      }
    },
    [dispatch]
  );

  // --- Expansion ---
  const {
    expandingNodeIds,
    handleExpandNode,
    handleExpandNodeFromWikidata,
    pendingExpansion,
    handleCreateAllAnyway,
    handleLinkToExisting,
    handleCancelExpansion,
  } = useExpansion(
    graphHot.nodes,
    graphCold.currentScopeId,
    setNodesCallback,
    setEdgesCallback,
    graphCold.aiProvider,
    actions.setViewTransform,
    setToast,
    (show: boolean) => show ? dispatch({ type: 'MODAL_LIMIT_SHOW' }) : dispatch({ type: 'MODAL_LIMIT_HIDE' }),
    startSimulation
  );

  // --- Graph operations ---
  const {
    handleUpdateNode,
    handleDeleteNode,
    confirmDeleteNode,
    handleCut,
    handlePaste,
    handleConnectEnd,
    handleCreateFromSelection,
    handleSearchSelect,
  } = useGraphOperations(
    graphHot.nodes,
    graphHot.edges,
    setNodesCallback,
    setEdgesCallback,
    graphCold.currentScopeId,
    actions.setCurrentScopeId,
    graphHot.selectedNodeIds,
    actions.setSelectedNodeIds as any,
    graphHot.viewTransform,
    actions.setViewTransform,
    setToast,
    actions.setCutNodeId,
    graphCold.cutNodeId,
    storage.dirHandle,
    auth.user,
    (show) => show ? dispatch({ type: 'MODAL_LIMIT_SHOW' }) : dispatch({ type: 'MODAL_LIMIT_HIDE' }),
    graphCold.aiProvider,
    handleExpandNode,
    deletedNodeRef,
    (v) => {
      if (typeof v === 'function') {
        dispatch({ type: 'SIDE_PANES_SET', panes: v(panels.activeSidePanes) });
      } else {
        dispatch({ type: 'SIDE_PANES_SET', panes: v });
      }
    },
    startSimulation,
    USE_VIEWPORT_STORAGE && storage.dirHandle ? viewportStorage.deleteNode : undefined,
    USE_VIEWPORT_STORAGE && storage.dirHandle ? viewportStorage.removeNodesFromState : undefined,
    USE_VIEWPORT_STORAGE && storage.dirHandle ? viewportStorage.restoreNodesToState : undefined
  );

  // --- Navigation ---
  const { handleNavigateDown, handleNavigateUp, handleFocusNode } = useNavigation(
    graphHot.nodes,
    graphCold.currentScopeId,
    actions.setCurrentScopeId,
    actions.setSelectedNodeIds as any,
    graphHot.viewTransform,
    actions.setViewTransform,
    actions.setNodes as any,
    actions.setEdges as any,
    auth.user,
    storage.dirName
  );

  // --- Clustering and filtering ---
  const filteredNodes = useMemo(
    () => graphHot.nodes.filter((n) => (n.scopeId ?? null) === (graphCold.currentScopeId ?? null)),
    [graphHot.nodes, graphCold.currentScopeId]
  );

  const clusteredNodes = useMemo(
    () => performGreedyClustering(filteredNodes, graphHot.edges, graphHot.viewTransform.k),
    [filteredNodes, graphHot.edges, graphHot.viewTransform.k]
  );

  const visibleNodeIds = useMemo(() => {
    const ids = new Set<string>();
    clusteredNodes.forEach((n) => ids.add(n.id));
    return ids;
  }, [clusteredNodes]);

  const filteredEdges = useMemo(
    () =>
      graphHot.edges.filter((e) => {
        if ((e.scopeId ?? null) !== (graphCold.currentScopeId ?? null)) return false;
        return visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target);
      }),
    [graphHot.edges, graphCold.currentScopeId, visibleNodeIds]
  );

  // --- Panel resizing check ---
  const isAnyPanelResizing = useMemo(
    () => Object.values(panels.sidePanelLayouts).some((l) => l.isResizing),
    [panels.sidePanelLayouts]
  );

  // --- Handlers ---
  const handleMaximizeNode = useCallback(
    (id: string) => {
      const existing = panels.activeSidePanes.find((p) => p.type === 'node' && p.data === id);
      if (existing) {
        dispatch({ type: 'SIDE_PANE_REMOVE', id: existing.id });
      } else {
        dispatch({
          type: 'SIDE_PANE_ADD',
          pane: { id: crypto.randomUUID(), type: 'node', data: id, initialDockPosition: 'right' },
        });
      }
    },
    [panels.activeSidePanes, dispatch]
  );

  const handleOpenLink = useCallback(
    (url: string) => {
      const isWikipedia = url.includes('wikipedia.org/wiki/');
      if (isWikipedia) {
        dispatch({
          type: 'SIDE_PANE_ADD',
          pane: { id: crypto.randomUUID(), type: 'web', data: url, initialDockPosition: 'left', initialWidthPercent: 33 },
        });
      } else {
        const existing = panels.activeSidePanes.find((p) => p.type === 'web' && p.initialDockPosition !== 'left');
        if (existing) {
          dispatch({ type: 'SIDE_PANE_UPDATE', id: existing.id, updates: { data: url } });
        } else {
          dispatch({
            type: 'SIDE_PANE_ADD',
            pane: { id: crypto.randomUUID(), type: 'web', data: url, initialDockPosition: 'right', initialWidthPercent: 33 },
          });
        }
      }
    },
    [panels.activeSidePanes, dispatch]
  );

  const handleNavigateToNodeLink = useCallback(
    (rawTitle: string) => {
      const normalize = (v?: string | null) => v?.trim().toLowerCase() || '';
      const target = normalize(rawTitle);
      if (!target) return;
      const matchedNode = graphHot.nodes.find(
        (n) =>
          normalize(n.content) === target ||
          normalize(n.summary) === target ||
          n.aliases?.some((a) => normalize(a) === target)
      );
      if (!matchedNode) return;
      dispatch({ type: 'SCOPE_SET', scopeId: matchedNode.scopeId ?? null });
      dispatch({ type: 'SELECTION_SET', ids: new Set([matchedNode.id]) });
      const k = graphHot.viewTransform.k;
      const nodeCenterX = matchedNode.x + (matchedNode.width || 280) / 2;
      const nodeCenterY = matchedNode.y + (matchedNode.height || 160) / 2;
      dispatch({
        type: 'VIEW_TRANSFORM_SET',
        transform: {
          x: window.innerWidth / 2 - nodeCenterX * k,
          y: window.innerHeight / 2 - nodeCenterY * k,
          k,
        },
      });
    },
    [graphHot.nodes, graphHot.viewTransform.k, dispatch]
  );

  const handleNodeSelect = useCallback(
    (id: string | null, multi?: boolean | 'remove') => {
      viewportDebugLog('graph.handle-node-select', {
        nodeId: id,
        multi,
        selectionBefore: summarizeNodeIds(graphHot.selectedNodeIds),
        scopeId: graphCold.currentScopeId,
        viewTransform: summarizeTransform(graphHot.viewTransform),
      });

      if (id === null) {
        dispatch({ type: 'SELECTION_CLEAR' });
      } else if (multi === 'remove') {
        dispatch({ type: 'SELECTION_REMOVE', id });
      } else if (multi) {
        dispatch({ type: 'SELECTION_ADD', id });
        dispatch({ type: 'SELECTION_HISTORY_PUSH', id });
      } else {
        dispatch({ type: 'SELECTION_SET', ids: new Set([id]) });
        dispatch({ type: 'SELECTION_HISTORY_PUSH', id });
      }
    },
    [dispatch, graphHot.selectedNodeIds, graphHot.viewTransform, graphCold.currentScopeId]
  );

  return (
    <div className="flex-1 min-w-0 h-full flex">
      <ErrorBoundary>
        <Canvas
          outlinePanel={
            <OutlineTreePanel
              isOpen={ui.isOutlinePanelOpen}
              onClose={() => dispatch({ type: 'OUTLINE_PANEL_SET', open: false })}
              nodes={graphHot.nodes}
              viewportNodeIds={viewportNodeIds}
              hasViewportNodes={hasViewportNodes}
              selectedNodeIds={graphHot.selectedNodeIds}
              lastSelectedNodeId={graphCold.selectionHistory[0] ?? null}
              currentScopeId={graphCold.currentScopeId}
              onFocusNode={handleFocusNode}
              panelWidth={outlinePanelWidth}
              onPanelWidthChange={onOutlinePanelWidthChange}
            />
          }
          isOutlinePanelOpen={ui.isOutlinePanelOpen}
          nodes={clusteredNodes}
          allNodes={graphHot.nodes}
          edges={filteredEdges}
          setNodes={setNodesCallback as any}
          setEdges={setEdgesCallback as any}
          viewTransform={graphHot.viewTransform}
          onViewTransformChange={actions.setViewTransform}
          isSaving={false}
          onOpenLink={handleOpenLink}
          onNavigateToNode={handleNavigateToNodeLink}
          onMaximizeNode={handleMaximizeNode}
          onExpandNode={handleExpandNode}
          onExpandNodeFromWikidata={handleExpandNodeFromWikidata}
          onUpdateNode={handleUpdateNode}
          onDeleteNode={handleDeleteNode}
          expandingNodeIds={expandingNodeIds}
          onToggleMenu={() => dispatch({ type: 'OUTLINE_PANEL_TOGGLE' })}
          connectingNodeId={graphCold.connectingNodeId}
          onConnectStart={(id) => dispatch({ type: 'CONNECTING_NODE_SET', id })}
          onConnectEnd={(s, t) => {
            handleConnectEnd(s, t);
            dispatch({ type: 'CONNECTING_NODE_SET', id: null });
          }}
          onCancelConnect={() => dispatch({ type: 'CONNECTING_NODE_SET', id: null })}
          onNavigateDown={handleNavigateDown}
          onNavigateUp={handleNavigateUp}
          currentScopeId={graphCold.currentScopeId}
          autoGraphEnabled={graphCold.autoGraphEnabled}
          onSetAutoGraphEnabled={(v) => dispatch({ type: 'AUTO_GRAPH_SET', enabled: v })}
          selectedNodeIds={graphHot.selectedNodeIds}
          selectionHistory={graphCold.selectionHistory}
          onNodeSelect={handleNodeSelect}
          canvasShiftX={ui.canvasShiftX}
          canvasShiftY={ui.canvasShiftY}
          isResizing={isAnyPanelResizing}
          onSelectionTooltipChange={(t) => dispatch({ type: 'SELECTION_TOOLTIP_SET', tooltip: t })}
          cutNodeId={graphCold.cutNodeId}
          setCutNodeId={actions.setCutNodeId as any}
          aiProvider={graphCold.aiProvider}
          user={auth.user}
          onShowProfile={() => dispatch({ type: 'MODAL_PROFILE_SHOW' })}
          isSimulating={isSimulating}
          startSimulation={startSimulation}
          stopSimulation={stopSimulation}
          physicsStartDrag={physicsStartDrag}
          physicsUpdateDrag={physicsUpdateDrag}
          physicsEndDrag={physicsEndDrag}
          pinNode={pinNode}
          unpinNode={unpinNode}
          togglePinNode={togglePinNode}
        />
      </ErrorBoundary>
    </div>
  );
};

export default GraphModeContainer;
