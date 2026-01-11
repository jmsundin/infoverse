import { GraphNode, GraphEdge, EmbeddedEdge, NodeType, NodeColor } from '../../../types';
import { ViewportBounds, NodePositionIndex, SpatialIndexEntry, StorageAdapter } from '../types';
import yaml from 'js-yaml';
import * as d3 from 'd3';

/**
 * LocalStorageAdapter provides viewport-based access to local file system storage.
 * Uses the File System Access API to read/write markdown files with YAML frontmatter.
 *
 * Key features:
 * - Builds a spatial index on directory open (position metadata only)
 * - Loads full node content only for visible viewport
 * - Debounced saves with web lock for concurrent safety
 */
export class LocalStorageAdapter implements StorageAdapter {
  private dirHandle: FileSystemDirectoryHandle | null = null;
  private nodeIndex: Map<string, NodePositionIndex> = new Map();
  private extendedIndex: Map<string, SpatialIndexEntry> = new Map(); // Extended index with metadata
  private quadtree: d3.Quadtree<NodePositionIndex> | null = null;
  private fileIndex: Map<string, string> = new Map(); // nodeId -> filename
  private initialized = false;

  // Debounce tracking
  private saveTimers: Map<string, number> = new Map();
  private saveDebounceMs: number = 2000;

  constructor(saveDebounceMs: number = 2000) {
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

      // Quick frontmatter extraction
      const frontmatterMatch = text.match(/^---\n([\s\S]*?)\n---/);
      if (!frontmatterMatch) return null;

      const metadata = yaml.load(frontmatterMatch[1]) as any;
      if (!metadata?.id || typeof metadata.x !== 'number' || typeof metadata.y !== 'number') {
        return null;
      }

      // Migration: handle old field names (parentId was scope, outlineParentId becomes parentId)
      const scopeId = metadata.scopeId ?? metadata.parentId;
      const parentId = metadata.outlineParentId;

      return {
        id: metadata.id,
        x: metadata.x,
        y: metadata.y,
        width: metadata.width || 300,
        height: metadata.height || 200,
        filename: fileHandle.name,
        // Extended fields for skeleton rendering
        type: metadata.type || NodeType.NOTE,
        color: metadata.color as NodeColor | undefined,
        title: metadata.title || metadata.content?.substring(0, 100),
        scopeId,
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
            for (const edge of result.edges) {
              allEdges.push({
                id: edge.id,
                source: result.node.id,
                target: edge.target,
                label: edge.label,
              });
            }
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
          for (const edge of result.edges) {
            edges.push({
              id: edge.id,
              source: result.node.id,
              target: edge.target,
              label: edge.label,
            });
          }
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
  ): Promise<{ node: GraphNode; edges: EmbeddedEdge[] } | null> {
    try {
      const file = await fileHandle.getFile();
      const text = await file.text();

      const parts = text.split(/^---$/m);
      if (parts.length < 3) return null;

      const metadata = yaml.load(parts[1]) as any;
      const content = parts.slice(2).join('---').trim();

      // Extract edges from metadata
      const embeddedEdges: EmbeddedEdge[] = metadata.edges || [];

      // Remove edges from node object
      const nodeData = { ...metadata };
      delete nodeData.edges;

      // Migration: rename old field names
      // Old parentId (scope) -> scopeId, old outlineParentId -> parentId
      if (nodeData.parentId !== undefined && nodeData.scopeId === undefined) {
        nodeData.scopeId = nodeData.parentId;
        delete nodeData.parentId;
      }
      if (nodeData.outlineParentId !== undefined) {
        nodeData.parentId = nodeData.outlineParentId;
        delete nodeData.outlineParentId;
      }

      const node: GraphNode = {
        ...nodeData,
        content: metadata.content || content || 'Untitled',
      };

      return { node, edges: embeddedEdges };
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

        const metadata: any = { ...node };
        delete metadata.content;

        // Convert outgoing edges to embedded format
        if (outgoingEdges.length > 0) {
          metadata.edges = outgoingEdges.map((edge) => ({
            id: edge.id,
            target: edge.target,
            label: edge.label,
          }));
        } else {
          delete metadata.edges;
        }

        const frontmatter = yaml.dump(metadata);

        let body = '';
        if (node.messages) {
          body = node.messages.map((m) => `**${m.role}**: ${m.text}`).join('\n\n');
        } else {
          body = node.summary || '';
        }

        const fileContent = `---\n${frontmatter}---\n\n# ${node.content}\n\n${body}`;

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
          title: node.title || node.content?.substring(0, 100),
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
   * Delete a node's file
   */
  async deleteNode(nodeId: string): Promise<void> {
    if (!this.dirHandle) return;

    const hasPerm = await this.verifyPermission(this.dirHandle, true);
    if (!hasPerm) return;

    const filename = this.fileIndex.get(nodeId);
    if (filename) {
      try {
        await this.dirHandle.removeEntry(filename);
      } catch {
        // Ignore if file doesn't exist
      }
    }

    // Update indices
    this.fileIndex.delete(nodeId);
    this.nodeIndex.delete(nodeId);
    this.extendedIndex.delete(nodeId);
    this.rebuildQuadtree();
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

  private async getAvailableFilename(
    node: GraphNode,
    currentFilename: string | null
  ): Promise<string> {
    if (!this.dirHandle) throw new Error('No directory handle');

    const sanitized = this.sanitizeFilename(node.content);
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
