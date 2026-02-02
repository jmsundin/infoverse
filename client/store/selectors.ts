import { AppState } from './AppState';

// --- Shallow equality for slice selectors ---
export function shallowEqual<T extends object>(a: T, b: T): boolean {
  if (a === b) return true;
  const keysA = Object.keys(a) as (keyof T)[];
  const keysB = Object.keys(b) as (keyof T)[];
  if (keysA.length !== keysB.length) return false;
  return keysA.every(key => a[key] === b[key]);
}

// --- Slice selectors (grouped by volatility) ---

// Hot state: changes frequently (physics ticks, drags)
export const selectGraphHot = (s: AppState) => ({
  nodes: s.nodes,
  edges: s.edges,
  selectedNodeIds: s.selectedNodeIds,
  viewTransform: s.viewTransform,
});

// Cold state: changes rarely
export const selectGraphCold = (s: AppState) => ({
  currentScopeId: s.currentScopeId,
  selectionHistory: s.selectionHistory,
  connectingNodeId: s.connectingNodeId,
  cutNodeId: s.cutNodeId,
  autoGraphEnabled: s.autoGraphEnabled,
  physicsConfig: s.physicsConfig,
  aiProvider: s.aiProvider,
  isGraphLoaded: s.isGraphLoaded,
});

export const selectUiSlice = (s: AppState) => ({
  viewMode: s.viewMode,
  selectionTooltip: s.selectionTooltip,
  toast: s.toast,
  searchExpanded: s.searchExpanded,
  isOutlinePanelOpen: s.isOutlinePanelOpen,
  usageNotification: s.usageNotification,
  canvasShiftX: s.canvasShiftX,
  canvasShiftY: s.canvasShiftY,
  windowSize: s.windowSize,
});

export const selectStorageSlice = (s: AppState) => ({
  dirHandle: s.dirHandle,
  dirName: s.dirName,
  migrationProgress: s.migrationProgress,
});

export const selectAuthSlice = (s: AppState) => ({
  user: s.user,
  authLoading: s.authLoading,
});

export const selectPanelsSlice = (s: AppState) => ({
  activeSidePanes: s.activeSidePanes,
  sidePanelLayouts: s.sidePanelLayouts,
});

export const selectModalsSlice = (s: AppState) => ({
  showAuth: s.showAuth,
  authMode: s.authMode,
  showProfile: s.showProfile,
  showLimitModal: s.showLimitModal,
  showUpgradeModal: s.showUpgradeModal,
});

export const selectExpansionSlice = (s: AppState) => ({
  expandingNodeIds: s.expandingNodeIds,
  pendingExpansion: s.pendingExpansion,
});

// --- Existing selectors ---

export const selectIsAuthenticated = (s: AppState) => s.user !== null;

export const selectFilteredNodes = (s: AppState) =>
  s.nodes.filter((n) => (n.scopeId ?? null) === (s.currentScopeId ?? null));

export const selectFilteredEdges = (s: AppState) => {
  const scopeId = s.currentScopeId;
  return s.edges.filter((e) => (e.scopeId ?? null) === (scopeId ?? null));
};

export const selectIsAnyPanelResizing = (s: AppState) =>
  Object.values(s.sidePanelLayouts).some((l) => l.isResizing);
