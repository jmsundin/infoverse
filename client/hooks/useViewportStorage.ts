import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { GraphNode, GraphEdge, ViewportTransform, NodeLoadState } from '../types';
import {
  UnifiedStorageService,
  ViewportBounds,
  SpatialIndexEntry,
} from '../services/storage';
import { debounce } from '../services/debounceService';

interface UseViewportStorageOptions {
  enabled: boolean;
  dirHandle: FileSystemDirectoryHandle | null;
  userId: string | null;
  viewTransform: ViewportTransform;
  containerWidth: number;
  containerHeight: number;
  bufferMultiplier?: number;
  debounceMs?: number;
}

interface UseViewportStorageReturn {
  // State
  nodes: GraphNode[];
  edges: GraphEdge[];
  isLoading: boolean;
  isInitialized: boolean;

  // Actions
  updateNode: (node: GraphNode, skipEmbedding?: boolean) => void;
  addNode: (node: GraphNode, skipEmbedding?: boolean) => void;
  deleteNode: (nodeId: string) => Promise<void>;
  updateEdges: (edges: GraphEdge[]) => void;
  setNodes: React.Dispatch<React.SetStateAction<GraphNode[]>>;
  setEdges: React.Dispatch<React.SetStateAction<GraphEdge[]>>;
  flush: () => Promise<void>;
  refresh: () => Promise<void>;

  // For compatibility with existing code
  markNodeDirty: (node: GraphNode, skipEmbedding: boolean) => void;
  markEdgesDirty: () => void;
}

/**
 * Convert spatial index entry to a skeleton node
 */
function spatialIndexToSkeletonNode(entry: SpatialIndexEntry): GraphNode {
  return {
    id: entry.id,
    type: entry.type,
    x: entry.x,
    y: entry.y,
    width: entry.width,
    height: entry.height,
    content: entry.title || '',
    title: entry.title,
    color: entry.color,
    scopeId: entry.scopeId,
    _loadState: 'position-only' as NodeLoadState,
  };
}

/**
 * Hook for viewport-based storage with two-phase loading.
 *
 * Phase 1: Load spatial index (positions only) on initialization
 * Phase 2: Load full content when nodes enter viewport
 *
 * This hook manages:
 * - Two-phase lazy loading of nodes
 * - Skeleton placeholders for unloaded nodes
 * - CRDT-based sync between local and cloud
 * - Debounced saves
 */
export function useViewportStorage(
  options: UseViewportStorageOptions
): UseViewportStorageReturn {
  const {
    enabled,
    dirHandle,
    userId,
    viewTransform,
    containerWidth,
    containerHeight,
    bufferMultiplier = 1.3,
    debounceMs = 150,
  } = options;

  const serviceRef = useRef<UnifiedStorageService | null>(null);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  // Track which nodes are currently being loaded to avoid duplicate requests
  const loadingNodeIdsRef = useRef<Set<string>>(new Set());

  // Calculate viewport bounds from transform with buffer
  const viewportBounds = useMemo((): ViewportBounds | null => {
    if (!containerWidth || !containerHeight) return null;

    const k = viewTransform.k || 0.1;
    const vpX = -viewTransform.x / k;
    const vpY = -viewTransform.y / k;
    const vpW = containerWidth / k;
    const vpH = containerHeight / k;

    // Apply buffer for prefetching
    const bufferW = vpW * (bufferMultiplier - 1) / 2;
    const bufferH = vpH * (bufferMultiplier - 1) / 2;

    return {
      minX: vpX - bufferW,
      minY: vpY - bufferH,
      maxX: vpX + vpW + bufferW,
      maxY: vpY + vpH + bufferH,
    };
  }, [viewTransform.x, viewTransform.y, viewTransform.k, containerWidth, containerHeight, bufferMultiplier]);

  // Initialize service and load spatial index (Phase 1)
  useEffect(() => {
    if (!enabled) return;

    const service = new UnifiedStorageService({
      viewportBufferMultiplier: bufferMultiplier,
      syncDebounceMs: 2000,
    });
    serviceRef.current = service;

    const handleLoadingStart = () => setIsLoading(true);
    const handleLoadingComplete = () => setIsLoading(false);

    service.addEventListener('loading-start', handleLoadingStart);
    service.addEventListener('loading-complete', handleLoadingComplete);

    // Initialize and load spatial index
    const init = async () => {
      await service.initialize(dirHandle || undefined, userId || undefined);

      // Phase 1: Load spatial index (positions only)
      const spatialIndex = await service.loadSpatialIndex();

      // Convert to skeleton nodes
      const skeletonNodes = spatialIndex.map(spatialIndexToSkeletonNode);
      setNodes(skeletonNodes);

      // Load all edges (we need them even for skeleton nodes)
      const allEdges = await service.loadAllEdges();
      setEdges(allEdges);

      setIsInitialized(true);
    };

    init();

    return () => {
      service.removeEventListener('loading-start', handleLoadingStart);
      service.removeEventListener('loading-complete', handleLoadingComplete);
      service.dispose();
      serviceRef.current = null;
    };
  }, [enabled, dirHandle, userId, bufferMultiplier]);

  // Phase 2: Load content for nodes in viewport
  const loadNodesInViewport = useCallback(async (bounds: ViewportBounds) => {
    if (!serviceRef.current || !isInitialized) return;

    // Find skeleton nodes in viewport that need loading
    const nodesNeedingLoad = nodes.filter(node => {
      // Skip if already loaded or currently loading
      if (node._loadState === 'loaded' || node._loadState === 'loading') return false;
      if (loadingNodeIdsRef.current.has(node.id)) return false;

      // Check if node intersects viewport
      const nodeRight = node.x + (node.width || 300);
      const nodeBottom = node.y + (node.height || 200);

      return (
        node.x < bounds.maxX &&
        nodeRight > bounds.minX &&
        node.y < bounds.maxY &&
        nodeBottom > bounds.minY
      );
    });

    if (nodesNeedingLoad.length === 0) return;

    // Mark nodes as loading
    const nodeIdsToLoad = nodesNeedingLoad.map(n => n.id);
    nodeIdsToLoad.forEach(id => loadingNodeIdsRef.current.add(id));

    setNodes(prev => prev.map(n =>
      nodeIdsToLoad.includes(n.id)
        ? { ...n, _loadState: 'loading' as NodeLoadState }
        : n
    ));

    try {
      // Fetch full content
      const loadedNodes = await serviceRef.current.loadNodeContent(nodeIdsToLoad);

      // Update state with loaded content
      setNodes(prev => prev.map(n => {
        const loaded = loadedNodes.find(ln => ln.id === n.id);
        if (loaded) {
          return { ...loaded, _loadState: 'loaded' as NodeLoadState };
        }
        // If loading failed, mark as error
        if (nodeIdsToLoad.includes(n.id) && n._loadState === 'loading') {
          return { ...n, _loadState: 'error' as NodeLoadState, _loadError: 'Failed to load' };
        }
        return n;
      }));
    } finally {
      // Clear loading tracking
      nodeIdsToLoad.forEach(id => loadingNodeIdsRef.current.delete(id));
    }
  }, [nodes, isInitialized]);

  // Create debounced viewport load
  const debouncedLoadViewport = useMemo(
    () => debounce(loadNodesInViewport, debounceMs),
    [loadNodesInViewport, debounceMs]
  );

  // Trigger content loading when viewport changes
  useEffect(() => {
    if (!enabled || !isInitialized || !viewportBounds) return;
    debouncedLoadViewport(viewportBounds);
  }, [enabled, isInitialized, viewportBounds, debouncedLoadViewport]);

  // Actions
  const updateNode = useCallback((node: GraphNode, skipEmbedding = false) => {
    if (!serviceRef.current) return;
    serviceRef.current.updateNode(node, skipEmbedding);

    // Update local state
    setNodes(prev => prev.map(n => n.id === node.id ? { ...node, _loadState: 'loaded' as NodeLoadState } : n));
  }, []);

  const addNode = useCallback((node: GraphNode, skipEmbedding = false) => {
    if (!serviceRef.current) return;
    serviceRef.current.addNode(node, skipEmbedding);

    // Add to local state as loaded
    setNodes(prev => [...prev, { ...node, _loadState: 'loaded' as NodeLoadState }]);
  }, []);

  const deleteNode = useCallback(async (nodeId: string) => {
    if (!serviceRef.current) return;
    await serviceRef.current.deleteNode(nodeId);

    // Remove from local state
    setNodes(prev => prev.filter(n => n.id !== nodeId));
    setEdges(prev => prev.filter(e => e.source !== nodeId && e.target !== nodeId));
  }, []);

  const updateEdges = useCallback((newEdges: GraphEdge[]) => {
    if (!serviceRef.current) return;
    serviceRef.current.updateEdges(newEdges);
    setEdges(newEdges);
  }, []);

  const flush = useCallback(async () => {
    if (!serviceRef.current) return;
    await serviceRef.current.flush();
  }, []);

  const refresh = useCallback(async () => {
    if (!serviceRef.current || !viewportBounds) return;
    await serviceRef.current.refresh(viewportBounds);
  }, [viewportBounds]);

  // Compatibility with existing usePersistence interface
  const markNodeDirty = useCallback((node: GraphNode, skipEmbedding: boolean) => {
    updateNode(node, skipEmbedding);
  }, [updateNode]);

  const markEdgesDirty = useCallback(() => {
    // Edges are tracked automatically, this is a no-op for compatibility
  }, []);

  return {
    nodes,
    edges,
    isLoading,
    isInitialized,
    updateNode,
    addNode,
    deleteNode,
    updateEdges,
    setNodes,
    setEdges,
    flush,
    refresh,
    markNodeDirty,
    markEdgesDirty,
  };
}

/**
 * Feature flag for enabling viewport-based storage
 */
export const USE_VIEWPORT_STORAGE = true; // Set to true to enable new storage system
