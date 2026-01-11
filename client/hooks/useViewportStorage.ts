import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { GraphNode, GraphEdge, ViewportTransform } from '../types';
import {
  UnifiedStorageService,
  ViewportBounds,
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
  flush: () => Promise<void>;
  refresh: () => Promise<void>;

  // For compatibility with existing code
  markNodeDirty: (node: GraphNode, skipEmbedding: boolean) => void;
  markEdgesDirty: () => void;
}

/**
 * Hook for viewport-based storage that can replace usePersistence.
 *
 * This hook manages:
 * - Viewport-based lazy loading of nodes
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
    bufferMultiplier = 1.5,
    debounceMs = 150,
  } = options;

  const serviceRef = useRef<UnifiedStorageService | null>(null);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  // Calculate viewport bounds from transform
  const viewportBounds = useMemo((): ViewportBounds | null => {
    if (!containerWidth || !containerHeight) return null;

    const k = viewTransform.k || 0.1;
    const vpX = -viewTransform.x / k;
    const vpY = -viewTransform.y / k;
    const vpW = containerWidth / k;
    const vpH = containerHeight / k;

    return {
      minX: vpX,
      minY: vpY,
      maxX: vpX + vpW,
      maxY: vpY + vpH,
    };
  }, [viewTransform.x, viewTransform.y, viewTransform.k, containerWidth, containerHeight]);

  // Initialize service
  useEffect(() => {
    if (!enabled) return;

    const service = new UnifiedStorageService({
      viewportBufferMultiplier: bufferMultiplier,
      syncDebounceMs: 2000,
    });
    serviceRef.current = service;

    // Listen for events
    const handleNodesUpdated = () => {
      setNodes(service.getAllCachedNodes());
    };

    const handleEdgesUpdated = () => {
      setEdges(service.getAllCachedEdges());
    };

    const handleLoadingStart = () => setIsLoading(true);
    const handleLoadingComplete = () => setIsLoading(false);

    service.addEventListener('nodes-updated', handleNodesUpdated);
    service.addEventListener('edges-updated', handleEdgesUpdated);
    service.addEventListener('loading-start', handleLoadingStart);
    service.addEventListener('loading-complete', handleLoadingComplete);

    // Initialize with handles
    service.initialize(dirHandle || undefined, userId || undefined).then(() => {
      setIsInitialized(true);
    });

    return () => {
      service.removeEventListener('nodes-updated', handleNodesUpdated);
      service.removeEventListener('edges-updated', handleEdgesUpdated);
      service.removeEventListener('loading-start', handleLoadingStart);
      service.removeEventListener('loading-complete', handleLoadingComplete);
      service.dispose();
      serviceRef.current = null;
    };
  }, [enabled, dirHandle, userId, bufferMultiplier]);

  // Create debounced viewport load
  const debouncedLoadViewport = useMemo(
    () =>
      debounce(async (bounds: ViewportBounds) => {
        if (!serviceRef.current || !isInitialized) return;
        await serviceRef.current.loadViewport(bounds);
      }, debounceMs),
    [isInitialized, debounceMs]
  );

  // Load viewport when it changes
  useEffect(() => {
    if (!enabled || !isInitialized || !viewportBounds) return;
    debouncedLoadViewport(viewportBounds);
  }, [enabled, isInitialized, viewportBounds, debouncedLoadViewport]);

  // Actions
  const updateNode = useCallback((node: GraphNode, skipEmbedding = false) => {
    if (!serviceRef.current) return;
    serviceRef.current.updateNode(node, skipEmbedding);
  }, []);

  const addNode = useCallback((node: GraphNode, skipEmbedding = false) => {
    if (!serviceRef.current) return;
    serviceRef.current.addNode(node, skipEmbedding);
  }, []);

  const deleteNode = useCallback(async (nodeId: string) => {
    if (!serviceRef.current) return;
    await serviceRef.current.deleteNode(nodeId);
  }, []);

  const updateEdges = useCallback((newEdges: GraphEdge[]) => {
    if (!serviceRef.current) return;
    serviceRef.current.updateEdges(newEdges);
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
