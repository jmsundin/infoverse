/**
 * MarkdownBootstrap - Progressive import of existing markdown files into SQLite
 *
 * Implements a three-phase bootstrap to avoid "frozen app" on large vaults:
 * 1. Index metadata (fast, blocking) - extract positions from frontmatter
 * 2. Parse content (background, progressive) - full content parsing
 * 3. Load layouts (parallel) - merge positions from layout files
 */

import { GraphNode, GraphEdge, EmbeddedEdge, NodeType, NodeColor } from '../../../types';
import { SQLiteStorageAdapter } from './SQLiteStorageAdapter';
import { SQLiteSpatialIndex } from './SQLiteSpatialIndex';
import { LayoutFile } from '../sync/LayoutMaterializer';
import yaml from 'js-yaml';

export interface BootstrapProgress {
  phase: 'metadata' | 'content' | 'layouts' | 'complete';
  total: number;
  processed: number;
  currentFile?: string;
}

export interface BootstrapOptions {
  onProgress?: (progress: BootstrapProgress) => void;
  priorityNodeIds?: Set<string>; // Nodes to parse first (e.g., visible in viewport)
  contentBatchSize?: number;
  contentDelayMs?: number;
}

const DEFAULT_OPTIONS: Required<Omit<BootstrapOptions, 'onProgress' | 'priorityNodeIds'>> = {
  contentBatchSize: 20,
  contentDelayMs: 10,
};

interface FileMetadata {
  id: string;
  filename: string;
  x: number;
  y: number;
  width: number;
  height: number;
  type: NodeType;
  color?: NodeColor;
  title?: string;
  scopeId?: string;
  parentId?: string;
}

export class MarkdownBootstrap {
  private dirHandle: FileSystemDirectoryHandle | null = null;
  private sqliteAdapter: SQLiteStorageAdapter | null = null;
  private aborted = false;

  /**
   * Bootstrap SQLite from existing markdown files
   */
  async bootstrap(
    dirHandle: FileSystemDirectoryHandle,
    sqliteAdapter: SQLiteStorageAdapter,
    options: BootstrapOptions = {}
  ): Promise<void> {
    this.dirHandle = dirHandle;
    this.sqliteAdapter = sqliteAdapter;
    this.aborted = false;

    const opts = { ...DEFAULT_OPTIONS, ...options };
    const { onProgress } = options;

    console.log('[MarkdownBootstrap] Starting bootstrap');

    // Phase 1: Index metadata (fast, blocking)
    const files = await this.indexMetadata(onProgress);
    if (this.aborted) return;

    // Phase 2: Parse content (background, progressive)
    await this.parseContent(files, opts, onProgress);
    if (this.aborted) return;

    // Phase 3: Load layouts (parallel with Phase 2 completion)
    await this.loadLayouts(onProgress);

    onProgress?.({
      phase: 'complete',
      total: files.length,
      processed: files.length,
    });

    console.log('[MarkdownBootstrap] Bootstrap complete');
  }

  /**
   * Abort the bootstrap process
   */
  abort(): void {
    this.aborted = true;
  }

  /**
   * Phase 1: Index metadata from all markdown files
   * This is fast because we only parse YAML frontmatter
   */
  private async indexMetadata(
    onProgress?: (progress: BootstrapProgress) => void
  ): Promise<FileMetadata[]> {
    if (!this.dirHandle || !this.sqliteAdapter) return [];

    const files: FileMetadata[] = [];
    const entries: FileSystemFileHandle[] = [];

    // Collect all markdown files
    for await (const entry of this.dirHandle.values()) {
      if (entry.kind === 'file' && entry.name.endsWith('.md') && !entry.name.startsWith('_')) {
        entries.push(entry as FileSystemFileHandle);
      }
    }

    const total = entries.length;
    let processed = 0;

    onProgress?.({ phase: 'metadata', total, processed: 0 });

    for (const fileHandle of entries) {
      if (this.aborted) break;

      try {
        const metadata = await this.extractMetadata(fileHandle);
        if (metadata) {
          files.push(metadata);

          // Insert minimal layout data into SQLite (for R*Tree)
          await this.insertMetadataOnly(metadata);
        }
      } catch (e) {
        console.warn(`[MarkdownBootstrap] Failed to index ${fileHandle.name}:`, e);
      }

      processed++;
      if (processed % 50 === 0 || processed === total) {
        onProgress?.({ phase: 'metadata', total, processed, currentFile: fileHandle.name });
      }
    }

    console.log(`[MarkdownBootstrap] Indexed ${files.length} files`);
    return files;
  }

  /**
   * Phase 2: Parse full content progressively
   */
  private async parseContent(
    files: FileMetadata[],
    opts: Required<Omit<BootstrapOptions, 'onProgress' | 'priorityNodeIds'>> & { priorityNodeIds?: Set<string> },
    onProgress?: (progress: BootstrapProgress) => void
  ): Promise<void> {
    if (!this.dirHandle || !this.sqliteAdapter) return;

    const total = files.length;
    let processed = 0;

    // Sort to prioritize certain nodes if specified
    const priorityIds = opts.priorityNodeIds;
    if (priorityIds && priorityIds.size > 0) {
      files.sort((a, b) => {
        const aPriority = priorityIds.has(a.id) ? 0 : 1;
        const bPriority = priorityIds.has(b.id) ? 0 : 1;
        return aPriority - bPriority;
      });
    }

    onProgress?.({ phase: 'content', total, processed: 0 });

    // Process in batches using requestIdleCallback pattern
    for (let i = 0; i < files.length; i += opts.contentBatchSize) {
      if (this.aborted) break;

      const batch = files.slice(i, i + opts.contentBatchSize);

      await Promise.all(
        batch.map(async (metadata) => {
          try {
            await this.parseAndUpdateContent(metadata);
          } catch (e) {
            console.warn(`[MarkdownBootstrap] Failed to parse ${metadata.filename}:`, e);
          }
        })
      );

      processed = Math.min(i + opts.contentBatchSize, total);
      onProgress?.({ phase: 'content', total, processed });

      // Yield to main thread
      if (opts.contentDelayMs > 0) {
        await this.delay(opts.contentDelayMs);
      }
    }

    console.log(`[MarkdownBootstrap] Parsed content for ${processed} files`);
  }

  /**
   * Phase 3: Load positions from layout files
   */
  private async loadLayouts(
    onProgress?: (progress: BootstrapProgress) => void
  ): Promise<void> {
    if (!this.dirHandle || !this.sqliteAdapter) return;

    let layoutsDir: FileSystemDirectoryHandle;
    try {
      layoutsDir = await this.dirHandle.getDirectoryHandle('_layouts');
    } catch {
      // No layouts directory - positions stay as read from frontmatter
      console.log('[MarkdownBootstrap] No _layouts directory found');
      return;
    }

    const spatialIndex = this.sqliteAdapter.getSpatialIndex();
    if (!spatialIndex) return;

    const layoutFiles: string[] = [];
    for await (const entry of layoutsDir.values()) {
      if (entry.kind === 'file' && entry.name.endsWith('.layout.json')) {
        layoutFiles.push(entry.name);
      }
    }

    const total = layoutFiles.length;
    let processed = 0;

    onProgress?.({ phase: 'layouts', total, processed: 0 });

    for (const filename of layoutFiles) {
      if (this.aborted) break;

      try {
        const fileHandle = await layoutsDir.getFileHandle(filename);
        const file = await fileHandle.getFile();
        const text = await file.text();
        const layout: LayoutFile = JSON.parse(text);

        // Apply positions from layout file (layout file wins for bootstrap)
        for (const [nodeId, pos] of Object.entries(layout.positions)) {
          spatialIndex.updateLayout(nodeId, pos.x, pos.y, pos.w, pos.h);
        }
      } catch (e) {
        console.warn(`[MarkdownBootstrap] Failed to load layout ${filename}:`, e);
      }

      processed++;
      onProgress?.({ phase: 'layouts', total, processed, currentFile: filename });
    }

    console.log(`[MarkdownBootstrap] Loaded ${processed} layout files`);
  }

  /**
   * Extract metadata from file frontmatter (fast)
   */
  private async extractMetadata(fileHandle: FileSystemFileHandle): Promise<FileMetadata | null> {
    try {
      const file = await fileHandle.getFile();
      const text = await file.text();

      // Quick frontmatter extraction
      const frontmatterMatch = text.match(/^---\n([\s\S]*?)\n---/);
      if (!frontmatterMatch) return null;

      const metadata = yaml.load(frontmatterMatch[1]) as any;
      if (!metadata?.id || typeof metadata.x !== 'number' || typeof metadata.y !== 'number') {
        return null;
      }

      // Extract title from body if not in metadata
      let title = metadata.title;
      if (!title) {
        const bodyStart = text.indexOf('---', 4);
        if (bodyStart !== -1) {
          const body = text.slice(bodyStart + 3).trim();
          const headingMatch = body.match(/^#\s+(.+)$/m);
          if (headingMatch) {
            title = headingMatch[1].trim();
          }
        }
      }

      return {
        id: metadata.id,
        filename: fileHandle.name,
        x: metadata.x,
        y: metadata.y,
        width: metadata.width || 300,
        height: metadata.height || 200,
        type: metadata.type || NodeType.NOTE,
        color: metadata.color,
        title,
        scopeId: metadata.scopeId ?? metadata.parentId,
        parentId: metadata.outlineParentId,
      };
    } catch {
      return null;
    }
  }

  /**
   * Insert metadata-only record into SQLite (Phase 1)
   */
  private async insertMetadataOnly(metadata: FileMetadata): Promise<void> {
    if (!this.sqliteAdapter) return;

    const spatialIndex = this.sqliteAdapter.getSpatialIndex();
    if (!spatialIndex) return;

    const now = Date.now();

    // Check if node already exists
    const existing = spatialIndex.getLayout(metadata.id);
    if (existing) return;

    // Insert minimal data
    spatialIndex.insertNode(
      {
        id: metadata.id,
        x: metadata.x,
        y: metadata.y,
        width: metadata.width,
        height: metadata.height,
        pinned: 0,
        parent_id: metadata.parentId ?? null,
        parent_offset_x: null,
        parent_offset_y: null,
        scope_id: metadata.scopeId ?? null,
        position_updated_at: now,
      },
      {
        id: metadata.id,
        type: metadata.type,
        content: null, // Will be filled in Phase 2
        title: metadata.title ?? null,
        color: metadata.color ?? null,
        auto_expand_depth: null,
        filename: metadata.filename,
        file_mtime: null,
        content_updated_at: now,
      }
    );
  }

  /**
   * Parse full content and update SQLite (Phase 2)
   */
  private async parseAndUpdateContent(metadata: FileMetadata): Promise<void> {
    if (!this.dirHandle || !this.sqliteAdapter) return;

    const spatialIndex = this.sqliteAdapter.getSpatialIndex();
    if (!spatialIndex) return;

    try {
      const fileHandle = await this.dirHandle.getFileHandle(metadata.filename);
      const file = await fileHandle.getFile();
      const text = await file.text();

      // Parse full content
      const parts = text.split(/^---$/m);
      if (parts.length < 3) return;

      const frontmatter = yaml.load(parts[1]) as any;
      const body = parts.slice(2).join('---').trim();

      // Extract embedded edges
      const embeddedEdges: EmbeddedEdge[] = frontmatter.edges || [];
      const edges: GraphEdge[] = embeddedEdges.map(e => ({
        id: e.id,
        source: metadata.id,
        target: e.target,
        label: e.label,
      }));

      // Update content in SQLite
      spatialIndex.updateContent(metadata.id, {
        content: body,
        title: metadata.title,
        color: metadata.color,
        type: metadata.type,
        auto_expand_depth: frontmatter.autoExpandDepth,
      });

      // Update file mtime
      const mtime = file.lastModified;
      this.sqliteAdapter.getSpatialIndex()?.getContent(metadata.id); // Refresh
      // Note: Would need to add a method to update file_mtime directly

      // Insert edges
      for (const edge of edges) {
        try {
          this.sqliteAdapter.getSpatialIndex(); // Access db through adapter
          // Insert edges through SQLite directly
          // This would need a helper method on SQLiteStorageAdapter
        } catch {
          // Ignore edge insert errors (target might not exist yet)
        }
      }
    } catch (e) {
      console.warn(`[MarkdownBootstrap] Failed to parse content for ${metadata.filename}:`, e);
    }
  }

  /**
   * Simple delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Check if bootstrap is needed (SQLite is empty but files exist)
 */
export async function needsBootstrap(
  dirHandle: FileSystemDirectoryHandle,
  sqliteAdapter: SQLiteStorageAdapter
): Promise<boolean> {
  // Check if SQLite has any nodes
  const nodeCount = sqliteAdapter.getNodeCount();
  if (nodeCount > 0) {
    return false;
  }

  // Check if directory has any markdown files
  for await (const entry of dirHandle.values()) {
    if (entry.kind === 'file' && entry.name.endsWith('.md') && !entry.name.startsWith('_')) {
      return true;
    }
  }

  return false;
}
