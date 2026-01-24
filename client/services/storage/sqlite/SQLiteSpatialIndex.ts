/**
 * SQLiteSpatialIndex - R*Tree operations for viewport culling
 *
 * Provides efficient spatial queries using SQLite's R*Tree virtual table.
 * Uses the IDs-first-then-hydrate pattern for optimal performance.
 */

import { SQLiteService } from './SQLiteService';

export interface ViewportBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface SpatialQueryResult {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NodeLayoutRow {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pinned: number;
  parent_id: string | null;
  parent_offset_x: number | null;
  parent_offset_y: number | null;
  scope_id: string | null;
  position_updated_at: number;
  layout_materialized_at: number | null;
  layout_hash: string | null;
}

export interface NodeContentRow {
  id: string;
  type: string;
  content: string | null;
  title: string | null;
  color: string | null;
  auto_expand_depth: number | null;
  filename: string;
  file_mtime: number | null;
  content_hash: string | null;
  content_updated_at: number;
  content_materialized_at: number | null;
}

export class SQLiteSpatialIndex {
  constructor(private db: SQLiteService) {}

  /**
   * Query node IDs within viewport bounds (fast, IDs only)
   * This is the first phase of the IDs-then-hydrate pattern
   */
  queryViewportIds(bounds: ViewportBounds): string[] {
    const sql = `
      SELECT m.node_id
      FROM nodes_rtree r
      JOIN node_layout_rtree_map m ON r.id = m.rowid
      WHERE r.max_x >= ? AND r.min_x <= ?
        AND r.max_y >= ? AND r.min_y <= ?
    `;

    const rows = this.db.query<{ node_id: string }>(sql, [
      bounds.minX,
      bounds.maxX,
      bounds.minY,
      bounds.maxY,
    ]);

    return rows.map(r => r.node_id);
  }

  /**
   * Query node positions within viewport bounds (fast, minimal data)
   * Returns position data for skeleton rendering
   */
  queryViewportPositions(bounds: ViewportBounds): SpatialQueryResult[] {
    const sql = `
      SELECT nl.id, nl.x, nl.y, nl.width, nl.height
      FROM nodes_rtree r
      JOIN node_layout_rtree_map m ON r.id = m.rowid
      JOIN node_layout nl ON nl.id = m.node_id
      WHERE r.max_x >= ? AND r.min_x <= ?
        AND r.max_y >= ? AND r.min_y <= ?
    `;

    return this.db.query<SpatialQueryResult>(sql, [
      bounds.minX,
      bounds.maxX,
      bounds.minY,
      bounds.maxY,
    ]);
  }

  /**
   * Hydrate layout data for a batch of node IDs
   */
  hydrateLayouts(nodeIds: string[]): NodeLayoutRow[] {
    if (nodeIds.length === 0) return [];

    const placeholders = nodeIds.map(() => '?').join(',');
    const sql = `SELECT * FROM node_layout WHERE id IN (${placeholders})`;

    return this.db.query<NodeLayoutRow>(sql, nodeIds);
  }

  /**
   * Hydrate content data for a batch of node IDs
   */
  hydrateContents(nodeIds: string[]): NodeContentRow[] {
    if (nodeIds.length === 0) return [];

    const placeholders = nodeIds.map(() => '?').join(',');
    const sql = `SELECT * FROM node_content WHERE id IN (${placeholders})`;

    return this.db.query<NodeContentRow>(sql, nodeIds);
  }

  /**
   * Full query: get complete node data within viewport
   * Uses IDs-first-then-hydrate for efficiency
   */
  queryViewportFull(
    bounds: ViewportBounds
  ): { layouts: NodeLayoutRow[]; contents: NodeContentRow[] } {
    // Phase 1: Get IDs from R*Tree
    const nodeIds = this.queryViewportIds(bounds);

    if (nodeIds.length === 0) {
      return { layouts: [], contents: [] };
    }

    // Phase 2: Hydrate layouts and contents in parallel queries
    const layouts = this.hydrateLayouts(nodeIds);
    const contents = this.hydrateContents(nodeIds);

    return { layouts, contents };
  }

  /**
   * Get a single node's layout by ID
   */
  getLayout(nodeId: string): NodeLayoutRow | null {
    return this.db.queryOne<NodeLayoutRow>('SELECT * FROM node_layout WHERE id = ?', [nodeId]);
  }

  /**
   * Get a single node's content by ID
   */
  getContent(nodeId: string): NodeContentRow | null {
    return this.db.queryOne<NodeContentRow>('SELECT * FROM node_content WHERE id = ?', [nodeId]);
  }

  /**
   * Insert a new node (both layout and content)
   */
  insertNode(layout: Omit<NodeLayoutRow, 'layout_materialized_at' | 'layout_hash'>, content: Omit<NodeContentRow, 'content_materialized_at' | 'content_hash'>): void {
    this.db.transaction(() => {
      // Insert layout (triggers will update R*Tree)
      this.db.run(
        `INSERT INTO node_layout (
          id, x, y, width, height, pinned, parent_id, parent_offset_x, parent_offset_y,
          scope_id, position_updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          layout.id,
          layout.x,
          layout.y,
          layout.width,
          layout.height,
          layout.pinned,
          layout.parent_id,
          layout.parent_offset_x,
          layout.parent_offset_y,
          layout.scope_id,
          layout.position_updated_at,
        ]
      );

      // Insert content
      this.db.run(
        `INSERT INTO node_content (
          id, type, content, title, color, auto_expand_depth, filename, file_mtime, content_updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          content.id,
          content.type,
          content.content,
          content.title,
          content.color,
          content.auto_expand_depth,
          content.filename,
          content.file_mtime,
          content.content_updated_at,
        ]
      );
    });
  }

  /**
   * Update a node's layout (position/size)
   * This is the hot path during drag operations
   */
  updateLayout(
    nodeId: string,
    x: number,
    y: number,
    width?: number,
    height?: number,
    timestamp?: number
  ): void {
    const now = timestamp ?? Date.now();

    if (width !== undefined && height !== undefined) {
      this.db.run(
        `UPDATE node_layout SET x = ?, y = ?, width = ?, height = ?, position_updated_at = ? WHERE id = ?`,
        [x, y, width, height, now, nodeId]
      );
    } else {
      this.db.run(
        `UPDATE node_layout SET x = ?, y = ?, position_updated_at = ? WHERE id = ?`,
        [x, y, now, nodeId]
      );
    }
  }

  /**
   * Update a node's content
   */
  updateContent(
    nodeId: string,
    updates: Partial<Pick<NodeContentRow, 'content' | 'title' | 'color' | 'type' | 'auto_expand_depth' | 'filename'>>,
    timestamp?: number
  ): void {
    const now = timestamp ?? Date.now();
    const setClauses: string[] = ['content_updated_at = ?'];
    const params: any[] = [now];

    if (updates.content !== undefined) {
      setClauses.push('content = ?');
      params.push(updates.content);
    }
    if (updates.title !== undefined) {
      setClauses.push('title = ?');
      params.push(updates.title);
    }
    if (updates.color !== undefined) {
      setClauses.push('color = ?');
      params.push(updates.color);
    }
    if (updates.type !== undefined) {
      setClauses.push('type = ?');
      params.push(updates.type);
    }
    if (updates.auto_expand_depth !== undefined) {
      setClauses.push('auto_expand_depth = ?');
      params.push(updates.auto_expand_depth);
    }
    if (updates.filename !== undefined) {
      setClauses.push('filename = ?');
      params.push(updates.filename);
    }

    params.push(nodeId);

    this.db.run(`UPDATE node_content SET ${setClauses.join(', ')} WHERE id = ?`, params);
  }

  /**
   * Delete a node (both layout and content)
   * Layout deletion trigger will clean up R*Tree
   */
  deleteNode(nodeId: string): void {
    this.db.transaction(() => {
      this.db.run('DELETE FROM node_content WHERE id = ?', [nodeId]);
      this.db.run('DELETE FROM node_layout WHERE id = ?', [nodeId]); // Trigger cleans R*Tree
    });
  }

  /**
   * Batch update positions (for drag operations affecting multiple nodes)
   */
  batchUpdatePositions(
    updates: Array<{ id: string; x: number; y: number }>,
    timestamp?: number
  ): void {
    const now = timestamp ?? Date.now();

    this.db.transaction(() => {
      for (const { id, x, y } of updates) {
        this.db.run(
          `UPDATE node_layout SET x = ?, y = ?, position_updated_at = ? WHERE id = ?`,
          [x, y, now, id]
        );
      }
    });
  }

  /**
   * Get nodes that need to be materialized (layout changed since last materialization)
   */
  getUnmaterializedLayouts(limit = 100): NodeLayoutRow[] {
    return this.db.query<NodeLayoutRow>(
      `SELECT * FROM node_layout
       WHERE layout_materialized_at IS NULL
          OR position_updated_at > layout_materialized_at
       ORDER BY position_updated_at DESC
       LIMIT ?`,
      [limit]
    );
  }

  /**
   * Get nodes that need content materialization
   */
  getUnmaterializedContents(limit = 100): NodeContentRow[] {
    return this.db.query<NodeContentRow>(
      `SELECT * FROM node_content
       WHERE content_materialized_at IS NULL
          OR content_updated_at > content_materialized_at
       ORDER BY content_updated_at DESC
       LIMIT ?`,
      [limit]
    );
  }

  /**
   * Mark a layout as materialized
   */
  markLayoutMaterialized(nodeId: string, hash: string, timestamp?: number): void {
    const now = timestamp ?? Date.now();
    this.db.run(
      `UPDATE node_layout SET layout_materialized_at = ?, layout_hash = ? WHERE id = ?`,
      [now, hash, nodeId]
    );
  }

  /**
   * Mark content as materialized
   */
  markContentMaterialized(nodeId: string, hash: string, timestamp?: number): void {
    const now = timestamp ?? Date.now();
    this.db.run(
      `UPDATE node_content SET content_materialized_at = ?, content_hash = ? WHERE id = ?`,
      [now, hash, nodeId]
    );
  }

  /**
   * Get all node IDs (for full export/sync)
   */
  getAllNodeIds(): string[] {
    const rows = this.db.query<{ id: string }>('SELECT id FROM node_layout');
    return rows.map(r => r.id);
  }

  /**
   * Get total node count
   */
  getNodeCount(): number {
    return this.db.queryScalar<number>('SELECT COUNT(*) FROM node_layout') ?? 0;
  }

  /**
   * Get children of a parent node (using relative positioning)
   */
  getChildren(parentId: string): NodeLayoutRow[] {
    return this.db.query<NodeLayoutRow>(
      'SELECT * FROM node_layout WHERE parent_id = ?',
      [parentId]
    );
  }

  /**
   * Get nodes in a scope
   */
  getNodesInScope(scopeId: string): string[] {
    const rows = this.db.query<{ id: string }>(
      'SELECT id FROM node_layout WHERE scope_id = ?',
      [scopeId]
    );
    return rows.map(r => r.id);
  }

  /**
   * Update parent-child relationship
   */
  setParent(
    nodeId: string,
    parentId: string | null,
    offsetX?: number,
    offsetY?: number
  ): void {
    this.db.run(
      `UPDATE node_layout SET parent_id = ?, parent_offset_x = ?, parent_offset_y = ?, position_updated_at = ? WHERE id = ?`,
      [parentId, offsetX ?? null, offsetY ?? null, Date.now(), nodeId]
    );
  }

  /**
   * Compute absolute position for a node with parent offsets
   * Recursively resolves parent chain
   */
  computeAbsolutePosition(nodeId: string): { x: number; y: number } | null {
    const layout = this.getLayout(nodeId);
    if (!layout) return null;

    // If no parent, return stored position
    if (!layout.parent_id) {
      return { x: layout.x, y: layout.y };
    }

    // Recursively get parent position
    const parentPos = this.computeAbsolutePosition(layout.parent_id);
    if (!parentPos) {
      // Parent doesn't exist, use stored position as fallback
      return { x: layout.x, y: layout.y };
    }

    // Compute absolute position from parent + offset
    return {
      x: parentPos.x + (layout.parent_offset_x ?? 0),
      y: parentPos.y + (layout.parent_offset_y ?? 0),
    };
  }
}
