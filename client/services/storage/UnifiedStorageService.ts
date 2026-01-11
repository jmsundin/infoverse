import { GraphNode, GraphEdge } from '../../types';
import {
  ViewportBounds,
  ViewportLoadResult,
  StorageConfig,
  StorageEvent,
  StorageEventType,
  DEFAULT_STORAGE_CONFIG,
} from './types';
import { ViewportDataManager } from './ViewportDataManager';
import { debounce } from '../debounceService';

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

    this.emit('loading-complete', {});
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
   * Delete a node
   */
  async deleteNode(nodeId: string): Promise<void> {
    this.viewportManager.deleteNode(nodeId);

    // Remove from save queue
    this.saveQueue.delete(nodeId);

    // In-memory only mode: deletion already handled in ViewportDataManager
    if (this.config.inMemoryOnly) {
      return;
    }

    // Delete from storage immediately
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
      for (const { node } of dirtyNodes) {
        // Get outgoing edges for this node
        const outgoingEdges = this.edgesSnapshot.filter(
          (e) => e.source === node.id
        );
        await localAdapter.saveNodeImmediate(node, outgoingEdges);
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
    // Flush any pending saves
    this.flush();

    // Clear caches
    this.viewportManager.invalidateAll();
    this.saveQueue.clear();
    this.edgesDirty = false;
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
