/**
 * MarkdownWatcher - Watches for external changes to markdown files
 *
 * Detects changes made outside the app (e.g., VS Code, git pull) and
 * updates SQLite accordingly. Uses polling with smart frequency:
 * - Active files: frequently (1s)
 * - Whole workspace: rarely (60-180s) or on focus
 */

import { GraphNode, GraphEdge, EmbeddedEdge, NodeType, NodeColor } from '../../../types';
import { SQLiteStorageAdapter } from '../sqlite/SQLiteStorageAdapter';
import { SQLiteSpatialIndex, NodeContentRow } from '../sqlite/SQLiteSpatialIndex';
import { ConflictResolver, ConflictInfo, ConflictResolution } from './ConflictResolver';
import yaml from 'js-yaml';
import xxhash from 'xxhash-wasm';

export interface FileChange {
  filename: string;
  nodeId: string;
  changeType: 'modified' | 'deleted' | 'created';
  hasConflict: boolean;
}

export interface MarkdownWatcherConfig {
  activeFilePollMs?: number;
  workspacePollMs?: number;
  pollOnFocus?: boolean;
}

const DEFAULT_CONFIG: Required<MarkdownWatcherConfig> = {
  activeFilePollMs: 1000,
  workspacePollMs: 120000, // 2 minutes
  pollOnFocus: true,
};

export class MarkdownWatcher {
  private dirHandle: FileSystemDirectoryHandle | null = null;
  private sqliteAdapter: SQLiteStorageAdapter | null = null;
  private conflictResolver: ConflictResolver | null = null;
  private config: Required<MarkdownWatcherConfig>;
  private xxhash: Awaited<ReturnType<typeof xxhash>> | null = null;
  private isLeader = false;

  // Polling state
  private activeFiles: Set<string> = new Set();
  private activePollTimer: number | null = null;
  private workspacePollTimer: number | null = null;
  private lastWorkspacePoll = 0;

  // File metadata cache (for change detection)
  private fileMtimes: Map<string, number> = new Map();

  // Callbacks
  public onConflict: ((conflict: ConflictInfo) => Promise<ConflictResolution>) | null = null;
  public onFileChange: ((change: FileChange) => void) | null = null;

  constructor(config: MarkdownWatcherConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize with file system handle and SQLite adapter
   */
  async initialize(
    dirHandle: FileSystemDirectoryHandle,
    sqliteAdapter: SQLiteStorageAdapter,
    conflictResolver: ConflictResolver
  ): Promise<void> {
    this.dirHandle = dirHandle;
    this.sqliteAdapter = sqliteAdapter;
    this.conflictResolver = conflictResolver;

    // Initialize xxhash
    this.xxhash = await xxhash();

    // Set up focus handler
    if (this.config.pollOnFocus) {
      window.addEventListener('focus', this.handleFocus);
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
  }

  /**
   * Start watching (only leader tab should call this)
   */
  start(): void {
    this.isLeader = true;

    // Start active file polling (fast)
    this.activePollTimer = window.setInterval(() => {
      this.pollActiveFiles().catch(e => {
        console.error('[MarkdownWatcher] Active poll error:', e);
      });
    }, this.config.activeFilePollMs);

    // Start workspace polling (slow)
    this.workspacePollTimer = window.setInterval(() => {
      this.pollWorkspace().catch(e => {
        console.error('[MarkdownWatcher] Workspace poll error:', e);
      });
    }, this.config.workspacePollMs);

    console.log('[MarkdownWatcher] Started as leader');
  }

  /**
   * Stop watching
   */
  stop(): void {
    this.isLeader = false;

    if (this.activePollTimer) {
      window.clearInterval(this.activePollTimer);
      this.activePollTimer = null;
    }

    if (this.workspacePollTimer) {
      window.clearInterval(this.workspacePollTimer);
      this.workspacePollTimer = null;
    }
  }

  /**
   * Mark a file as "active" (being viewed/edited)
   */
  markActive(filename: string): void {
    this.activeFiles.add(filename);
  }

  /**
   * Mark a file as no longer active
   */
  markInactive(filename: string): void {
    this.activeFiles.delete(filename);
  }

  /**
   * Force an immediate check for changes
   */
  async checkForChanges(): Promise<FileChange[]> {
    return this.pollWorkspace();
  }

  /**
   * Poll active files for changes
   */
  private async pollActiveFiles(): Promise<void> {
    if (!this.dirHandle || this.activeFiles.size === 0) return;

    for (const filename of this.activeFiles) {
      try {
        await this.checkFile(filename);
      } catch (e) {
        // File might have been deleted
        console.debug(`[MarkdownWatcher] Active file check failed: ${filename}`, e);
      }
    }
  }

  /**
   * Poll entire workspace for changes
   */
  private async pollWorkspace(): Promise<FileChange[]> {
    if (!this.dirHandle) return [];

    this.lastWorkspacePoll = Date.now();
    const changes: FileChange[] = [];
    const seenFiles = new Set<string>();

    for await (const entry of this.dirHandle.values()) {
      if (entry.kind === 'file' && entry.name.endsWith('.md') && !entry.name.startsWith('_')) {
        seenFiles.add(entry.name);

        try {
          const change = await this.checkFile(entry.name);
          if (change) {
            changes.push(change);
          }
        } catch (e) {
          console.warn(`[MarkdownWatcher] Failed to check ${entry.name}:`, e);
        }
      }
    }

    // Check for deleted files
    for (const [filename] of this.fileMtimes) {
      if (!seenFiles.has(filename)) {
        this.fileMtimes.delete(filename);
        // Note: We don't auto-delete from SQLite - that requires explicit user action
      }
    }

    return changes;
  }

  /**
   * Check a single file for changes
   */
  private async checkFile(filename: string): Promise<FileChange | null> {
    if (!this.dirHandle || !this.sqliteAdapter) return null;

    try {
      const fileHandle = await this.dirHandle.getFileHandle(filename);
      const file = await fileHandle.getFile();
      const mtime = file.lastModified;

      // Check if mtime changed
      const lastMtime = this.fileMtimes.get(filename);
      if (lastMtime === mtime) {
        return null; // No change
      }

      this.fileMtimes.set(filename, mtime);

      // If this is the first time seeing this file, it might be new or we're bootstrapping
      if (lastMtime === undefined) {
        // Check if we have this node in SQLite
        const parsed = await this.parseFile(file);
        if (!parsed) return null;

        const existingNode = await this.sqliteAdapter.loadNode(parsed.node.id);
        if (!existingNode) {
          // New file - import it
          await this.importFile(parsed.node, parsed.edges, filename);
          return { filename, nodeId: parsed.node.id, changeType: 'created', hasConflict: false };
        }

        return null; // Already known, just caching mtime
      }

      // File was modified - parse and check for conflict
      const parsed = await this.parseFile(file);
      if (!parsed) return null;

      const change = await this.handleFileModification(filename, parsed.node, parsed.edges);
      return change;
    } catch {
      return null;
    }
  }

  /**
   * Handle a file modification
   */
  private async handleFileModification(
    filename: string,
    fileNode: GraphNode,
    fileEdges: GraphEdge[]
  ): Promise<FileChange | null> {
    if (!this.sqliteAdapter || !this.conflictResolver) return null;

    const existingNode = await this.sqliteAdapter.loadNode(fileNode.id);
    if (!existingNode) {
      // Node doesn't exist in SQLite - import it
      await this.importFile(fileNode, fileEdges, filename);
      return { filename, nodeId: fileNode.id, changeType: 'created', hasConflict: false };
    }

    // Check for conflict
    const spatialIndex = this.sqliteAdapter.getSpatialIndex();
    if (!spatialIndex) return null;

    const content = spatialIndex.getContent(fileNode.id);
    if (!content) return null;

    // Compute file content hash
    const fileContentHash = this.computeHash(fileNode.content ?? '');

    // Check if there's a conflict
    const hasConflict = this.conflictResolver.detectConflict(
      content.content_updated_at,
      content.content_materialized_at ?? 0,
      content.content_hash ?? '',
      fileContentHash
    );

    if (hasConflict) {
      // Build conflict info
      const conflictInfo: ConflictInfo = {
        nodeId: fileNode.id,
        filename,
        localNode: existingNode,
        localUpdatedAt: content.content_updated_at,
        localHash: content.content_hash ?? '',
        fileNode,
        fileHash: fileContentHash,
        conflictType: 'content',
      };

      // Call conflict handler
      if (this.onConflict) {
        const resolution = await this.onConflict(conflictInfo);
        await this.applyResolution(conflictInfo, resolution);
      } else {
        // Default: file wins
        await this.applyFileChanges(fileNode, fileEdges, filename);
      }

      return { filename, nodeId: fileNode.id, changeType: 'modified', hasConflict: true };
    }

    // No conflict - apply file changes
    await this.applyFileChanges(fileNode, fileEdges, filename);
    return { filename, nodeId: fileNode.id, changeType: 'modified', hasConflict: false };
  }

  /**
   * Import a new file into SQLite
   */
  private async importFile(node: GraphNode, edges: GraphEdge[], filename: string): Promise<void> {
    if (!this.sqliteAdapter) return;

    await this.sqliteAdapter.saveNode(node, edges);
    this.onFileChange?.({ filename, nodeId: node.id, changeType: 'created', hasConflict: false });
  }

  /**
   * Apply file changes to SQLite (no conflict)
   */
  private async applyFileChanges(
    node: GraphNode,
    edges: GraphEdge[],
    filename: string
  ): Promise<void> {
    if (!this.sqliteAdapter) return;

    const spatialIndex = this.sqliteAdapter.getSpatialIndex();
    if (!spatialIndex) return;

    // Update content
    const contentHash = this.computeHash(node.content ?? '');
    spatialIndex.updateContent(node.id, {
      content: node.content,
      title: node.title,
      color: node.color,
      type: node.type,
    });

    // Mark as materialized (since it came from file, it's already "materialized")
    spatialIndex.markContentMaterialized(node.id, contentHash);

    this.onFileChange?.({ filename, nodeId: node.id, changeType: 'modified', hasConflict: false });
  }

  /**
   * Apply conflict resolution
   */
  private async applyResolution(
    conflict: ConflictInfo,
    resolution: ConflictResolution
  ): Promise<void> {
    if (!this.sqliteAdapter) return;

    if (resolution === 'file') {
      await this.applyFileChanges(conflict.fileNode, [], conflict.filename);
    } else if (resolution === 'local') {
      // Keep local - mark as needing materialization
      const spatialIndex = this.sqliteAdapter.getSpatialIndex();
      if (spatialIndex) {
        // Clear materialized timestamp to force re-write
        spatialIndex.markContentMaterialized(conflict.nodeId, '', 0);
      }
    } else if (resolution === 'merge' && this.conflictResolver) {
      // Merge content
      const merged = this.conflictResolver.mergeContent(
        conflict.localNode.content ?? '',
        conflict.fileNode.content ?? ''
      );
      conflict.localNode.content = merged;
      await this.sqliteAdapter.saveNode(conflict.localNode);
    }
  }

  /**
   * Parse a markdown file into node and edges
   */
  private async parseFile(
    file: File
  ): Promise<{ node: GraphNode; edges: GraphEdge[] } | null> {
    try {
      const text = await file.text();
      const parts = text.split(/^---$/m);
      if (parts.length < 3) return null;

      const metadata = yaml.load(parts[1]) as any;
      const body = parts.slice(2).join('---').trim();

      if (!metadata?.id) return null;

      // Extract embedded edges
      const embeddedEdges: EmbeddedEdge[] = metadata.edges || [];
      const edges: GraphEdge[] = embeddedEdges.map(e => ({
        id: e.id,
        source: metadata.id,
        target: e.target,
        label: e.label,
      }));

      // Extract title from body
      let title: string | undefined;
      const headingMatch = body.match(/^#\s+(.+)$/m);
      if (headingMatch) {
        title = headingMatch[1].trim();
      }

      const node: GraphNode = {
        id: metadata.id,
        type: metadata.type || NodeType.NOTE,
        x: metadata.x ?? 0,
        y: metadata.y ?? 0,
        width: metadata.width,
        height: metadata.height,
        content: body,
        title,
        color: metadata.color,
        pinned: metadata.pinned,
        scopeId: metadata.scopeId ?? metadata.parentId, // Migration
        parentId: metadata.outlineParentId ?? (metadata.parentId !== undefined && metadata.scopeId !== undefined ? metadata.parentId : undefined),
        autoExpandDepth: metadata.autoExpandDepth,
      };

      return { node, edges };
    } catch (e) {
      console.error('[MarkdownWatcher] Failed to parse file:', e);
      return null;
    }
  }

  /**
   * Compute xxhash of content
   */
  private computeHash(content: string): string {
    if (!this.xxhash) return '';
    const hash = this.xxhash.h64(content);
    return hash.toString(16);
  }

  // --- Event handlers ---

  private handleFocus = (): void => {
    // Poll workspace on focus if enough time has passed
    const elapsed = Date.now() - this.lastWorkspacePoll;
    if (elapsed > 30000) {
      // 30 seconds since last poll
      this.pollWorkspace().catch(e => {
        console.error('[MarkdownWatcher] Focus poll error:', e);
      });
    }
  };

  private handleVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') {
      this.handleFocus();
    }
  };

  /**
   * Clean up event listeners
   */
  destroy(): void {
    this.stop();
    window.removeEventListener('focus', this.handleFocus);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
  }
}
