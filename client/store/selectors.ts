import { AppState } from './AppState';

export const selectIsAuthenticated = (s: AppState) => s.user !== null;

export const selectFilteredNodes = (s: AppState) =>
  s.nodes.filter((n) => (n.scopeId ?? null) === (s.currentScopeId ?? null));

export const selectFilteredEdges = (s: AppState) => {
  const scopeId = s.currentScopeId;
  return s.edges.filter((e) => (e.scopeId ?? null) === (scopeId ?? null));
};

export const selectIsAnyPanelResizing = (s: AppState) =>
  Object.values(s.sidePanelLayouts).some((l) => l.isResizing);
