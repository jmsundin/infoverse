import { GraphNode, GraphEdge, EmbeddedEdge, ChatMessage, NodeType, NodeColor } from '../../types';

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
}

export const DEFAULT_STORAGE_CONFIG: StorageConfig = {
  localEnabled: false,
  cloudEnabled: false,
  inMemoryOnly: true, // Default to in-memory until authenticated
  viewportBufferMultiplier: 1.5,
  regionGridSize: 1000,
  syncDebounceMs: 2000,
  maxCacheSize: 500,
};

// Events emitted by the storage service
export type StorageEventType =
  | 'nodes-updated'
  | 'edges-updated'
  | 'sync-conflict'
  | 'save-error'
  | 'loading-start'
  | 'loading-complete';

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
  visual: { color?: NodeColor; type: NodeType };
  metadata: {
    scopeId?: string;
    parentId?: string;
    link?: string;
    summary?: string;
    autoExpandDepth?: number;
    clusterCount?: number;
    clusterIds?: string[];
  };

  // Text CRDT
  content: string;

  // Set CRDTs (arrays with deduplication)
  aliases: string[];
  edges: EmbeddedEdge[];
  messages: ChatMessage[];
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

// Re-export types from main types file for convenience
export type { GraphNode, GraphEdge, EmbeddedEdge, ChatMessage, NodeColor };
export { NodeType };
