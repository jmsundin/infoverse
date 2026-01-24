/**
 * MarkdownMaterializer - Materializes database state to markdown files
 *
 * Debounced to avoid excessive file writes during rapid edits.
 * Content writes are separate from layout writes (positions go to layout files).
 */

import { GraphNode, GraphEdge, EmbeddedEdge, NodeType } from '../../../types';
import { SQLiteStorageAdapter } from '../sqlite/SQLiteStorageAdapter';
import { SQLiteSpatialIndex, NodeContentRow } from '../sqlite/SQLiteSpatialIndex';
import yaml from 'js-yaml';
import xxhash from 'xxhash-wasm';

export interface MarkdownMaterializerConfig {
  debounceMs?: number;
  flushOnHidden?: boolean;
}

const DEFAULT_CONFIG: Required<MarkdownMaterializerConfig> = {
  debounceMs: 2000,
  flushOnHidden: true,
};

interface QueuedWrite {
  nodeId: string;
  queuedAt: number;
}

export class MarkdownMaterializer {
  private dirHandle: FileSystemDirectoryHandle | null = null;
  private sqliteAdapter: SQLiteStorageAdapter | null = null;
  private config: Required<MarkdownMaterializerConfig>;
  private writeQueue: Map<string, QueuedWrite> = new Map();
  private debounceTimer: number | null = null;
  private xxhash: Awaited<ReturnType<typeof xxhash>> | null = null;
  private isLeader = false;

  constructor(config: MarkdownMaterializerConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize with file system handle and SQLite adapter
   */
  async initialize(
    dirHandle: FileSystemDirectoryHandle,
    sqliteAdapter: SQLiteStorageAdapter
  ): Promise<void> {
    this.dirHandle = dirHandle;
    this.sqliteAdapter = sqliteAdapter;

    // Initialize xxhash
    this.xxhash = await xxhash();

    // Set up visibility change handler
    if (this.config.flushOnHidden) {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
      window.addEventListener('beforeunload', this.handleBeforeUnload);
    }
  }

  /**
   * Start the materializer (only leader tab should call this)
   */
  start(): void {
    this.isLeader = true;
    console.log('[MarkdownMaterializer] Started as leader');
  }

  /**
   * Stop the materializer
   */
  stop(): void {
    this.isLeader = false;
    if (this.debounceTimer) {
      window.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  /**
   * Queue a node for materialization
   */
  queueMaterialization(nodeId: string): void {
    if (!this.isLeader) return;

    this.writeQueue.set(nodeId, {
      nodeId,
      queuedAt: Date.now(),
    });

    this.scheduleFlush();
  }

  /**
   * Force immediate flush of all queued writes
   */
  async flush(): Promise<void> {
    if (!this.dirHandle || !this.sqliteAdapter || this.writeQueue.size === 0) return;

    // Clear timer
    if (this.debounceTimer) {
      window.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // Get all queued node IDs
    const nodeIds = Array.from(this.writeQueue.keys());
    this.writeQueue.clear();

    console.log(`[MarkdownMaterializer] Flushing ${nodeIds.length} nodes`);

    // Process each node
    for (const nodeId of nodeIds) {
      try {
        await this.materializeNode(nodeId);
      } catch (e) {
        console.error(`[MarkdownMaterializer] Failed to materialize node ${nodeId}:`, e);
      }
    }
  }

  /**
   * Materialize a single node to markdown
   */
  private async materializeNode(nodeId: string): Promise<void> {
    if (!this.dirHandle || !this.sqliteAdapter) return;

    const node = await this.sqliteAdapter.loadNode(nodeId);
    if (!node) return;

    // Get edges for this node
    const edges = await this.sqliteAdapter.loadEdgesForNodes(new Set([nodeId]));

    // Generate filename from title
    const filename = this.generateFilename(node);

    // Build markdown content
    const markdown = this.buildMarkdown(node, edges);

    // Compute content hash
    const hash = this.computeHash(markdown);

    // Write to file
    await this.writeFile(filename, markdown);

    // Update content hash and materialized timestamp in SQLite
    const spatialIndex = this.sqliteAdapter.getSpatialIndex();
    if (spatialIndex) {
      spatialIndex.markContentMaterialized(nodeId, hash);
    }

    // Update filename if changed
    const currentMetadata = this.sqliteAdapter.getExtendedMetadata(nodeId);
    if (currentMetadata && currentMetadata.filename !== filename) {
      // Delete old file if filename changed
      try {
        await this.dirHandle.removeEntry(currentMetadata.filename);
      } catch {
        // Old file might not exist
      }

      // Update filename in SQLite
      spatialIndex?.updateContent(nodeId, { filename });
    }
  }

  /**
   * Build markdown content from node
   */
  private buildMarkdown(node: GraphNode, edges: GraphEdge[]): string {
    // Build frontmatter with only persisted fields
    const metadata: Record<string, any> = {
      id: node.id,
      type: node.type,
    };

    // Note: positions are NOT in frontmatter - they go to layout files
    // But we keep them for backwards compatibility with existing files
    // The authoritative positions are in SQLite / layout files
    metadata.x = node.x;
    metadata.y = node.y;
    if (node.width !== undefined) metadata.width = node.width;
    if (node.height !== undefined) metadata.height = node.height;

    // Other optional fields
    if (node.color !== undefined) metadata.color = node.color;
    if (node.pinned !== undefined) metadata.pinned = node.pinned;
    if (node.scopeId !== undefined) metadata.scopeId = node.scopeId;
    if (node.parentId !== undefined) metadata.parentId = node.parentId;
    if (node.autoExpandDepth !== undefined) metadata.autoExpandDepth = node.autoExpandDepth;

    // Convert edges to embedded format
    if (edges.length > 0) {
      metadata.edges = edges.map(e => ({
        id: e.id,
        target: e.target,
        label: e.label,
      }));
    }

    const frontmatter = yaml.dump(metadata);
    const body = node.content || '';

    return `---\n${frontmatter}---\n\n${body}`;
  }

  /**
   * Write content to a file with web lock
   */
  private async writeFile(filename: string, content: string): Promise<void> {
    if (!this.dirHandle) return;

    const lockName = `infoverse:fswrite:${this.dirHandle.name}:${filename}`;

    await this.withExclusiveLock(lockName, async () => {
      const fileHandle = await this.dirHandle!.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      try {
        await writable.write(content);
        await writable.close();
      } catch (e) {
        await writable.abort().catch(() => {});
        throw e;
      }
    });
  }

  /**
   * Generate filename from node title
   */
  private generateFilename(node: GraphNode): string {
    const title = node.title || node.content?.split('\n')[0]?.replace(/^#\s*/, '') || 'Untitled';
    const sanitized = title
      .replace(/[^a-zA-Z0-9\s\-_]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
    return `${sanitized || 'Untitled'}.md`;
  }

  /**
   * Compute xxhash of content
   */
  private computeHash(content: string): string {
    if (!this.xxhash) return '';
    const hash = this.xxhash.h64(content);
    return hash.toString(16);
  }

  // --- Private helpers ---

  private scheduleFlush(): void {
    if (this.debounceTimer) return;

    this.debounceTimer = window.setTimeout(() => {
      this.debounceTimer = null;
      this.flush().catch(e => {
        console.error('[MarkdownMaterializer] Flush error:', e);
      });
    }, this.config.debounceMs);
  }

  private handleVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden' && this.writeQueue.size > 0) {
      this.flush().catch(e => {
        console.error('[MarkdownMaterializer] Visibility change flush error:', e);
      });
    }
  };

  private handleBeforeUnload = (): void => {
    // Best effort flush on unload
    if (this.writeQueue.size > 0) {
      console.warn('[MarkdownMaterializer] Unload with pending writes');
      // Can't do async here, but at least log it
    }
  };

  private async withExclusiveLock<T>(lockName: string, fn: () => Promise<T>): Promise<T> {
    const nav = navigator as any;
    if (nav.locks && typeof nav.locks.request === 'function') {
      return nav.locks.request(lockName, { mode: 'exclusive' }, fn);
    }
    return fn();
  }

  /**
   * Clean up event listeners
   */
  destroy(): void {
    this.stop();
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    window.removeEventListener('beforeunload', this.handleBeforeUnload);
  }
}
