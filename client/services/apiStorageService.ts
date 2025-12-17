
import { GraphNode, GraphEdge } from '../types';

const API_BASE = import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : '/api';

export const checkAuth = async () => {
  try {
    const res = await fetch(`${API_BASE}/auth/check`, { credentials: 'include' });
    return await res.json();
  } catch (e) {
    return { isAuthenticated: false };
  }
};

export const logout = async () => {
  const res = await fetch(`${API_BASE}/auth/logout`, { 
    method: 'POST',
    credentials: 'include'
  });
  return await res.json();
};

export const pickServerDirectory = async () => {
  const res = await fetch(`${API_BASE}/system/pick-path`, { credentials: 'include' });
  return await res.json();
};

export const updateUserSettings = async (storagePath: string) => {
  const res = await fetch(`${API_BASE}/user/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ storagePath })
  });
  return await res.json();
};

export const loadGraphFromApi = async () => {
  const res = await fetch(`${API_BASE}/graph`, { credentials: 'include' });
  if (!res.ok) throw new Error('Failed to load graph');
  return await res.json(); // returns { nodes, edges }
};

export const fetchNodesInViewport = async (
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  signal?: AbortSignal
) => {
  const query = new URLSearchParams({
    minX: minX.toString(),
    minY: minY.toString(),
    maxX: maxX.toString(),
    maxY: maxY.toString(),
  });
  const res = await fetch(`${API_BASE}/graph?${query.toString()}`, {
    credentials: 'include',
    signal
  });
  if (!res.ok) throw new Error('Failed to load graph viewport');
  return await res.json(); // returns { nodes, edges }
};

export const saveNodeToApi = async (node: GraphNode) => {
  const res = await fetch(`${API_BASE}/nodes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(node)
  });
  return await res.json();
};

export const saveNodesBatchToApi = async (nodes: Array<GraphNode & { skipEmbedding?: boolean }>) => {
  const res = await fetch(`${API_BASE}/nodes/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(nodes)
  });
  return await res.json();
};

export const deleteNodeFromApi = async (nodeId: string) => {
  const res = await fetch(`${API_BASE}/nodes/${nodeId}`, {
    method: 'DELETE',
    credentials: 'include'
  });
  return await res.json();
};

export const saveEdgesToApi = async (edges: GraphEdge[]) => {
  const res = await fetch(`${API_BASE}/edges`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(edges)
  });
  return await res.json();
};
