import { GraphNode, GraphEdge } from '../../types';
import {
  ViewportBounds,
  GhostNode,
  ViewportLoadResult,
  StorageConfig,
  DEFAULT_STORAGE_CONFIG,
  LocalStorageAdapterInterface,
} from './types';
import { RegionTracker } from './RegionTracker';
import { LocalStorageAdapter } from './adapters/LocalStorageAdapter';
import { CloudStorageAdapter } from './adapters/CloudStorageAdapter';
import { InMemoryStorageAdapter } from './adapters/InMemoryStorageAdapter';
import { YjsSyncEngine } from './crdt/YjsSyncEngine';
import { SQLiteStorageAdapter } from './sqlite/SQLiteStorageAdapter';
import { withDerivedContentFields } from '../../utils/nodeContentUtils';

/**
 * ViewportDataManager orchestrates viewport-based data loading.
 *
 * Key responsibilities:
 * - Track which regions have been fetched
 * - Load data from local storage first, then cloud
 * - Merge local and cloud data using CRDTs
 * - Cache loaded nodes for fast access
 * - Handle edges that span viewport boundaries
 */
export class ViewportDataManager {
  private regionTracker: RegionTracker;
  private localAdapter: LocalStorageAdapterInterface;
  private cloudAdapter: CloudStorageAdapter;
  private inMemoryAdapter: InMemoryStorageAdapter;
  private yjsEngine: YjsSyncEngine;

  // Node cache (LRU would be better but Map is simpler)
  private nodeCache: Map<string, GraphNode> = new Map();
  private edgeCache: Map<string, GraphEdge> = new Map();
  private ghostNodeCache: Map<string, GhostNode> = new Map();

  private config: StorageConfig;
  private loading = false;

  constructor(config: Partial<StorageConfig> = {}) {
    this.config = { ...DEFAULT_STORAGE_CONFIG, ...config };
    this.regionTracker = new RegionTracker(this.config.regionGridSize);

    // Select adapter based on feature flag
    if (this.config.useSQLite) {
      this.localAdapter = new SQLiteStorageAdapter({ saveDebounceMs: this.config.syncDebounceMs });
    } else {
      this.localAdapter = new LocalStorageAdapter(this.config.syncDebounceMs);
    }

    this.cloudAdapter = new CloudStorageAdapter();
    this.inMemoryAdapter = new InMemoryStorageAdapter();
    this.yjsEngine = new YjsSyncEngine();
  }

  /**
   * Initialize the manager with storage handles
   */
  async initialize(
    dirHandle?: FileSystemDirectoryHandle,
    userId?: string
  ): Promise<void> {
    this.config.dirHandle = dirHandle;
    this.config.userId = userId;
    this.config.localEnabled = !!dirHandle;
    this.config.cloudEnabled = !!userId;

    if (dirHandle) {
      await this.localAdapter.initialize(dirHandle);
    }

    if (userId) {
      await this.cloudAdapter.initialize(userId);
    }
  }

  /**
   * Called when viewport changes - loads data for the visible area
   */
  async onViewportChange(viewport: ViewportBounds): Promise<ViewportLoadResult> {
    if (this.loading) {
      // Already loading, skip this request
      return {
        nodes: this.getCachedNodesInBounds(viewport),
        edges: this.getCachedEdgesForNodes(this.getCachedNodesInBounds(viewport)),
        ghostNodes: [],
        source: 'cache',
      };
    }

    this.loading = true;

    try {
      // In-memory only mode: just return data from in-memory adapter
      if (this.config.inMemoryOnly) {
        const nodes = await this.inMemoryAdapter.loadNodesInBounds(viewport);
        const nodeIds = new Set(nodes.map(n => n.id));
        const edges = await this.inMemoryAdapter.loadEdgesForNodes(nodeIds);

        // Update caches
        for (const node of nodes) {
          this.nodeCache.set(node.id, node);
        }
        for (const edge of edges) {
          this.edgeCache.set(edge.id, edge);
        }

        return {
          nodes,
          edges,
          ghostNodes: [],
          source: 'cache',
        };
      }

      // Expand bounds by buffer multiplier
      const expandedBounds = this.expandBounds(viewport, this.config.viewportBufferMultiplier);

      // Check which regions need fetching
      const unfetchedBounds = this.regionTracker.getUnfetchedBounds(expandedBounds);

      if (!unfetchedBounds) {
        // All regions already fetched
        return {
          nodes: this.getCachedNodesInBounds(viewport),
          edges: this.getCachedEdgesForNodes(this.getCachedNodesInBounds(viewport)),
          ghostNodes: [],
          source: 'cache',
        };
      }

      // Track which nodes came from where
      const localNodeIds = new Set<string>();
      const cloudNodeIds = new Set<string>();

      // 1. Load from local storage first
      if (this.localAdapter.isEnabled()) {
        const localNodes = await this.localAdapter.loadNodesInBounds(unfetchedBounds);

        for (const rawNode of localNodes) {
          const node = withDerivedContentFields(rawNode);
          // Initialize CRDT document
          this.yjsEngine.initializeFromNode(node.id, node);
          this.nodeCache.set(node.id, node);
          localNodeIds.add(node.id);
        }

        // Load edges for local nodes
        const localEdges = await this.localAdapter.loadEdgesForNodes(localNodeIds);
        for (const edge of localEdges) {
          this.edgeCache.set(edge.id, edge);
        }
      }

      // 2. Load from cloud to fill gaps
      if (this.cloudAdapter.isEnabled()) {
        const { nodes: cloudNodes, edges: cloudEdges } =
          await this.cloudAdapter.fetchNodesInViewport(unfetchedBounds);

        // Merge cloud nodes with local using CRDT
        for (const rawCloudNode of cloudNodes) {
          const cloudNode = withDerivedContentFields(rawCloudNode);
          if (localNodeIds.has(cloudNode.id)) {
            // Node exists locally - merge using CRDT
            const localNode = this.nodeCache.get(cloudNode.id)!;
            const { merged } = this.yjsEngine.mergeNodes(localNode, cloudNode);
            this.nodeCache.set(cloudNode.id, merged);
          } else {
            // Node only in cloud
            this.yjsEngine.initializeFromNode(cloudNode.id, cloudNode);
            this.nodeCache.set(cloudNode.id, cloudNode);
            cloudNodeIds.add(cloudNode.id);
          }
        }

        // Add cloud edges
        for (const edge of cloudEdges) {
          this.edgeCache.set(edge.id, edge);
        }
      }

      // 3. Mark regions as fetched
      const allNodeIds = new Set([...localNodeIds, ...cloudNodeIds]);
      const source =
        localNodeIds.size > 0 && cloudNodeIds.size > 0
          ? 'both'
          : localNodeIds.size > 0
          ? 'local'
          : 'cloud';
      this.regionTracker.markFetched(unfetchedBounds, source as any, allNodeIds);

      // 4. Get nodes in original viewport
      const visibleNodes = this.getCachedNodesInBounds(viewport);
      const visibleEdges = this.getCachedEdgesForNodes(visibleNodes);

      // 5. Handle ghost nodes for edges with targets outside viewport
      const ghostNodes = await this.loadGhostNodesForEdges(visibleEdges, viewport);

      return {
        nodes: visibleNodes,
        edges: visibleEdges,
        ghostNodes,
        source: 'merged',
      };
    } finally {
      this.loading = false;
    }
  }

  /**
   * Get nodes from cache that are within bounds
   */
  getCachedNodesInBounds(bounds: ViewportBounds): GraphNode[] {
    const nodes: GraphNode[] = [];

    for (const node of this.nodeCache.values()) {
      const nodeRight = node.x + (node.width || 300);
      const nodeBottom = node.y + (node.height || 200);

      if (
        node.x < bounds.maxX &&
        nodeRight > bounds.minX &&
        node.y < bounds.maxY &&
        nodeBottom > bounds.minY
      ) {
        nodes.push(node);
      }
    }

    return nodes;
  }

  /**
   * Get edges from cache for the given nodes
   */
  getCachedEdgesForNodes(nodes: GraphNode[]): GraphEdge[] {
    const nodeIds = new Set(nodes.map((n) => n.id));
    const edges: GraphEdge[] = [];

    for (const edge of this.edgeCache.values()) {
      if (nodeIds.has(edge.source)) {
        edges.push(edge);
      }
    }

    return edges;
  }

  /**
   * Load ghost nodes for edge targets that are outside viewport
   */
  private async loadGhostNodesForEdges(
    edges: GraphEdge[],
    viewport: ViewportBounds
  ): Promise<GhostNode[]> {
    // Find edge targets that are not in cache or outside viewport
    const missingTargetIds: string[] = [];

    for (const edge of edges) {
      if (!this.nodeCache.has(edge.target) && !this.ghostNodeCache.has(edge.target)) {
        missingTargetIds.push(edge.target);
      }
    }

    if (missingTargetIds.length === 0) {
      return Array.from(this.ghostNodeCache.values());
    }

    // Try to get positions from local index first
    if (this.localAdapter.isEnabled()) {
      for (const targetId of missingTargetIds) {
        const position = this.localAdapter.getNodePosition(targetId);
        if (position) {
          this.ghostNodeCache.set(targetId, {
            id: targetId,
            x: position.x,
            y: position.y,
            width: position.width,
            height: position.height,
          });
        }
      }
    }

    // For remaining missing targets, fetch from cloud
    const stillMissing = missingTargetIds.filter(
      (id) => !this.ghostNodeCache.has(id)
    );

    if (stillMissing.length > 0 && this.cloudAdapter.isEnabled()) {
      const ghostNodes = await this.cloudAdapter.fetchGhostNodes(stillMissing);
      for (const ghost of ghostNodes) {
        this.ghostNodeCache.set(ghost.id, ghost);
      }
    }

    return Array.from(this.ghostNodeCache.values());
  }

  /**
   * Get a single node (from cache or fetch)
   */
  async getNode(nodeId: string): Promise<GraphNode | null> {
    // Check cache first
    if (this.nodeCache.has(nodeId)) {
      return this.nodeCache.get(nodeId)!;
    }

    // Try local
    if (this.localAdapter.isEnabled()) {
      const rawNode = await this.localAdapter.loadNode(nodeId);
      const node = rawNode ? withDerivedContentFields(rawNode) : null;
      if (node) {
        this.yjsEngine.initializeFromNode(nodeId, node);
        this.nodeCache.set(nodeId, node);
        return node;
      }
    }

    // Try cloud
    if (this.cloudAdapter.isEnabled()) {
      const rawNode = await this.cloudAdapter.loadNode(nodeId);
      const node = rawNode ? withDerivedContentFields(rawNode) : null;
      if (node) {
        this.yjsEngine.initializeFromNode(nodeId, node);
        this.nodeCache.set(nodeId, node);
        return node;
      }
    }

    return null;
  }

  /**
   * Update a node in cache (call after local edit)
   */
  updateNode(node: GraphNode): void {
    // In-memory only mode: store in in-memory adapter
    if (this.config.inMemoryOnly) {
      this.inMemoryAdapter.updateNode(node);
      this.nodeCache.set(node.id, node);
      return;
    }

    const previous = this.nodeCache.get(node.id);
    const normalized =
      previous && previous.content === node.content
        ? node
        : withDerivedContentFields(node);

    // Update CRDT document
    this.yjsEngine.applyLocalUpdate(normalized.id, normalized);

    // Update cache
    this.nodeCache.set(normalized.id, normalized);

    // Update region tracker position
    if (
      previous &&
      (previous.x !== normalized.x || previous.y !== normalized.y)
    ) {
      this.regionTracker.updateNodePosition(
        normalized.id,
        previous.x,
        previous.y,
        normalized.x,
        normalized.y
      );

      // Update local adapter index
      if (this.localAdapter.isEnabled()) {
        this.localAdapter.updateNodePositionInIndex(
          normalized.id,
          normalized.x,
          normalized.y,
          normalized.width,
          normalized.height
        );
      }
    }
  }

  /**
   * Add a new node
   */
  addNode(node: GraphNode): void {
    // In-memory only mode: store in in-memory adapter
    if (this.config.inMemoryOnly) {
      this.inMemoryAdapter.saveNode(node);
      this.nodeCache.set(node.id, node);
      return;
    }

    const normalized = withDerivedContentFields(node);
    this.yjsEngine.initializeFromNode(normalized.id, normalized);
    this.nodeCache.set(normalized.id, normalized);
  }

  /**
   * Delete a node
   */
  deleteNode(nodeId: string): void {
    // In-memory only mode: delete from in-memory adapter
    if (this.config.inMemoryOnly) {
      this.inMemoryAdapter.deleteNode(nodeId);
      this.nodeCache.delete(nodeId);
      // Remove edges involving this node from cache
      for (const [edgeId, edge] of this.edgeCache) {
        if (edge.source === nodeId || edge.target === nodeId) {
          this.edgeCache.delete(edgeId);
        }
      }
      return;
    }

    this.yjsEngine.removeDocument(nodeId);
    this.nodeCache.delete(nodeId);
    this.ghostNodeCache.delete(nodeId);
    this.regionTracker.removeNodeId(nodeId);

    // Remove edges involving this node
    for (const [edgeId, edge] of this.edgeCache) {
      if (edge.source === nodeId || edge.target === nodeId) {
        this.edgeCache.delete(edgeId);
      }
    }
  }

  /**
   * Update edges
   */
  updateEdges(edges: GraphEdge[]): void {
    // In-memory only mode: update in-memory adapter
    if (this.config.inMemoryOnly) {
      // Clear and re-add all edges
      for (const edge of edges) {
        this.inMemoryAdapter.addEdge(edge);
        this.edgeCache.set(edge.id, edge);
      }
      return;
    }

    // Clear old edges
    this.edgeCache.clear();

    // Add new edges
    for (const edge of edges) {
      this.edgeCache.set(edge.id, edge);
    }
  }

  /**
   * Get all cached nodes
   */
  getAllCachedNodes(): GraphNode[] {
    return Array.from(this.nodeCache.values());
  }

  /**
   * Get all cached edges
   */
  getAllCachedEdges(): GraphEdge[] {
    return Array.from(this.edgeCache.values());
  }

  /**
   * Invalidate cache for a region (when data might have changed)
   */
  invalidateRegion(bounds: ViewportBounds): void {
    this.regionTracker.invalidateRegion(bounds);
  }

  /**
   * Invalidate all cache
   */
  invalidateAll(): void {
    this.regionTracker.invalidateAll();
    this.nodeCache.clear();
    this.edgeCache.clear();
    this.ghostNodeCache.clear();
    this.yjsEngine.clear();
  }

  /**
   * Expand bounds by a multiplier
   */
  private expandBounds(bounds: ViewportBounds, multiplier: number): ViewportBounds {
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    const expandX = (width * (multiplier - 1)) / 2;
    const expandY = (height * (multiplier - 1)) / 2;

    return {
      minX: bounds.minX - expandX,
      minY: bounds.minY - expandY,
      maxX: bounds.maxX + expandX,
      maxY: bounds.maxY + expandY,
    };
  }

  /**
   * Get the CRDT engine (for sync operations)
   */
  getYjsEngine(): YjsSyncEngine {
    return this.yjsEngine;
  }

  /**
   * Get the local adapter (for direct file operations)
   */
  getLocalAdapter(): LocalStorageAdapterInterface {
    return this.localAdapter;
  }

  /**
   * Get the cloud adapter (for direct API operations)
   */
  getCloudAdapter(): CloudStorageAdapter {
    return this.cloudAdapter;
  }

  /**
   * Get the in-memory adapter (for direct in-memory operations)
   */
  getInMemoryAdapter(): InMemoryStorageAdapter {
    return this.inMemoryAdapter;
  }

  /**
   * Check if in-memory only mode
   */
  isInMemoryOnly(): boolean {
    return this.config.inMemoryOnly;
  }

  /**
   * Check if currently loading
   */
  isLoading(): boolean {
    return this.loading;
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    nodeCount: number;
    edgeCount: number;
    ghostNodeCount: number;
    fetchedCellCount: number;
    yjsDocCount: number;
  } {
    return {
      nodeCount: this.nodeCache.size,
      edgeCount: this.edgeCache.size,
      ghostNodeCount: this.ghostNodeCache.size,
      fetchedCellCount: this.regionTracker.getFetchedCellCount(),
      yjsDocCount: this.yjsEngine.getDocumentCount(),
    };
  }
}
