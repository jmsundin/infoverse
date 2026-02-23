import { GraphNode, GraphEdge, NodeType } from '../../../types';
import { ViewportBounds, NodePositionIndex, SpatialIndexEntry, LocalStorageAdapterInterface, DeletedNodeEntry } from '../types';
import { DeletionStackService } from '../DeletionStackService';
import { NodeArchiveService } from '../NodeArchiveService';
import * as d3 from 'd3';
import { parseNodeMarkdown, serializeNodeMarkdown } from '../markdown';
import { composeChatContentFromMessages } from '../../../utils/nodeContentUtils';

/**
 * LocalStorageAdapter provides viewport-based access to local file system storage.
 * Uses the File System Access API to read/write markdown files with YAML frontmatter.
 *
 * Key features:
 * - Builds a spatial index on directory open (position metadata only)
 * - Loads full node content only for visible viewport
 * - Debounced saves with web lock for concurrent safety
 */
export class LocalStorageAdapter implements LocalStorageAdapterInterface {
  private dirHandle: FileSystemDirectoryHandle | null = null;
  private nodeIndex: Map<string, NodePositionIndex> = new Map();
  private extendedIndex: Map<string, SpatialIndexEntry> = new Map(); // Extended index with metadata
  private quadtree: d3.Quadtree<NodePositionIndex> | null = null;
  private fileIndex: Map<string, string> = new Map(); // nodeId -> filename
  private initialized = false;

  // Debounce tracking
  private saveTimers: Map<string, number> = new Map();
  private saveDebounceMs: number = 500;

  // Deletion stack for soft delete
  private deletionStackService: DeletionStackService = new DeletionStackService();

  // Archive service for preserving deleted content
  private nodeArchiveService: NodeArchiveService = new NodeArchiveService();

  constructor(saveDebounceMs: number = 500) {
    this.saveDebounceMs = saveDebounceMs;
  }

  /**
   * Initialize with a directory handle and build spatial index
   */
  async initialize(dirHandle?: FileSystemDirectoryHandle): Promise<void> {
    if (!dirHandle) {
      this.initialized = false;
      return;
    }

    this.dirHandle = dirHandle;
    await this.buildSpatialIndex();
    await this.deletionStackService.initialize(dirHandle);
    await this.nodeArchiveService.initialize(dirHandle);
    this.initialized = true;
  }

  isEnabled(): boolean {
    return this.initialized && this.dirHandle !== null;
  }

  /**
   * Scan all markdown files and build spatial index from frontmatter only
   * This is fast because we only parse YAML metadata, not full content
   */
  private async buildSpatialIndex(): Promise<void> {
    if (!this.dirHandle) return;

    this.nodeIndex.clear();
    this.extendedIndex.clear();
    this.fileIndex.clear();

    for await (const entry of this.dirHandle.values()) {
      if (entry.kind === 'file' && entry.name.endsWith('.md') && !entry.name.startsWith('_')) {
        try {
          const extendedInfo = await this.extractMetadataFromFile(entry as FileSystemFileHandle);
          if (extendedInfo) {
            extendedInfo.filename = entry.name;
            // Store in both indexes
            this.extendedIndex.set(extendedInfo.id, extendedInfo);
            this.nodeIndex.set(extendedInfo.id, {
              id: extendedInfo.id,
              x: extendedInfo.x,
              y: extendedInfo.y,
              width: extendedInfo.width,
              height: extendedInfo.height,
              filename: extendedInfo.filename,
            });
            this.fileIndex.set(extendedInfo.id, entry.name);
          }
        } catch (e) {
          console.warn(`Failed to index ${entry.name}:`, e);
        }
      }
    }

    // Build quadtree for fast spatial queries
    this.rebuildQuadtree();
  }

  /**
   * Rebuild the quadtree from current index
   */
  private rebuildQuadtree(): void {
    const nodes = Array.from(this.nodeIndex.values());
    this.quadtree = d3
      .quadtree<NodePositionIndex>()
      .x((d) => d.x)
      .y((d) => d.y)
      .addAll(nodes);
  }

  /**
   * Extract metadata from a file's frontmatter for spatial indexing (fast)
   * Includes position + additional fields for skeleton rendering
   */
  private async extractMetadataFromFile(
    fileHandle: FileSystemFileHandle
  ): Promise<SpatialIndexEntry | null> {
    try {
      const file = await fileHandle.getFile();
      const text = await file.text();
      const parsed = parseNodeMarkdown(text);
      if (!parsed) return null;
      const { node } = parsed;

      return {
        id: node.id,
        x: node.x,
        y: node.y,
        width: node.width || 300,
        height: node.height || 200,
        filename: fileHandle.name,
        // Extended fields for skeleton rendering
        type: node.type,
        color: node.color,
        title: node.title,
        scopeId: node.scopeId ?? undefined,
      };
    } catch {
      return null;
    }
  }

  /**
   * Load nodes within viewport bounds using spatial index
   */
  async loadNodesInBounds(bounds: ViewportBounds): Promise<GraphNode[]> {
    if (!this.dirHandle || !this.quadtree) return [];

    // Find nodes in bounds using quadtree
    const nodesInBounds: NodePositionIndex[] = [];

    this.quadtree.visit((node, x1, y1, x2, y2) => {
      // Check if quadrant intersects bounds
      if (x1 > bounds.maxX || y1 > bounds.maxY || x2 < bounds.minX || y2 < bounds.minY) {
        return true; // Skip this quadrant
      }

      if (!node.length) {
        // Leaf node - check each point
        let current: any = node;
        do {
          const d = current.data;
          const nodeRight = d.x + d.width;
          const nodeBottom = d.y + d.height;

          // Check if node intersects bounds
          if (
            d.x < bounds.maxX &&
            nodeRight > bounds.minX &&
            d.y < bounds.maxY &&
            nodeBottom > bounds.minY
          ) {
            nodesInBounds.push(d);
          }
        } while ((current = current.next));
      }

      return false; // Continue visiting
    });

    // Load full content for nodes in bounds
    const nodes = await Promise.all(
      nodesInBounds.map((posInfo) => this.loadNodeByFilename(posInfo.filename))
    );

    return nodes.filter((n): n is GraphNode => n !== null);
  }

  /**
   * Load a single node by its ID
   */
  async loadNode(nodeId: string): Promise<GraphNode | null> {
    const filename = this.fileIndex.get(nodeId);
    if (!filename) return null;
    return this.loadNodeByFilename(filename);
  }

  /**
   * Load a node from a specific file
   */
  private async loadNodeByFilename(filename: string): Promise<GraphNode | null> {
    if (!this.dirHandle) return null;

    try {
      const fileHandle = await this.dirHandle.getFileHandle(filename);
      const result = await this.parseMarkdownNode(fileHandle);
      return result?.node ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Load all edges from all nodes (needed for edge rendering)
   */
  async loadAllEdges(): Promise<GraphEdge[]> {
    if (!this.dirHandle) return [];

    const allEdges: GraphEdge[] = [];

    for await (const entry of this.dirHandle.values()) {
      if (entry.kind === 'file' && entry.name.endsWith('.md') && !entry.name.startsWith('_')) {
        try {
          const result = await this.parseMarkdownNode(entry as FileSystemFileHandle);
          if (result) {
            allEdges.push(...result.edges);
          }
        } catch {
          // Skip files that can't be read
        }
      }
    }

    return allEdges;
  }

  /**
   * Load edges for specific source nodes
   */
  async loadEdgesForNodes(nodeIds: Set<string>): Promise<GraphEdge[]> {
    if (!this.dirHandle) return [];

    const edges: GraphEdge[] = [];

    for (const nodeId of nodeIds) {
      const filename = this.fileIndex.get(nodeId);
      if (!filename) continue;

      try {
        const fileHandle = await this.dirHandle.getFileHandle(filename);
        const result = await this.parseMarkdownNode(fileHandle);
        if (result) {
          edges.push(...result.edges);
        }
      } catch {
        // Skip files that can't be read
      }
    }

    return edges;
  }

  /**
   * Parse a markdown file and extract node + edges
   */
  private async parseMarkdownNode(
    fileHandle: FileSystemFileHandle
  ): Promise<{ node: GraphNode; edges: GraphEdge[] } | null> {
    try {
      const file = await fileHandle.getFile();
      const text = await file.text();
      const parsed = parseNodeMarkdown(text);
      if (!parsed) return null;

      return {
        node: parsed.node,
        edges: parsed.edges,
      };
    } catch (e: any) {
      console.error('Error parsing file:', fileHandle.name, e);
      return null;
    }
  }

  /**
   * Save a node (debounced)
   */
  saveNode(node: GraphNode, edges: GraphEdge[] = []): Promise<void> {
    return new Promise((resolve) => {
      // Clear any pending save for this node
      if (this.saveTimers.has(node.id)) {
        window.clearTimeout(this.saveTimers.get(node.id));
      }

      // Schedule a new save
      const timerId = window.setTimeout(async () => {
        this.saveTimers.delete(node.id);
        await this.saveNodeImmediate(node, edges);
        resolve();
      }, this.saveDebounceMs);

      this.saveTimers.set(node.id, timerId);
    });
  }

  /**
   * Save a node immediately (no debounce)
   */
  async saveNodeImmediate(node: GraphNode, outgoingEdges: GraphEdge[] = []): Promise<void> {
    if (!this.dirHandle) return;

    const hasPerm = await this.verifyPermission(this.dirHandle, true);
    if (!hasPerm) return;

    // Find current file for this node
    const currentFilename = this.fileIndex.get(node.id) || null;

    // Determine new filename
    const newFileName = await this.getAvailableFilename(node, currentFilename);
    const lockName = `infoverse:fswrite:${this.dirHandle.name}:${newFileName}`;

    // If filename changed, delete old file first
    if (currentFilename && currentFilename !== newFileName) {
      try {
        await this.dirHandle.removeEntry(currentFilename);
      } catch {
        // Ignore if old file doesn't exist
      }
    }

    await this.withExclusiveWebLock(lockName, async () => {
      let writable: any = null;
      try {
        const fileHandle = await this.dirHandle!.getFileHandle(newFileName, { create: true });
        writable = await fileHandle.createWritable();

        // For CHAT nodes with messages, compose canonical body from transcript.
        let body = node.content || '';
        if (node.type === NodeType.CHAT && node.messages && node.messages.length > 0) {
          body = composeChatContentFromMessages(
            body,
            node.messages.map((m) => ({ role: m.role, text: m.text }))
          );
        }
        const fileContent = serializeNodeMarkdown({
          node: { ...node, content: body },
          edges: outgoingEdges,
        });

        await writable.write(fileContent);
        await writable.close();
        writable = null;

        // Update indices
        this.fileIndex.set(node.id, newFileName);
        this.nodeIndex.set(node.id, {
          id: node.id,
          x: node.x,
          y: node.y,
          width: node.width || 300,
          height: node.height || 200,
          filename: newFileName,
        });
        // Update extended index with full metadata
        this.extendedIndex.set(node.id, {
          id: node.id,
          x: node.x,
          y: node.y,
          width: node.width || 300,
          height: node.height || 200,
          filename: newFileName,
          type: node.type,
          color: node.color,
          title: parseNodeMarkdown(fileContent)?.node.title || node.title || node.content?.substring(0, 100),
          scopeId: node.scopeId,
        });
        this.rebuildQuadtree();
      } catch (e: any) {
        await this.safeCloseOrAbortWritable(writable, e);
        throw e;
      }
    });
  }

  /**
   * Soft delete a node - moves it to the deletion stack instead of permanently removing
   */
  async deleteNode(nodeId: string): Promise<void> {
    if (!this.dirHandle) return;

    const hasPerm = await this.verifyPermission(this.dirHandle, true);
    if (!hasPerm) {
      console.warn('[LocalStorageAdapter] No write permission to delete node:', nodeId);
      return;
    }

    const filename = this.fileIndex.get(nodeId);
    if (filename) {
      let rawMarkdownContent = '';
      let title = 'Untitled';

      // Step 1: Try to read file content for archiving (best effort)
      try {
        const fileHandle = await this.dirHandle.getFileHandle(filename);
        const file = await fileHandle.getFile();
        rawMarkdownContent = await file.text();

        const result = await this.parseMarkdownNode(fileHandle);
        if (result) {
          title = result.node.title || result.node.content?.substring(0, 50) || 'Untitled';

          // Convert embedded edges to GraphEdge format
          const edges: GraphEdge[] = result.edges.map((e) => ({
            id: e.id,
            source: nodeId,
            target: e.target,
            label: e.label,
          }));

          // Push to deletion stack for Ctrl+Z restore
          await this.deletionStackService.pushDeletion(result.node, edges);
        }
      } catch (e) {
        console.warn('[LocalStorageAdapter] Failed to read node for archiving:', nodeId, e);
      }

      // Step 2: Try to archive (best effort - don't block deletion)
      if (rawMarkdownContent) {
        try {
          await this.nodeArchiveService.archiveNode(filename, title, rawMarkdownContent);
        } catch (e) {
          console.warn('[LocalStorageAdapter] Failed to archive node:', nodeId, e);
        }
      }

      // Step 3: ALWAYS attempt to delete the file
      try {
        await this.dirHandle.removeEntry(filename);
      } catch (e) {
        console.error('[LocalStorageAdapter] Failed to delete file:', filename, e);
      }
    }

    // Update indices
    this.fileIndex.delete(nodeId);
    this.nodeIndex.delete(nodeId);
    this.extendedIndex.delete(nodeId);
    this.rebuildQuadtree();
  }

  /**
   * Restore the most recently deleted node from the deletion stack
   * Returns the restored node and its edges, or null if stack is empty
   */
  async restoreNode(): Promise<DeletedNodeEntry | null> {
    if (!this.dirHandle) return null;

    const hasPerm = await this.verifyPermission(this.dirHandle, true);
    if (!hasPerm) return null;

    const entry = await this.deletionStackService.popDeletion();
    if (!entry) return null;

    // Convert edges back to embedded format for saving
    const outgoingEdges: GraphEdge[] = entry.edges;

    // Save the node back to a file
    await this.saveNodeImmediate(entry.node, outgoingEdges);

    return entry;
  }

  /**
   * Get the number of deleted nodes that can be restored
   */
  getDeletionStackSize(): number {
    return this.deletionStackService.getStackSize();
  }

  /**
   * Prune old entries from the deletion stack
   * @param maxAgeMs Maximum age in milliseconds (default 30 days)
   * @returns Number of entries pruned
   */
  async pruneDeletionStack(maxAgeMs?: number): Promise<number> {
    return this.deletionStackService.pruneOldEntries(maxAgeMs);
  }

  /**
   * Prune old entries from the node archive
   * @param maxAgeMs Maximum age in milliseconds (default 30 days)
   * @returns Number of entries pruned
   */
  async pruneNodeArchive(maxAgeMs?: number): Promise<number> {
    return this.nodeArchiveService.pruneOldEntries(maxAgeMs);
  }

  /**
   * Flush all pending saves immediately
   */
  async flush(): Promise<void> {
    // Wait for all pending saves to complete
    const pendingIds = Array.from(this.saveTimers.keys());
    for (const timerId of this.saveTimers.values()) {
      window.clearTimeout(timerId);
    }
    this.saveTimers.clear();
    // Note: The actual save operations should have been triggered already
  }

  /**
   * Get all node IDs in the index
   */
  getAllNodeIds(): string[] {
    return Array.from(this.nodeIndex.keys());
  }

  /**
   * Get the full spatial index with extended metadata (for two-phase loading)
   */
  getAllSpatialIndex(): SpatialIndexEntry[] {
    return Array.from(this.extendedIndex.values());
  }

  /**
   * Get node position info from index (fast, no file read)
   */
  getNodePosition(nodeId: string): NodePositionIndex | undefined {
    return this.nodeIndex.get(nodeId);
  }

  /**
   * Get extended metadata for a node (fast, no file read)
   */
  getExtendedMetadata(nodeId: string): SpatialIndexEntry | undefined {
    return this.extendedIndex.get(nodeId);
  }

  /**
   * Get all node positions in bounds (fast, from index)
   */
  getNodePositionsInBounds(bounds: ViewportBounds): NodePositionIndex[] {
    if (!this.quadtree) return [];

    const positions: NodePositionIndex[] = [];

    this.quadtree.visit((node, x1, y1, x2, y2) => {
      if (x1 > bounds.maxX || y1 > bounds.maxY || x2 < bounds.minX || y2 < bounds.minY) {
        return true;
      }

      if (!node.length) {
        let current: any = node;
        do {
          const d = current.data;
          const nodeRight = d.x + d.width;
          const nodeBottom = d.y + d.height;

          if (
            d.x < bounds.maxX &&
            nodeRight > bounds.minX &&
            d.y < bounds.maxY &&
            nodeBottom > bounds.minY
          ) {
            positions.push(d);
          }
        } while ((current = current.next));
      }

      return false;
    });

    return positions;
  }

  /**
   * Update node position in index (without saving to file)
   */
  updateNodePositionInIndex(nodeId: string, x: number, y: number, width?: number, height?: number): void {
    const existing = this.nodeIndex.get(nodeId);
    if (existing) {
      existing.x = x;
      existing.y = y;
      if (width !== undefined) existing.width = width;
      if (height !== undefined) existing.height = height;
      this.rebuildQuadtree();
    }
  }

  // --- Helper methods ---

  private async verifyPermission(
    fileHandle: FileSystemHandle,
    readWrite: boolean = false
  ): Promise<boolean> {
    const options: FileSystemHandlePermissionDescriptor = {
      mode: readWrite ? 'readwrite' : 'read',
    };
    if ((await fileHandle.queryPermission(options)) === 'granted') {
      return true;
    }
    if ((await fileHandle.requestPermission(options)) === 'granted') {
      return true;
    }
    return false;
  }

  private async withExclusiveWebLock<T>(lockName: string, work: () => Promise<T>): Promise<T> {
    const navigatorWithLocks = navigator as any;
    const locks = navigatorWithLocks?.locks;
    if (locks && typeof locks.request === 'function') {
      return locks.request(lockName, { mode: 'exclusive' }, work);
    }
    return work();
  }

  private async safeCloseOrAbortWritable(writable: any, error?: any): Promise<void> {
    if (!writable) return;
    if (error && typeof writable.abort === 'function') {
      try {
        await writable.abort();
        return;
      } catch {
        // fall through to close
      }
    }
    if (typeof writable.close === 'function') {
      try {
        await writable.close();
      } catch {
        // ignore
      }
    }
  }

  private sanitizeFilename(title: string): string | null {
    if (!title || !title.trim()) return null;
    const sanitized = title
      .replace(/[^a-zA-Z0-9\s\-_]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
    return sanitized || null;
  }

  private extractTitleFromContent(content: string): string {
    if (!content) return '';
    // Look for first # heading
    const headingMatch = content.match(/^#\s+(.+)$/m);
    if (headingMatch) {
      return headingMatch[1].trim();
    }
    // Fallback to first line
    const firstLine = content.split('\n')[0]?.trim() || '';
    return firstLine.slice(0, 100);
  }

  private async getAvailableFilename(
    node: GraphNode,
    currentFilename: string | null
  ): Promise<string> {
    if (!this.dirHandle) throw new Error('No directory handle');

    // Use title (derived from first heading) or extract from content
    const titleForFilename = node.title || this.extractTitleFromContent(node.content);
    const sanitized = this.sanitizeFilename(titleForFilename);
    const baseName = sanitized || 'Untitled';
    const desiredFilename = `${baseName}.md`;

    if (currentFilename === desiredFilename) {
      return desiredFilename;
    }

    try {
      await this.dirHandle.getFileHandle(desiredFilename);
      const shortId = node.id.slice(0, 6);
      return `${baseName}-${shortId}.md`;
    } catch {
      return desiredFilename;
    }
  }
}
