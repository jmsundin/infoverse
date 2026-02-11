import { AppState } from './AppState';
import { Action } from './actions';
import { GraphNode } from '../types';
import { createDefaultGraphNodes } from '../utils/graphUtils';

function deduplicateNodes(nodes: GraphNode[]): GraphNode[] {
  return Array.from(new Map(nodes.map((n) => [n.id, n])).values());
}

function normalizeViewTransform(transform: {
  x: number;
  y: number;
  k: number;
}): { x: number; y: number; k: number } {
  return {
    x: Number.isFinite(transform.x) ? transform.x : 0,
    y: Number.isFinite(transform.y) ? transform.y : 0,
    k: Number.isFinite(transform.k) && transform.k > 0 ? transform.k : 1,
  };
}

function isSameViewTransform(
  a: { x: number; y: number; k: number },
  b: { x: number; y: number; k: number }
): boolean {
  return a.x === b.x && a.y === b.y && a.k === b.k;
}

export function appReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    // --- Graph ---
    case 'NODES_SET':
      return { ...state, nodes: deduplicateNodes(action.nodes) };

    case 'NODES_ADD':
      return { ...state, nodes: deduplicateNodes([...state.nodes, ...action.nodes]) };

    case 'NODES_REMOVE':
      return {
        ...state,
        nodes: state.nodes.filter((n) => !action.ids.includes(n.id)),
      };

    case 'NODE_UPDATE':
      return {
        ...state,
        nodes: state.nodes.map((n) =>
          n.id === action.id ? { ...n, ...action.updates } : n
        ),
      };

    case 'NODES_MERGE': {
      const incoming = new Map(action.nodes.map((n) => [n.id, n]));
      const merged = state.nodes.map((n) => incoming.get(n.id) ?? n);
      // Add any new nodes not already present
      const existingIds = new Set(state.nodes.map((n) => n.id));
      const newNodes = action.nodes.filter((n) => !existingIds.has(n.id));
      return { ...state, nodes: [...merged, ...newNodes] };
    }

    case 'NODES_UPDATE':
      return { ...state, nodes: deduplicateNodes(action.updater(state.nodes)) };

    case 'EDGES_SET':
      return { ...state, edges: action.edges };

    case 'EDGE_ADD':
      return { ...state, edges: [...state.edges, action.edge] };

    case 'EDGES_ADD':
      return { ...state, edges: [...state.edges, ...action.edges] };

    case 'EDGES_REMOVE_BY_NODE':
      return {
        ...state,
        edges: state.edges.filter(
          (e) => !action.nodeIds.includes(e.source) && !action.nodeIds.includes(e.target)
        ),
      };

    case 'EDGES_UPDATE':
      return { ...state, edges: action.updater(state.edges) };

    case 'SCOPE_SET':
      return { ...state, currentScopeId: action.scopeId };

    case 'SELECTION_SET':
      return { ...state, selectedNodeIds: action.ids };

    case 'SELECTION_ADD':
      return {
        ...state,
        selectedNodeIds: new Set([...state.selectedNodeIds, action.id]),
      };

    case 'SELECTION_REMOVE': {
      const next = new Set(state.selectedNodeIds);
      next.delete(action.id);
      return { ...state, selectedNodeIds: next };
    }

    case 'SELECTION_CLEAR':
      return { ...state, selectedNodeIds: new Set() };

    case 'SELECTION_UPDATE':
      return { ...state, selectedNodeIds: action.updater(state.selectedNodeIds) };

    case 'GRAPH_LOADED_SET':
      return { ...state, isGraphLoaded: action.loaded };

    // --- Auth ---
    case 'AUTH_USER_SET':
      return { ...state, user: action.user };

    case 'AUTH_USER_UPDATE':
      return {
        ...state,
        user: state.user ? { ...state.user, ...action.updates } : null,
      };

    case 'AUTH_LOADING_SET':
      return { ...state, authLoading: action.loading };

    // --- Storage ---
    case 'STORAGE_MODE_SET':
      return { ...state, storageMode: action.mode };

    case 'STORAGE_MIGRATING_SET':
      return { ...state, isMigrating: action.migrating };

    case 'STORAGE_DIR_HANDLE_SET':
      return { ...state, dirHandle: action.handle };

    case 'STORAGE_DIR_NAME_SET':
      return { ...state, dirName: action.name };

    // --- UI ---
    case 'VIEW_TRANSFORM_SET': {
      const nextTransform = normalizeViewTransform(action.transform);
      if (isSameViewTransform(state.viewTransform, nextTransform)) {
        return state;
      }
      return { ...state, viewTransform: nextTransform };
    }

    case 'VIEW_MODE_TOGGLE':
      return {
        ...state,
        viewMode: state.viewMode === 'graph' ? 'chat' : 'graph',
      };

    case 'CONNECTING_NODE_SET':
      return { ...state, connectingNodeId: action.id };

    case 'SELECTION_TOOLTIP_SET':
      return { ...state, selectionTooltip: action.tooltip };

    case 'TOAST_SHOW':
      return {
        ...state,
        toast: { visible: true, message: action.message, action: action.action },
      };

    case 'TOAST_HIDE':
      return { ...state, toast: { ...state.toast, visible: false } };

    case 'SEARCH_EXPANDED_SET':
      return { ...state, searchExpanded: action.expanded };

    case 'OUTLINE_PANEL_TOGGLE':
      return { ...state, isOutlinePanelOpen: !state.isOutlinePanelOpen };

    case 'OUTLINE_PANEL_SET':
      return { ...state, isOutlinePanelOpen: action.open };

    case 'CANVAS_SHIFT_SET':
      return { ...state, canvasShiftX: action.x, canvasShiftY: action.y };

    case 'WINDOW_SIZE_SET':
      return {
        ...state,
        windowSize: { width: action.width, height: action.height },
      };

    // --- Settings ---
    case 'AUTO_GRAPH_SET':
      return { ...state, autoGraphEnabled: action.enabled };

    case 'AI_PROVIDER_SET':
      return { ...state, aiProvider: action.provider };

    case 'PHYSICS_CONFIG_SET':
      return {
        ...state,
        physicsConfig: { ...state.physicsConfig, ...action.config },
      };

    case 'SELECTION_HISTORY_PUSH': {
      const filtered = state.selectionHistory.filter((id) => id !== action.id);
      return {
        ...state,
        selectionHistory: [action.id, ...filtered].slice(0, 5),
      };
    }

    // --- Modals ---
    case 'MODAL_AUTH_SHOW':
      return { ...state, showAuth: true, authMode: action.mode };

    case 'MODAL_AUTH_HIDE':
      return { ...state, showAuth: false };

    case 'MODAL_PROFILE_SHOW':
      return { ...state, showProfile: true };

    case 'MODAL_PROFILE_HIDE':
      return { ...state, showProfile: false };

    case 'MODAL_LIMIT_SHOW':
      return { ...state, showLimitModal: true };

    case 'MODAL_LIMIT_HIDE':
      return { ...state, showLimitModal: false };

    case 'MODAL_UPGRADE_SHOW':
      return { ...state, showUpgradeModal: true };

    case 'MODAL_UPGRADE_HIDE':
      return { ...state, showUpgradeModal: false };

    case 'USAGE_NOTIFICATION_SHOW':
      return {
        ...state,
        usageNotification: { visible: true, message: action.message },
      };

    case 'USAGE_NOTIFICATION_HIDE':
      return {
        ...state,
        usageNotification: { ...state.usageNotification, visible: false },
      };

    // --- Expansion ---
    case 'EXPANDING_NODE_ADD':
      return {
        ...state,
        expandingNodeIds: state.expandingNodeIds.includes(action.id)
          ? state.expandingNodeIds
          : [...state.expandingNodeIds, action.id],
      };

    case 'EXPANDING_NODE_REMOVE':
      return {
        ...state,
        expandingNodeIds: state.expandingNodeIds.filter((id) => id !== action.id),
      };

    case 'PENDING_EXPANSION_SET':
      return { ...state, pendingExpansion: action.expansion };

    // --- Side Panels ---
    case 'SIDE_PANE_ADD':
      return {
        ...state,
        activeSidePanes: [...state.activeSidePanes, action.pane],
      };

    case 'SIDE_PANE_REMOVE':
      return {
        ...state,
        activeSidePanes: state.activeSidePanes.filter((p) => p.id !== action.id),
        sidePanelLayouts: (() => {
          const next = { ...state.sidePanelLayouts };
          delete next[action.id];
          return next;
        })(),
      };

    case 'SIDE_PANES_SET':
      return { ...state, activeSidePanes: action.panes };

    case 'SIDE_PANE_UPDATE':
      return {
        ...state,
        activeSidePanes: state.activeSidePanes.map((p) =>
          p.id === action.id ? { ...p, ...action.updates } : p
        ),
      };

    case 'SIDE_PANEL_LAYOUT_SET':
      return {
        ...state,
        sidePanelLayouts: { ...state.sidePanelLayouts, [action.id]: action.layout },
      };

    case 'SIDE_PANEL_LAYOUT_REMOVE': {
      const next = { ...state.sidePanelLayouts };
      delete next[action.id];
      return { ...state, sidePanelLayouts: next };
    }

    // --- Misc ---
    case 'CUT_NODE_SET':
      return { ...state, cutNodeId: action.id };

    case 'MIGRATION_PROGRESS_SET':
      return { ...state, migrationProgress: action.progress };

    case 'SIMULATING_SET':
      return { ...state, isSimulating: action.simulating };

    // --- Compound Actions ---
    case 'DELETE_NODES': {
      const idsSet = new Set(action.ids);
      return {
        ...state,
        nodes: state.nodes.filter((n) => !idsSet.has(n.id)),
        edges: state.edges.filter(
          (e) => !idsSet.has(e.source) && !idsSet.has(e.target)
        ),
        selectedNodeIds: new Set(),
        cutNodeId: state.cutNodeId && idsSet.has(state.cutNodeId) ? null : state.cutNodeId,
        activeSidePanes: state.activeSidePanes.filter(
          (p) => !(p.type === 'node' && idsSet.has(p.data))
        ),
      };
    }

    case 'RESTORE_NODES':
      return {
        ...state,
        nodes: deduplicateNodes([...state.nodes, ...action.nodes]),
        edges: [...state.edges, ...action.edges],
      };

    case 'LOGOUT':
      return {
        ...state,
        user: null,
        dirHandle: null,
        dirName: null,
        nodes: createDefaultGraphNodes(),
        edges: [],
      };

    case 'GRAPH_LOAD_FROM_STORAGE':
      return {
        ...state,
        nodes: action.nodes,
        edges: action.edges,
      };

    case 'FOCUS_NODE': {
      const node = state.nodes.find((n) => n.id === action.nodeId);
      if (!node) return state;
      const next: AppState = {
        ...state,
        currentScopeId: node.scopeId ?? null,
        viewTransform: action.transform,
      };
      if (action.select !== false) {
        next.selectedNodeIds = new Set([action.nodeId]);
      }
      if (action.pushHistory) {
        next.selectionHistory = [action.nodeId, ...state.selectionHistory.filter(id => id !== action.nodeId)];
      }
      return next;
    }

    default:
      return state;
  }
}
