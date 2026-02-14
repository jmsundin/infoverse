/**
 * SQLiteStorageAdapter - Implements StorageAdapter interface using SQLite
 *
 * Provides viewport-based spatial queries via R*Tree and manages
 * the split layout/content tables for efficient position updates.
 */

import { ulid } from 'ulid';
import { GraphNode, GraphEdge, NodeType } from '../../../types';
import {
  LocalStorageAdapterInterface,
  ViewportBounds,
  SpatialIndexEntry,
  NodePositionIndex,
  DeletedNodeEntry,
} from '../types';
import { SQLiteService, getSQLiteService } from './SQLiteService';
import { SQLiteSpatialIndex, NodeLayoutRow, NodeContentRow } from './SQLiteSpatialIndex';
import { initializeSchema } from './SQLiteSchema';
import { withDerivedContentFields } from '../../../utils/nodeContentUtils';

export interface SQLiteStorageAdapterConfig {
  saveDebounceMs?: number;
  deviceId?: string;
}

const DEFAULT_CONFIG: Required<SQLiteStorageAdapterConfig> = {
  saveDebounceMs: 500,
  deviceId: ulid(), // Generate unique device ID
};

export class SQLiteStorageAdapter implements LocalStorageAdapterInterface {
  private sqliteService: SQLiteService;
  private spatialIndex: SQLiteSpatialIndex | null = null;
  private config: Required<SQLiteStorageAdapterConfig>;
  private initialized = false;

  constructor(config: SQLiteStorageAdapterConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.sqliteService = getSQLiteService();
  }

  /**
   * Initialize the adapter and schema
   * @param _dirHandle Optional directory handle (not used by SQLite adapter, kept for interface compatibility)
   */
  async initialize(_dirHandle?: FileSystemDirectoryHandle): Promise<void> {
    if (this.initialized) return;

    // Initialize SQLite service
    await this.sqliteService.initialize();

    // Initialize schema (creates tables, indexes, triggers)
    await initializeSchema(this.sqliteService);

    // Create spatial index helper
    this.spatialIndex = new SQLiteSpatialIndex(this.sqliteService);

    this.initialized = true;
    console.log('[SQLiteStorageAdapter] Initialized');
  }

  isEnabled(): boolean {
    return this.initialized;
  }

  /**
   * Load nodes within viewport bounds
   */
  async loadNodesInBounds(bounds: ViewportBounds): Promise<GraphNode[]> {
    this.ensureInitialized();

    const { layouts, contents } = this.spatialIndex!.queryViewportFull(bounds);

    // Join layout and content data
    const contentMap = new Map(contents.map(c => [c.id, c]));

    return layouts.map(layout => {
      const content = contentMap.get(layout.id);
      return this.rowsToGraphNode(layout, content ?? null);
    });
  }

  /**
   * Load a single node by ID
   */
  async loadNode(nodeId: string): Promise<GraphNode | null> {
    this.ensureInitialized();

    const layout = this.spatialIndex!.getLayout(nodeId);
    if (!layout) return null;

    const content = this.spatialIndex!.getContent(nodeId);
    return this.rowsToGraphNode(layout, content);
  }

  /**
   * Save a node (both layout and content)
   */
  async saveNode(node: GraphNode, edges: GraphEdge[] = []): Promise<void> {
    this.ensureInitialized();

    const now = Date.now();
    const existingLayout = this.spatialIndex!.getLayout(node.id);

    if (existingLayout) {
      // Update existing node
      this.sqliteService.transaction(() => {
        // Update layout
        this.spatialIndex!.updateLayout(
          node.id,
          node.x,
          node.y,
          node.width ?? 300,
          node.height ?? 200,
          now
        );

        // Update additional layout fields
        this.sqliteService.run(
          `UPDATE node_layout SET pinned = ?, parent_id = ?, scope_id = ? WHERE id = ?`,
          [node.pinned ? 1 : 0, node.parentId ?? null, node.scopeId ?? null, node.id]
        );

        // Update content
        this.spatialIndex!.updateContent(node.id, {
          type: node.type,
          content: node.content,
          title: node.title,
          color: node.color,
          auto_expand_depth: node.autoExpandDepth,
        }, now);

        // Update edges
        this.updateEdges(node.id, edges);
      });
    } else {
      // Insert new node
      const filename = this.generateFilename(node);

      this.sqliteService.transaction(() => {
        this.spatialIndex!.insertNode(
          {
            id: node.id,
            x: node.x,
            y: node.y,
            width: node.width ?? 300,
            height: node.height ?? 200,
            pinned: node.pinned ? 1 : 0,
            parent_id: node.parentId ?? null,
            parent_offset_x: null,
            parent_offset_y: null,
            scope_id: node.scopeId ?? null,
            position_updated_at: now,
          },
          {
            id: node.id,
            type: node.type ?? NodeType.NOTE,
            content: node.content ?? '',
            title: node.title ?? null,
            color: node.color ?? null,
            auto_expand_depth: node.autoExpandDepth ?? null,
            filename,
            file_mtime: null,
            content_updated_at: now,
          }
        );

        // Insert edges
        this.updateEdges(node.id, edges);
      });
    }

    // Append to sync outbox
    this.appendToOutbox(existingLayout ? 'UPDATE' : 'INSERT', 'node', node.id, node);
  }

  /**
   * Save a node immediately (alias for saveNode, which is already synchronous)
   */
  async saveNodeImmediate(node: GraphNode, edges: GraphEdge[] = []): Promise<void> {
    return this.saveNode(node, edges);
  }

  /**
   * Delete a node
   */
  async deleteNode(nodeId: string): Promise<void> {
    this.ensureInitialized();

    const layout = this.spatialIndex!.getLayout(nodeId);
    const content = this.spatialIndex!.getContent(nodeId);

    if (!layout) return;

    // Get connected edges for deletion stack
    const edges = this.getEdgesForNode(nodeId);

    this.sqliteService.transaction(() => {
      // Save to deletion stack for undo
      this.sqliteService.run(
        `INSERT INTO deleted_nodes (node_id, layout_data, content_data, edges_data, deleted_at)
         VALUES (?, ?, ?, ?, ?)`,
        [
          nodeId,
          JSON.stringify(layout),
          JSON.stringify(content),
          JSON.stringify(edges),
          Date.now(),
        ]
      );

      // Delete edges involving this node
      this.sqliteService.run('DELETE FROM edges WHERE source = ? OR target = ?', [nodeId, nodeId]);

      // Delete node (triggers clean up R*Tree)
      this.spatialIndex!.deleteNode(nodeId);
    });

    // Append to sync outbox
    this.appendToOutbox('DELETE', 'node', nodeId, { id: nodeId });
  }

  /**
   * Restore the most recently deleted node
   */
  async restoreNode(): Promise<DeletedNodeEntry | null> {
    this.ensureInitialized();

    const deleted = this.sqliteService.queryOne<{
      id: number;
      node_id: string;
      layout_data: string;
      content_data: string;
      edges_data: string;
      deleted_at: number;
    }>('SELECT * FROM deleted_nodes ORDER BY deleted_at DESC LIMIT 1');

    if (!deleted) return null;

    const layout: NodeLayoutRow = JSON.parse(deleted.layout_data);
    const content: NodeContentRow = JSON.parse(deleted.content_data);
    const edges: GraphEdge[] = JSON.parse(deleted.edges_data || '[]');

    this.sqliteService.transaction(() => {
      // Re-insert the node
      this.spatialIndex!.insertNode(
        {
          ...layout,
          position_updated_at: Date.now(),
        },
        {
          ...content,
          content_updated_at: Date.now(),
        }
      );

      // Re-insert edges
      for (const edge of edges) {
        this.sqliteService.run(
          'INSERT OR IGNORE INTO edges (id, source, target, label, scope_id) VALUES (?, ?, ?, ?, ?)',
          [edge.id, edge.source, edge.target, edge.label, edge.scopeId ?? null]
        );
      }

      // Remove from deletion stack
      this.sqliteService.run('DELETE FROM deleted_nodes WHERE id = ?', [deleted.id]);
    });

    const node = this.rowsToGraphNode(layout, content);
    return { node, edges, deletedAt: deleted.deleted_at };
  }

  /**
   * Get the number of deleted nodes in the stack
   */
  getDeletionStackSize(): number {
    this.ensureInitialized();
    return this.sqliteService.queryScalar<number>('SELECT COUNT(*) FROM deleted_nodes') ?? 0;
  }

  /**
   * Prune old entries from the deletion stack
   */
  async pruneDeletionStack(maxAgeMs: number = 30 * 24 * 60 * 60 * 1000): Promise<number> {
    this.ensureInitialized();
    const cutoff = Date.now() - maxAgeMs;
    return this.sqliteService.run('DELETE FROM deleted_nodes WHERE deleted_at < ?', [cutoff]);
  }

  // --- Extended API for viewport-based loading ---

  /**
   * Get spatial index entries (for skeleton rendering)
   */
  getAllSpatialIndex(): SpatialIndexEntry[] {
    this.ensureInitialized();

    const rows = this.sqliteService.query<NodeLayoutRow & { type: string; color: string | null; title: string | null }>(
      `SELECT l.*, c.type, c.color, c.title, c.filename
       FROM node_layout l
       LEFT JOIN node_content c ON l.id = c.id`
    );

    return rows.map(row => ({
      id: row.id,
      x: row.x,
      y: row.y,
      width: row.width,
      height: row.height,
      filename: (row as any).filename ?? `${row.id}.md`,
      type: (row.type as NodeType) ?? NodeType.NOTE,
      color: row.color as any,
      title: row.title ?? undefined,
      scopeId: row.scope_id ?? undefined,
    }));
  }

  /**
   * Get extended metadata for a single node
   */
  getExtendedMetadata(nodeId: string): SpatialIndexEntry | undefined {
    this.ensureInitialized();

    const row = this.sqliteService.queryOne<NodeLayoutRow & { type: string; color: string | null; title: string | null; filename: string }>(
      `SELECT l.*, c.type, c.color, c.title, c.filename
       FROM node_layout l
       LEFT JOIN node_content c ON l.id = c.id
       WHERE l.id = ?`,
      [nodeId]
    );

    if (!row) return undefined;

    return {
      id: row.id,
      x: row.x,
      y: row.y,
      width: row.width,
      height: row.height,
      filename: row.filename ?? `${row.id}.md`,
      type: (row.type as NodeType) ?? NodeType.NOTE,
      color: row.color as any,
      title: row.title ?? undefined,
      scopeId: row.scope_id ?? undefined,
    };
  }

  /**
   * Get node positions in bounds (for quick spatial queries)
   */
  getNodePositionsInBounds(bounds: ViewportBounds): NodePositionIndex[] {
    this.ensureInitialized();

    const results = this.spatialIndex!.queryViewportPositions(bounds);

    return results.map(r => ({
      id: r.id,
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      filename: '', // Not available in quick query
    }));
  }

  /**
   * Get node position info from index (fast, no file read)
   */
  getNodePosition(nodeId: string): NodePositionIndex | undefined {
    this.ensureInitialized();

    const layout = this.spatialIndex!.getLayout(nodeId);
    if (!layout) return undefined;

    return {
      id: layout.id,
      x: layout.x,
      y: layout.y,
      width: layout.width,
      height: layout.height,
      filename: '', // Would need content table join for filename
    };
  }

  /**
   * Update node position in index (fast path for drag)
   */
  updateNodePositionInIndex(
    nodeId: string,
    x: number,
    y: number,
    width?: number,
    height?: number
  ): void {
    this.ensureInitialized();
    this.spatialIndex!.updateLayout(nodeId, x, y, width, height);
  }

  /**
   * Get all node IDs
   */
  getAllNodeIds(): string[] {
    this.ensureInitialized();
    return this.spatialIndex!.getAllNodeIds();
  }

  /**
   * Get total node count
   */
  getNodeCount(): number {
    this.ensureInitialized();
    return this.spatialIndex!.getNodeCount();
  }

  /**
   * Load all edges
   */
  async loadAllEdges(): Promise<GraphEdge[]> {
    this.ensureInitialized();

    return this.sqliteService.query<GraphEdge>(
      'SELECT id, source, target, label, scope_id as scopeId FROM edges'
    );
  }

  /**
   * Load edges for specific nodes
   */
  async loadEdgesForNodes(nodeIds: Set<string>): Promise<GraphEdge[]> {
    this.ensureInitialized();

    if (nodeIds.size === 0) return [];

    const ids = Array.from(nodeIds);
    const placeholders = ids.map(() => '?').join(',');

    return this.sqliteService.query<GraphEdge>(
      `SELECT id, source, target, label, scope_id as scopeId
       FROM edges WHERE source IN (${placeholders})`,
      ids
    );
  }

  /**
   * Get the spatial index helper (for advanced queries)
   */
  getSpatialIndex(): SQLiteSpatialIndex | null {
    return this.spatialIndex;
  }

  /**
   * Flush pending changes to OPFS
   */
  async flush(): Promise<void> {
    await this.sqliteService.flush();
  }

  // --- Private helpers ---

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('SQLiteStorageAdapter not initialized');
    }
  }

  private rowsToGraphNode(layout: NodeLayoutRow, content: NodeContentRow | null): GraphNode {
    return withDerivedContentFields({
      id: layout.id,
      type: (content?.type as NodeType) ?? NodeType.NOTE,
      x: layout.x,
      y: layout.y,
      width: layout.width,
      height: layout.height,
      content: content?.content ?? '',
      title: content?.title ?? undefined,
      color: content?.color as any,
      pinned: layout.pinned === 1,
      scopeId: layout.scope_id ?? undefined,
      parentId: layout.parent_id ?? undefined,
      autoExpandDepth: content?.auto_expand_depth ?? undefined,
    });
  }

  private generateFilename(node: GraphNode): string {
    const title = node.title || node.content?.split('\n')[0]?.replace(/^#\s*/, '') || 'Untitled';
    const sanitized = title
      .replace(/[^a-zA-Z0-9\s\-_]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
    return `${sanitized || 'Untitled'}.md`;
  }

  private updateEdges(nodeId: string, edges: GraphEdge[]): void {
    // Delete existing edges from this source
    this.sqliteService.run('DELETE FROM edges WHERE source = ?', [nodeId]);

    // Insert new edges
    for (const edge of edges) {
      this.sqliteService.run(
        'INSERT OR IGNORE INTO edges (id, source, target, label, scope_id) VALUES (?, ?, ?, ?, ?)',
        [edge.id, edge.source, edge.target, edge.label, edge.scopeId ?? null]
      );
    }
  }

  private getEdgesForNode(nodeId: string): GraphEdge[] {
    return this.sqliteService.query<GraphEdge>(
      `SELECT id, source, target, label, scope_id as scopeId
       FROM edges WHERE source = ? OR target = ?`,
      [nodeId, nodeId]
    );
  }

  private appendToOutbox(
    operation: 'INSERT' | 'UPDATE' | 'DELETE',
    entityType: string,
    entityId: string,
    payload: any
  ): void {
    this.sqliteService.run(
      `INSERT INTO sync_outbox (op_id, device_id, operation, entity_type, entity_id, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [ulid(), this.config.deviceId, operation, entityType, entityId, JSON.stringify(payload), Date.now()]
    );
  }
}
