import { GraphNode, GraphEdge, EmbeddedEdge, NodeType, NodeColor } from '../../types';

// Viewport bounds for spatial queries
export interface ViewportBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

// A spatial region that has been fetched (grid cell)
export interface FetchedRegion {
  cellKey: string; // e.g., "0,0", "1,-1"
  bounds: ViewportBounds;
  timestamp: number;
  source: 'local' | 'cloud' | 'both';
  nodeIds: Set<string>;
}

// Minimal node position info for spatial index (local FS)
export interface NodePositionIndex {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  filename: string;
}

// Extended spatial index for two-phase loading (includes metadata for skeleton rendering)
export interface SpatialIndexEntry {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  filename: string;
  // Additional fields for skeleton rendering
  type: NodeType;
  color?: NodeColor;
  title?: string;
  scopeId?: string;
}

// Ghost node - minimal info for out-of-viewport edge targets
export interface GhostNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

// Node with CRDT metadata
export interface CRDTNode extends GraphNode {
  _yjsStateVector?: Uint8Array;
  _lastSyncTimestamp?: number;
  _source?: 'local' | 'cloud' | 'merged';
}

// Result of a viewport load operation
export interface ViewportLoadResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  ghostNodes: GhostNode[];
  source: 'local' | 'cloud' | 'cache' | 'merged';
}

// Storage operation result
export interface StorageResult<T> {
  success: boolean;
  data?: T;
  source: 'local' | 'cloud' | 'cache' | 'merged';
  errors?: StorageError[];
}

export type StorageErrorCode =
  | 'NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'NETWORK_ERROR'
  | 'SYNC_CONFLICT'
  | 'PARSE_ERROR'
  | 'WRITE_ERROR';

export interface StorageError {
  code: StorageErrorCode;
  message: string;
  nodeId?: string;
}

// Configuration for the storage service
export interface StorageConfig {
  localEnabled: boolean;
  cloudEnabled: boolean;
  inMemoryOnly: boolean; // For unauthenticated users - no persistence
  dirHandle?: FileSystemDirectoryHandle;
  userId?: string;
  viewportBufferMultiplier: number; // How much to expand viewport for prefetch (e.g., 1.5)
  regionGridSize: number; // Grid cell size for region tracking (e.g., 1000)
  syncDebounceMs: number; // Debounce time for saves (e.g., 2000)
  maxCacheSize: number; // Max nodes to keep in LRU cache
  useSQLite?: boolean; // Feature flag: use SQLite for local storage instead of quadtree
}

export const DEFAULT_STORAGE_CONFIG: StorageConfig = {
  localEnabled: false,
  cloudEnabled: false,
  inMemoryOnly: true, // Default to in-memory until authenticated
  viewportBufferMultiplier: 1.5,
  regionGridSize: 1000,
  syncDebounceMs: 500,
  maxCacheSize: 500,
  useSQLite: false, // Default to quadtree, opt-in for SQLite
};

// Events emitted by the storage service
export type StorageEventType =
  | 'nodes-updated'
  | 'edges-updated'
  | 'sync-conflict'
  | 'save-error'
  | 'loading-start'
  | 'loading-complete'
  | 'bootstrap-progress'; // SQLite bootstrap progress

export interface StorageEvent {
  type: StorageEventType;
  nodes?: GraphNode[];
  edges?: GraphEdge[];
  error?: StorageError;
  bounds?: ViewportBounds;
}

// Yjs document field types for type safety
export interface YjsNodeFields {
  // LWW Registers (last-writer-wins)
  position: { x: number; y: number };
  dimensions: { width: number; height: number };
  visual: { color?: NodeColor; type: NodeType; pinned?: boolean };
  metadata: {
    scopeId?: string | null;
    parentId?: string | null;
    autoExpandDepth?: number;
  };

  // Text CRDT
  content: string;

  // Set CRDTs (arrays with deduplication)
  edges: EmbeddedEdge[];
}

// Adapter interface for storage backends
export interface StorageAdapter {
  initialize(): Promise<void>;
  loadNodesInBounds(bounds: ViewportBounds): Promise<GraphNode[]>;
  loadNode(nodeId: string): Promise<GraphNode | null>;
  saveNode(node: GraphNode, edges?: GraphEdge[]): Promise<void>;
  deleteNode(nodeId: string): Promise<void>;
  isEnabled(): boolean;
}

// Extended interface for local storage adapters (both quadtree and SQLite)
export interface LocalStorageAdapterInterface extends StorageAdapter {
  initialize(dirHandle?: FileSystemDirectoryHandle): Promise<void>;
  loadEdgesForNodes(nodeIds: Set<string>): Promise<GraphEdge[]>;
  loadAllEdges(): Promise<GraphEdge[]>;
  getNodePosition(nodeId: string): NodePositionIndex | undefined;
  getNodePositionsInBounds(bounds: ViewportBounds): NodePositionIndex[];
  updateNodePositionInIndex(nodeId: string, x: number, y: number, width?: number, height?: number): void;
  getAllSpatialIndex(): SpatialIndexEntry[];
  getExtendedMetadata(nodeId: string): SpatialIndexEntry | undefined;
  getAllNodeIds(): string[];
  restoreNode(): Promise<DeletedNodeEntry | null>;
  getDeletionStackSize(): number;
  pruneDeletionStack(maxAgeMs?: number): Promise<number>;
  pruneNodeArchive?(maxAgeMs?: number): Promise<number>; // Optional: only LocalStorageAdapter has archive
  saveNodeImmediate(node: GraphNode, edges?: GraphEdge[]): Promise<void>;
  flush(): Promise<void>;
}

// Deletion stack types for soft delete feature
export interface DeletedNodeEntry {
  /** Original node data with all metadata */
  node: GraphNode;
  /** Edges that were connected to this node */
  edges: GraphEdge[];
  /** Timestamp when the node was deleted (milliseconds since epoch) */
  deletedAt: number;
}

export interface DeletionStack {
  version: 1;
  entries: DeletedNodeEntry[];
}

// Re-export types from main types file for convenience
export type { GraphNode, GraphEdge, EmbeddedEdge, NodeColor };
export { NodeType };
