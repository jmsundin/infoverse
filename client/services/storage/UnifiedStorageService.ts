import { GraphNode, GraphEdge } from '../../types';
import {
  ViewportBounds,
  ViewportLoadResult,
  StorageConfig,
  StorageEvent,
  StorageEventType,
  SpatialIndexEntry,
  DeletedNodeEntry,
  DEFAULT_STORAGE_CONFIG,
} from './types';
import { ViewportDataManager } from './ViewportDataManager';
import { debounce } from '../debounceService';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/**
 * UnifiedStorageService is the main public API for viewport-based storage.
 *
 * Key features:
 * - Viewport-based lazy loading (like Google Maps)
 * - Local-first with cloud sync
 * - CRDT-based conflict resolution using Yjs
 * - Debounced saves
 * - Event-based updates
 */
export class UnifiedStorageService extends EventTarget {
  private viewportManager: ViewportDataManager;
  private config: StorageConfig;

  // Save queue for debouncing
  private saveQueue: Map<string, { node: GraphNode; skipEmbedding: boolean }> = new Map();
  private edgesDirty = false;
  private edgesSnapshot: GraphEdge[] = [];

  // Debounced flush function
  private debouncedFlush: ReturnType<typeof debounce>;

  private initialized = false;

  // Cleanup interval for deletion stack pruning
  private cleanupIntervalId: number | null = null;

  // In-memory deletion stack for unauthenticated users
  private inMemoryDeletionStack: DeletedNodeEntry[] = [];

  constructor(config: Partial<StorageConfig> = {}) {
    super();
    this.config = { ...DEFAULT_STORAGE_CONFIG, ...config };
    this.viewportManager = new ViewportDataManager(this.config);

    // Create debounced flush
    this.debouncedFlush = debounce(
      () => this.flush(),
      this.config.syncDebounceMs
    );
  }

  /**
   * Initialize the storage service
   * @param dirHandle - File system directory handle for local storage
   * @param userId - User ID for cloud storage
   * @param inMemoryOnly - If true, only use in-memory storage (for unauthenticated users)
   */
  async initialize(
    dirHandle?: FileSystemDirectoryHandle,
    userId?: string,
    inMemoryOnly: boolean = false
  ): Promise<void> {
    this.config.dirHandle = dirHandle;
    this.config.userId = userId;
    this.config.localEnabled = !!dirHandle && !inMemoryOnly;
    this.config.cloudEnabled = !!userId && !inMemoryOnly;
    this.config.inMemoryOnly = inMemoryOnly;

    await this.viewportManager.initialize(dirHandle, userId);
    this.initialized = true;

    // Schedule periodic cleanup of old deleted entries
    this.scheduleDeletionStackCleanup();

    this.emit('loading-complete', {});
  }

  /**
   * Schedule periodic cleanup of deletion stack and node archive
   */
  private scheduleDeletionStackCleanup(): void {
    // Run cleanup on init
    this.pruneDeletionStack();
    this.pruneNodeArchive();

    // Then run every hour
    this.cleanupIntervalId = window.setInterval(() => {
      this.pruneDeletionStack();
      this.pruneNodeArchive();
    }, CLEANUP_INTERVAL_MS);
  }

  /**
   * Prune old entries from deletion stack (older than 30 days)
   */
  private async pruneDeletionStack(): Promise<void> {
    if (this.config.inMemoryOnly) {
      // Prune in-memory stack
      const cutoff = Date.now() - THIRTY_DAYS_MS;
      this.inMemoryDeletionStack = this.inMemoryDeletionStack.filter(
        (entry) => entry.deletedAt > cutoff
      );
      return;
    }

    const localAdapter = this.viewportManager.getLocalAdapter();
    if (localAdapter.isEnabled()) {
      await localAdapter.pruneDeletionStack(THIRTY_DAYS_MS);
    }
  }

  /**
   * Prune old entries from node archive (older than 30 days)
   */
  private async pruneNodeArchive(): Promise<void> {
    if (this.config.inMemoryOnly) {
      // No archive in memory-only mode
      return;
    }

    const localAdapter = this.viewportManager.getLocalAdapter();
    if (localAdapter.isEnabled()) {
      await localAdapter.pruneNodeArchive(THIRTY_DAYS_MS);
    }
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Check if local storage is enabled
   */
  isLocalEnabled(): boolean {
    return this.config.localEnabled;
  }

  /**
   * Check if cloud storage is enabled
   */
  isCloudEnabled(): boolean {
    return this.config.cloudEnabled;
  }

  /**
   * Check if in-memory only mode
   */
  isInMemoryOnly(): boolean {
    return this.config.inMemoryOnly;
  }

  /**
   * Get all in-memory data (for migration on sign-in)
   */
  getInMemoryData(): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const inMemoryAdapter = this.viewportManager.getInMemoryAdapter();
    return {
      nodes: inMemoryAdapter.getAllNodes(),
      edges: inMemoryAdapter.getAllEdges(),
    };
  }

  /**
   * Check if there's any in-memory data to migrate
   */
  hasInMemoryData(): boolean {
    return this.viewportManager.getInMemoryAdapter().hasData();
  }

  /**
   * Clear in-memory data (after successful migration)
   */
  clearInMemoryData(): void {
    this.viewportManager.getInMemoryAdapter().clear();
  }

  /**
   * Load the spatial index only (Phase 1 of two-phase loading)
   * Returns lightweight position + metadata for all nodes without loading content
   */
  async loadSpatialIndex(): Promise<SpatialIndexEntry[]> {
    // For local storage, get the spatial index from the adapter
    const localAdapter = this.viewportManager.getLocalAdapter();
    if (localAdapter.isEnabled()) {
      return localAdapter.getAllSpatialIndex();
    }

    // For in-memory mode, convert cached nodes to spatial index entries
    if (this.config.inMemoryOnly) {
      const nodes = this.viewportManager.getAllCachedNodes();
      return nodes.map(node => ({
        id: node.id,
        x: node.x,
        y: node.y,
        width: node.width || 300,
        height: node.height || 200,
        filename: `${node.id}.md`,
        type: node.type,
        color: node.color,
        title: node.title || node.content?.substring(0, 100),
        scopeId: node.scopeId,
      }));
    }

    // For cloud-only, we'd need to add a cloud endpoint for spatial index
    // For now, return empty (cloud support can be added later)
    return [];
  }

  /**
   * Load full content for specific nodes (Phase 2 of two-phase loading)
   * Called when nodes enter the viewport
   */
  async loadNodeContent(nodeIds: string[]): Promise<GraphNode[]> {
    const nodes: GraphNode[] = [];

    for (const nodeId of nodeIds) {
      const node = await this.viewportManager.getNode(nodeId);
      if (node) {
        nodes.push({ ...node, _loadState: 'loaded' });
      }
    }

    return nodes;
  }

  /**
   * Load all edges (needed for edge rendering even when nodes are skeletons)
   */
  async loadAllEdges(): Promise<GraphEdge[]> {
    const localAdapter = this.viewportManager.getLocalAdapter();
    if (localAdapter.isEnabled()) {
      return localAdapter.loadAllEdges();
    }
    return this.viewportManager.getAllCachedEdges();
  }

  /**
   * Load data for a viewport
   */
  async loadViewport(viewport: ViewportBounds): Promise<ViewportLoadResult> {
    this.emit('loading-start', { bounds: viewport });

    const result = await this.viewportManager.onViewportChange(viewport);

    this.emit('nodes-updated', { nodes: result.nodes });
    this.emit('edges-updated', { edges: result.edges });
    this.emit('loading-complete', { bounds: viewport });

    return result;
  }

  /**
   * Get nodes in a viewport (from cache, no fetch)
   */
  getNodesInViewport(viewport: ViewportBounds): GraphNode[] {
    return this.viewportManager.getCachedNodesInBounds(viewport);
  }

  /**
   * Get edges for nodes in viewport
   */
  getEdgesInViewport(viewport: ViewportBounds): GraphEdge[] {
    const nodes = this.getNodesInViewport(viewport);
    return this.viewportManager.getCachedEdgesForNodes(nodes);
  }

  /**
   * Get a single node by ID
   */
  async getNode(nodeId: string): Promise<GraphNode | null> {
    return this.viewportManager.getNode(nodeId);
  }

  /**
   * Update a node (queued, debounced save)
   */
  updateNode(node: GraphNode, skipEmbedding = false): void {
    // Update in manager immediately
    this.viewportManager.updateNode(node);

    // Queue for save
    this.saveQueue.set(node.id, { node, skipEmbedding });

    // Trigger debounced flush
    this.debouncedFlush();

    // Emit update
    this.emit('nodes-updated', { nodes: [node] });
  }

  /**
   * Add a new node
   */
  addNode(node: GraphNode, skipEmbedding = false): void {
    this.viewportManager.addNode(node);
    this.saveQueue.set(node.id, { node, skipEmbedding });
    this.debouncedFlush();
    this.emit('nodes-updated', { nodes: [node] });
  }

  /**
   * Delete a node (soft delete - moves to deletion stack)
   */
  async deleteNode(nodeId: string): Promise<void> {
    // For in-memory mode, capture node before deletion for the stack
    if (this.config.inMemoryOnly) {
      const node = await this.viewportManager.getNode(nodeId);
      if (node) {
        // Get edges connected to this node
        const allEdges = this.viewportManager.getAllCachedEdges();
        const connectedEdges = allEdges.filter(
          (e) => e.source === nodeId || e.target === nodeId
        );

        // Push to in-memory deletion stack
        this.inMemoryDeletionStack.push({
          node,
          edges: connectedEdges,
          deletedAt: Date.now(),
        });
      }
    }

    this.viewportManager.deleteNode(nodeId);

    // Remove from save queue
    this.saveQueue.delete(nodeId);

    // In-memory only mode: deletion handled above
    if (this.config.inMemoryOnly) {
      return;
    }

    // Delete from storage (LocalStorageAdapter now handles soft delete)
    const localAdapter = this.viewportManager.getLocalAdapter();
    const cloudAdapter = this.viewportManager.getCloudAdapter();

    if (localAdapter.isEnabled()) {
      await localAdapter.deleteNode(nodeId);
    }

    if (cloudAdapter.isEnabled()) {
      await cloudAdapter.deleteNode(nodeId);
    }
  }

  /**
   * Restore the most recently deleted node
   * Returns the restored node entry, or null if stack is empty
   */
  async restoreLastDeletedNode(): Promise<DeletedNodeEntry | null> {
    let entry: DeletedNodeEntry | null = null;

    if (this.config.inMemoryOnly) {
      // Pop from in-memory stack
      entry = this.inMemoryDeletionStack.pop() ?? null;
      if (entry) {
        // Re-add to viewport manager
        this.viewportManager.addNode(entry.node);
        // Re-add edges
        const currentEdges = this.viewportManager.getAllCachedEdges();
        this.viewportManager.updateEdges([...currentEdges, ...entry.edges]);
      }
    } else {
      // Restore from local storage adapter
      const localAdapter = this.viewportManager.getLocalAdapter();
      if (localAdapter.isEnabled()) {
        entry = await localAdapter.restoreNode();
        if (entry) {
          // Re-add to viewport manager cache
          this.viewportManager.addNode(entry.node);
          // Re-add edges to cache
          const currentEdges = this.viewportManager.getAllCachedEdges();
          this.viewportManager.updateEdges([...currentEdges, ...entry.edges]);
        }
      }
    }

    if (entry) {
      this.emit('nodes-updated', { nodes: [entry.node] });
      this.emit('edges-updated', { edges: entry.edges });
    }

    return entry;
  }

  /**
   * Get the number of deleted nodes that can be restored
   */
  getDeletionStackSize(): number {
    if (this.config.inMemoryOnly) {
      return this.inMemoryDeletionStack.length;
    }

    const localAdapter = this.viewportManager.getLocalAdapter();
    if (localAdapter.isEnabled()) {
      return localAdapter.getDeletionStackSize();
    }

    return 0;
  }

  /**
   * Update edges
   */
  updateEdges(edges: GraphEdge[]): void {
    this.viewportManager.updateEdges(edges);
    this.edgesSnapshot = edges;
    this.edgesDirty = true;
    this.debouncedFlush();
    this.emit('edges-updated', { edges });
  }

  /**
   * Flush all pending saves immediately
   */
  async flush(): Promise<void> {
    const dirtyNodes = Array.from(this.saveQueue.values());
    this.saveQueue.clear();

    const edges = this.edgesDirty ? this.edgesSnapshot : null;
    this.edgesDirty = false;

    // In-memory only mode: don't persist anywhere, data stays in ViewportDataManager
    if (this.config.inMemoryOnly) {
      // Data is already in the in-memory adapter via updateNode/addNode calls
      return;
    }

    const localAdapter = this.viewportManager.getLocalAdapter();
    const cloudAdapter = this.viewportManager.getCloudAdapter();

    // Save to local storage
    if (localAdapter.isEnabled()) {
      // Save dirty nodes with their outgoing edges
      for (const { node } of dirtyNodes) {
        const outgoingEdges = this.edgesSnapshot.filter(
          (e) => e.source === node.id
        );
        await localAdapter.saveNodeImmediate(node, outgoingEdges);
      }

      // If edges changed, also save source nodes that weren't already dirty
      // This ensures edges get persisted to their source node's markdown file
      if (edges) {
        const dirtyNodeIds = new Set(dirtyNodes.map(({ node }) => node.id));
        const sourceNodeIds = new Set(this.edgesSnapshot.map((e) => e.source));

        for (const sourceId of sourceNodeIds) {
          // Skip if already saved above
          if (dirtyNodeIds.has(sourceId)) continue;

          // Find the node in cache
          const node = this.viewportManager.getAllCachedNodes().find(
            (n) => n.id === sourceId
          );
          if (node) {
            const outgoingEdges = this.edgesSnapshot.filter(
              (e) => e.source === node.id
            );
            await localAdapter.saveNodeImmediate(node, outgoingEdges);
          }
        }
      }
    }

    // Save to cloud storage (batch)
    if (cloudAdapter.isEnabled()) {
      if (dirtyNodes.length > 0) {
        await cloudAdapter.saveNodesBatch(
          dirtyNodes.map(({ node, skipEmbedding }) => ({
            ...node,
            skipEmbedding,
          }))
        );
      }

      if (edges) {
        await cloudAdapter.saveEdges(edges);
      }

      // Sync Yjs state for changed nodes
      const yjsEngine = this.viewportManager.getYjsEngine();
      for (const { node } of dirtyNodes) {
        const state = yjsEngine.getFullState(node.id);
        if (state) {
          await cloudAdapter.pushYjsUpdate(node.id, state);
        }
      }
    }
  }

  /**
   * Force sync from cloud (pull updates)
   */
  async syncFromCloud(): Promise<void> {
    if (!this.config.cloudEnabled) return;

    const cloudAdapter = this.viewportManager.getCloudAdapter();
    const yjsEngine = this.viewportManager.getYjsEngine();

    // Get Yjs states for all cached nodes
    const nodeIds = yjsEngine.getDocumentIds();
    const remoteStates = await cloudAdapter.pullYjsStatesBatch(nodeIds);

    // Apply remote updates
    for (const [nodeId, state] of remoteStates) {
      yjsEngine.applyRemoteUpdate(nodeId, state);

      // Update cache with merged result
      const merged = yjsEngine.toGraphNode(nodeId);
      if (merged) {
        this.viewportManager.updateNode(merged);
      }
    }

    this.emit('nodes-updated', {
      nodes: this.viewportManager.getAllCachedNodes(),
    });
  }

  /**
   * Invalidate cache and refetch
   */
  async refresh(viewport: ViewportBounds): Promise<ViewportLoadResult> {
    this.viewportManager.invalidateAll();
    return this.loadViewport(viewport);
  }

  /**
   * Get all cached nodes
   */
  getAllCachedNodes(): GraphNode[] {
    return this.viewportManager.getAllCachedNodes();
  }

  /**
   * Get all cached edges
   */
  getAllCachedEdges(): GraphEdge[] {
    return this.viewportManager.getAllCachedEdges();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): ReturnType<ViewportDataManager['getCacheStats']> {
    return this.viewportManager.getCacheStats();
  }

  /**
   * Check if currently loading
   */
  isLoading(): boolean {
    return this.viewportManager.isLoading();
  }

  /**
   * Dispose the service
   */
  dispose(): void {
    // Stop cleanup interval
    if (this.cleanupIntervalId !== null) {
      window.clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }

    // Flush any pending saves
    this.flush();

    // Clear caches
    this.viewportManager.invalidateAll();
    this.saveQueue.clear();
    this.edgesDirty = false;
    this.inMemoryDeletionStack = [];
    this.initialized = false;
  }

  /**
   * Emit a storage event
   */
  private emit(type: StorageEventType, data: Partial<StorageEvent>): void {
    const event = new CustomEvent(type, {
      detail: { type, ...data },
    });
    this.dispatchEvent(event);
  }

  /**
   * Add event listener with typed callback
   */
  on(
    type: StorageEventType,
    callback: (event: CustomEvent<StorageEvent>) => void
  ): () => void {
    this.addEventListener(type, callback as EventListener);
    return () => this.removeEventListener(type, callback as EventListener);
  }

  /**
   * Remove event listener
   */
  off(
    type: StorageEventType,
    callback: (event: CustomEvent<StorageEvent>) => void
  ): void {
    this.removeEventListener(type, callback as EventListener);
  }
}

// Export a singleton instance (optional - can also create instances)
let defaultInstance: UnifiedStorageService | null = null;

export function getStorageService(): UnifiedStorageService {
  if (!defaultInstance) {
    defaultInstance = new UnifiedStorageService();
  }
  return defaultInstance;
}

export function resetStorageService(): void {
  if (defaultInstance) {
    defaultInstance.dispose();
    defaultInstance = null;
  }
}
