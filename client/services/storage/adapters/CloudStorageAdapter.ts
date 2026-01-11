import { GraphNode, GraphEdge } from '../../../types';
import { ViewportBounds, GhostNode, StorageAdapter } from '../types';

const API_BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api';

/**
 * CloudStorageAdapter provides viewport-based access to cloud storage via REST API.
 * Uses PostgreSQL with PostGIS for spatial queries.
 *
 * Key features:
 * - Viewport-based fetching using spatial queries
 * - AbortController for canceling in-flight requests on viewport change
 * - Batch operations for performance
 * - Yjs state sync endpoints
 */
export class CloudStorageAdapter implements StorageAdapter {
  private enabled = false;
  private abortController: AbortController | null = null;
  private userId: string | null = null;

  constructor() {}

  /**
   * Initialize with user authentication
   */
  async initialize(userId?: string): Promise<void> {
    this.userId = userId ?? null;
    this.enabled = !!userId;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Check if user is authenticated
   */
  async checkAuth(): Promise<{ isAuthenticated: boolean; user?: any }> {
    try {
      const res = await fetch(`${API_BASE}/auth/check`, { credentials: 'include' });
      return await res.json();
    } catch {
      return { isAuthenticated: false };
    }
  }

  /**
   * Load nodes within viewport bounds
   */
  async loadNodesInBounds(bounds: ViewportBounds): Promise<GraphNode[]> {
    if (!this.enabled) return [];

    const result = await this.fetchNodesInViewport(bounds);
    return result.nodes;
  }

  /**
   * Fetch nodes and edges within viewport bounds
   */
  async fetchNodesInViewport(
    bounds: ViewportBounds
  ): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
    if (!this.enabled) return { nodes: [], edges: [] };

    // Cancel any in-flight viewport request
    this.cancelPendingRequests();

    this.abortController = new AbortController();

    const query = new URLSearchParams({
      minX: bounds.minX.toString(),
      minY: bounds.minY.toString(),
      maxX: bounds.maxX.toString(),
      maxY: bounds.maxY.toString(),
    });

    try {
      const res = await fetch(`${API_BASE}/graph?${query.toString()}`, {
        credentials: 'include',
        signal: this.abortController.signal,
      });

      if (!res.ok) {
        throw new Error(`Failed to load viewport: ${res.status}`);
      }

      return await res.json();
    } catch (e: any) {
      if (e.name === 'AbortError') {
        // Request was cancelled, return empty
        return { nodes: [], edges: [] };
      }
      throw e;
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Fetch ghost nodes (position only) for edge targets outside viewport
   */
  async fetchGhostNodes(nodeIds: string[]): Promise<GhostNode[]> {
    if (!this.enabled || nodeIds.length === 0) return [];

    try {
      const res = await fetch(`${API_BASE}/nodes/positions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ nodeIds }),
      });

      if (!res.ok) return [];

      const data = await res.json();
      return data.positions || [];
    } catch {
      return [];
    }
  }

  /**
   * Load all nodes (no viewport filter)
   */
  async loadAllNodes(): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
    if (!this.enabled) return { nodes: [], edges: [] };

    try {
      const res = await fetch(`${API_BASE}/graph`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load graph');
      return await res.json();
    } catch {
      return { nodes: [], edges: [] };
    }
  }

  /**
   * Load a single node by ID
   */
  async loadNode(nodeId: string): Promise<GraphNode | null> {
    if (!this.enabled) return null;

    try {
      const res = await fetch(`${API_BASE}/nodes/${nodeId}`, {
        credentials: 'include',
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  /**
   * Save a single node
   */
  async saveNode(node: GraphNode, _edges?: GraphEdge[]): Promise<void> {
    if (!this.enabled) return;

    try {
      await fetch(`${API_BASE}/nodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(node),
      });
    } catch (e) {
      console.error('Cloud save error:', e);
    }
  }

  /**
   * Save multiple nodes in a batch
   */
  async saveNodesBatch(
    nodes: Array<GraphNode & { skipEmbedding?: boolean }>
  ): Promise<void> {
    if (!this.enabled || nodes.length === 0) return;

    try {
      await fetch(`${API_BASE}/nodes/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(nodes),
      });
    } catch (e) {
      console.error('Cloud batch save error:', e);
    }
  }

  /**
   * Delete a node
   */
  async deleteNode(nodeId: string): Promise<void> {
    if (!this.enabled) return;

    try {
      await fetch(`${API_BASE}/nodes/${nodeId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
    } catch (e) {
      console.error('Cloud delete error:', e);
    }
  }

  /**
   * Save edges
   */
  async saveEdges(edges: GraphEdge[]): Promise<void> {
    if (!this.enabled) return;

    try {
      await fetch(`${API_BASE}/edges`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(edges),
      });
    } catch (e) {
      console.error('Cloud edges save error:', e);
    }
  }

  // --- Yjs Sync Methods ---

  /**
   * Push a Yjs update for a node
   */
  async pushYjsUpdate(nodeId: string, update: Uint8Array): Promise<void> {
    if (!this.enabled) return;

    try {
      await fetch(`${API_BASE}/nodes/${nodeId}/yjs-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        credentials: 'include',
        body: update,
      });
    } catch (e) {
      console.error('Yjs sync push error:', e);
    }
  }

  /**
   * Pull Yjs state for a node
   */
  async pullYjsState(nodeId: string): Promise<Uint8Array | null> {
    if (!this.enabled) return null;

    try {
      const res = await fetch(`${API_BASE}/nodes/${nodeId}/yjs-state`, {
        credentials: 'include',
      });

      if (!res.ok) return null;

      const buffer = await res.arrayBuffer();
      return new Uint8Array(buffer);
    } catch {
      return null;
    }
  }

  /**
   * Pull Yjs states for multiple nodes
   */
  async pullYjsStatesBatch(
    nodeIds: string[]
  ): Promise<Map<string, Uint8Array>> {
    if (!this.enabled || nodeIds.length === 0) return new Map();

    try {
      const res = await fetch(`${API_BASE}/nodes/yjs-states`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ nodeIds }),
      });

      if (!res.ok) return new Map();

      // Response is a map of nodeId -> base64-encoded state
      const data = await res.json();
      const result = new Map<string, Uint8Array>();

      for (const [nodeId, base64State] of Object.entries(data.states || {})) {
        const binary = atob(base64State as string);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        result.set(nodeId, bytes);
      }

      return result;
    } catch {
      return new Map();
    }
  }

  /**
   * Cancel any pending viewport requests
   */
  cancelPendingRequests(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
}
