/**
 * LayoutMaterializer - Materializes node positions to layout files
 *
 * Writes positions to per-scope layout files to avoid rewriting giant maps.
 * Uses debounced writes with faster intervals than content materialization.
 */

import { SQLiteStorageAdapter } from '../sqlite/SQLiteStorageAdapter';
import { SQLiteSpatialIndex, NodeLayoutRow } from '../sqlite/SQLiteSpatialIndex';
import xxhash from 'xxhash-wasm';

export interface LayoutFile {
  version: 1;
  scope_id: string | null;
  positions: Record<string, { x: number; y: number; w: number; h: number }>;
  hash: string;
}

export interface LayoutMaterializerConfig {
  debounceMs?: number;
  flushIntervalMs?: number;
  flushOnHidden?: boolean;
}

const DEFAULT_CONFIG: Required<LayoutMaterializerConfig> = {
  debounceMs: 1000,
  flushIntervalMs: 10000, // Flush at least every 10s if dirty
  flushOnHidden: true,
};

interface DirtyScope {
  scopeId: string | null;
  nodeIds: Set<string>;
  lastUpdate: number;
}

export class LayoutMaterializer {
  private dirHandle: FileSystemDirectoryHandle | null = null;
  private layoutsDir: FileSystemDirectoryHandle | null = null;
  private sqliteAdapter: SQLiteStorageAdapter | null = null;
  private config: Required<LayoutMaterializerConfig>;
  private dirtyScopes: Map<string, DirtyScope> = new Map(); // scopeId -> dirty info
  private debounceTimer: number | null = null;
  private flushIntervalTimer: number | null = null;
  private xxhash: Awaited<ReturnType<typeof xxhash>> | null = null;
  private isLeader = false;

  constructor(config: LayoutMaterializerConfig = {}) {
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

    // Create or get _layouts directory
    try {
      this.layoutsDir = await dirHandle.getDirectoryHandle('_layouts', { create: true });
    } catch (e) {
      console.error('[LayoutMaterializer] Failed to create _layouts directory:', e);
    }

    // Initialize xxhash
    this.xxhash = await xxhash();

    // Set up event handlers
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

    // Start periodic flush timer
    this.flushIntervalTimer = window.setInterval(() => {
      if (this.dirtyScopes.size > 0) {
        this.flush().catch(e => {
          console.error('[LayoutMaterializer] Periodic flush error:', e);
        });
      }
    }, this.config.flushIntervalMs);

    console.log('[LayoutMaterializer] Started as leader');
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

    if (this.flushIntervalTimer) {
      window.clearInterval(this.flushIntervalTimer);
      this.flushIntervalTimer = null;
    }
  }

  /**
   * Mark a node's position as dirty (needs materialization)
   */
  markDirty(nodeId: string, scopeId: string | null): void {
    if (!this.isLeader) return;

    const scopeKey = scopeId ?? '__root__';
    let dirty = this.dirtyScopes.get(scopeKey);

    if (!dirty) {
      dirty = {
        scopeId,
        nodeIds: new Set(),
        lastUpdate: Date.now(),
      };
      this.dirtyScopes.set(scopeKey, dirty);
    }

    dirty.nodeIds.add(nodeId);
    dirty.lastUpdate = Date.now();

    this.scheduleFlush();
  }

  /**
   * Mark multiple nodes' positions as dirty
   */
  markDirtyBatch(updates: Array<{ nodeId: string; scopeId: string | null }>): void {
    if (!this.isLeader) return;

    for (const { nodeId, scopeId } of updates) {
      const scopeKey = scopeId ?? '__root__';
      let dirty = this.dirtyScopes.get(scopeKey);

      if (!dirty) {
        dirty = {
          scopeId,
          nodeIds: new Set(),
          lastUpdate: Date.now(),
        };
        this.dirtyScopes.set(scopeKey, dirty);
      }

      dirty.nodeIds.add(nodeId);
      dirty.lastUpdate = Date.now();
    }

    this.scheduleFlush();
  }

  /**
   * Force immediate flush of all dirty scopes
   */
  async flush(): Promise<void> {
    if (!this.layoutsDir || !this.sqliteAdapter || this.dirtyScopes.size === 0) return;

    // Clear timer
    if (this.debounceTimer) {
      window.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // Get all dirty scopes
    const scopes = Array.from(this.dirtyScopes.values());
    this.dirtyScopes.clear();

    console.log(`[LayoutMaterializer] Flushing ${scopes.length} scope(s)`);

    // Process each scope
    for (const dirty of scopes) {
      try {
        await this.materializeScopeLayout(dirty.scopeId);
      } catch (e) {
        console.error(`[LayoutMaterializer] Failed to materialize scope ${dirty.scopeId}:`, e);
      }
    }
  }

  /**
   * Load layout from file for a scope
   */
  async loadLayout(scopeId: string | null): Promise<LayoutFile | null> {
    if (!this.layoutsDir) return null;

    const filename = this.getScopeFilename(scopeId);

    try {
      const fileHandle = await this.layoutsDir.getFileHandle(filename);
      const file = await fileHandle.getFile();
      const text = await file.text();
      return JSON.parse(text) as LayoutFile;
    } catch {
      return null;
    }
  }

  /**
   * Load all layouts from files
   */
  async loadAllLayouts(): Promise<Map<string | null, LayoutFile>> {
    if (!this.layoutsDir) return new Map();

    const layouts = new Map<string | null, LayoutFile>();

    for await (const entry of this.layoutsDir.values()) {
      if (entry.kind === 'file' && entry.name.endsWith('.layout.json')) {
        try {
          const fileHandle = await this.layoutsDir.getFileHandle(entry.name);
          const file = await fileHandle.getFile();
          const text = await file.text();
          const layout = JSON.parse(text) as LayoutFile;
          layouts.set(layout.scope_id, layout);
        } catch (e) {
          console.warn(`[LayoutMaterializer] Failed to load layout ${entry.name}:`, e);
        }
      }
    }

    return layouts;
  }

  /**
   * Materialize layout for a single scope
   */
  private async materializeScopeLayout(scopeId: string | null): Promise<void> {
    if (!this.layoutsDir || !this.sqliteAdapter) return;

    const spatialIndex = this.sqliteAdapter.getSpatialIndex();
    if (!spatialIndex) return;

    // Get all nodes in this scope
    const nodeIds = scopeId
      ? spatialIndex.getNodesInScope(scopeId)
      : this.getRootNodes(spatialIndex);

    // Build positions map
    const positions: LayoutFile['positions'] = {};

    for (const nodeId of nodeIds) {
      const layout = spatialIndex.getLayout(nodeId);
      if (layout) {
        positions[nodeId] = {
          x: layout.x,
          y: layout.y,
          w: layout.width,
          h: layout.height,
        };
      }
    }

    // Compute hash
    const hash = this.computeHash(JSON.stringify(positions));

    // Build layout file
    const layoutFile: LayoutFile = {
      version: 1,
      scope_id: scopeId,
      positions,
      hash,
    };

    // Write to file
    const filename = this.getScopeFilename(scopeId);
    await this.writeLayoutFile(filename, layoutFile);

    // Update materialized timestamps for all nodes in this scope
    const now = Date.now();
    for (const nodeId of nodeIds) {
      spatialIndex.markLayoutMaterialized(nodeId, hash, now);
    }
  }

  /**
   * Get nodes that don't have a scope (root level nodes)
   */
  private getRootNodes(spatialIndex: SQLiteSpatialIndex): string[] {
    // This is a bit inefficient - ideally we'd have an index for this
    const allIds = spatialIndex.getAllNodeIds();
    const rootIds: string[] = [];

    for (const id of allIds) {
      const layout = spatialIndex.getLayout(id);
      if (layout && !layout.scope_id) {
        rootIds.push(id);
      }
    }

    return rootIds;
  }

  /**
   * Get filename for a scope's layout file
   */
  private getScopeFilename(scopeId: string | null): string {
    if (scopeId === null) {
      return 'root.layout.json';
    }
    return `${scopeId}.layout.json`;
  }

  /**
   * Write layout file with web lock
   */
  private async writeLayoutFile(filename: string, layout: LayoutFile): Promise<void> {
    if (!this.layoutsDir) return;

    const content = JSON.stringify(layout, null, 2);
    const lockName = `infoverse:layout:${filename}`;

    await this.withExclusiveLock(lockName, async () => {
      const fileHandle = await this.layoutsDir!.getFileHandle(filename, { create: true });
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
        console.error('[LayoutMaterializer] Debounce flush error:', e);
      });
    }, this.config.debounceMs);
  }

  private handleVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden' && this.dirtyScopes.size > 0) {
      this.flush().catch(e => {
        console.error('[LayoutMaterializer] Visibility change flush error:', e);
      });
    }
  };

  private handleBeforeUnload = (): void => {
    if (this.dirtyScopes.size > 0) {
      console.warn('[LayoutMaterializer] Unload with dirty layouts');
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
