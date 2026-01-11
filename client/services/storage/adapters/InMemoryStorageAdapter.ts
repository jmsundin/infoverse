import { GraphNode, GraphEdge } from '../../../types';
import { ViewportBounds, StorageAdapter } from '../types';

/**
 * InMemoryStorageAdapter stores all data in memory without any persistence.
 * Used for unauthenticated users who can interact with the app but don't save data.
 *
 * Key features:
 * - All data stored in memory (Map and Array)
 * - Supports spatial queries by filtering bounds
 * - Provides methods to export all data for migration on sign-in
 * - Clear method to reset after migration
 */
export class InMemoryStorageAdapter implements StorageAdapter {
  private nodes: Map<string, GraphNode> = new Map();
  private edges: Map<string, GraphEdge> = new Map(); // edgeId -> edge

  constructor() {
    // No initialization needed
  }

  /**
   * Initialize - no-op for in-memory adapter
   */
  async initialize(): Promise<void> {
    // Nothing to do
  }

  /**
   * Always enabled - in-memory storage is always available
   */
  isEnabled(): boolean {
    return true;
  }

  /**
   * Load nodes within viewport bounds by filtering all nodes
   */
  async loadNodesInBounds(bounds: ViewportBounds): Promise<GraphNode[]> {
    const result: GraphNode[] = [];

    for (const node of this.nodes.values()) {
      const nodeRight = node.x + (node.width || 300);
      const nodeBottom = node.y + (node.height || 200);

      // Check if node intersects bounds
      if (
        node.x < bounds.maxX &&
        nodeRight > bounds.minX &&
        node.y < bounds.maxY &&
        nodeBottom > bounds.minY
      ) {
        result.push(node);
      }
    }

    return result;
  }

  /**
   * Load a single node by ID
   */
  async loadNode(nodeId: string): Promise<GraphNode | null> {
    return this.nodes.get(nodeId) || null;
  }

  /**
   * Save a node to memory
   */
  async saveNode(node: GraphNode, outgoingEdges: GraphEdge[] = []): Promise<void> {
    // Store the node
    this.nodes.set(node.id, { ...node });

    // Update edges - remove old edges from this source, add new ones
    for (const [edgeId, edge] of this.edges.entries()) {
      if (edge.source === node.id) {
        this.edges.delete(edgeId);
      }
    }

    for (const edge of outgoingEdges) {
      this.edges.set(edge.id, { ...edge });
    }
  }

  /**
   * Delete a node from memory
   */
  async deleteNode(nodeId: string): Promise<void> {
    this.nodes.delete(nodeId);

    // Also remove any edges connected to this node
    for (const [edgeId, edge] of this.edges.entries()) {
      if (edge.source === nodeId || edge.target === nodeId) {
        this.edges.delete(edgeId);
      }
    }
  }

  // --- Methods for migration and data access ---

  /**
   * Get all nodes (for migration to persistent storage)
   */
  getAllNodes(): GraphNode[] {
    return Array.from(this.nodes.values());
  }

  /**
   * Get all edges (for migration to persistent storage)
   */
  getAllEdges(): GraphEdge[] {
    return Array.from(this.edges.values());
  }

  /**
   * Get count of nodes (to check if there's data to migrate)
   */
  getNodeCount(): number {
    return this.nodes.size;
  }

  /**
   * Check if there's any data stored
   */
  hasData(): boolean {
    return this.nodes.size > 0;
  }

  /**
   * Load edges for specific source nodes
   */
  async loadEdgesForNodes(nodeIds: Set<string>): Promise<GraphEdge[]> {
    const result: GraphEdge[] = [];

    for (const edge of this.edges.values()) {
      if (nodeIds.has(edge.source)) {
        result.push(edge);
      }
    }

    return result;
  }

  /**
   * Load all edges
   */
  async loadAllEdges(): Promise<GraphEdge[]> {
    return Array.from(this.edges.values());
  }

  /**
   * Clear all data (after successful migration)
   */
  clear(): void {
    this.nodes.clear();
    this.edges.clear();
  }

  /**
   * Update a node in place (for quick position updates, etc.)
   */
  updateNode(node: GraphNode): void {
    this.nodes.set(node.id, { ...node });
  }

  /**
   * Add an edge
   */
  addEdge(edge: GraphEdge): void {
    this.edges.set(edge.id, { ...edge });
  }

  /**
   * Get edges where this node is source or target
   */
  getEdgesForNode(nodeId: string): GraphEdge[] {
    const result: GraphEdge[] = [];

    for (const edge of this.edges.values()) {
      if (edge.source === nodeId || edge.target === nodeId) {
        result.push(edge);
      }
    }

    return result;
  }
}
