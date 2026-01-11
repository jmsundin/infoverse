import { useState, useEffect, useCallback, useRef } from 'react';
import { GraphNode, GraphEdge } from '../types';
import { ViewportBounds, ViewportLoadResult } from '../services/storage';
import { useStorage } from '../context/StorageContext';
import { debounce } from '../services/debounceService';

/**
 * Hook for accessing the unified storage service
 */
export function useUnifiedStorage() {
  return useStorage();
}

/**
 * Hook for viewport-based node loading with debouncing
 */
export function useViewportNodes(
  viewport: ViewportBounds | null,
  options: {
    debounceMs?: number;
    enabled?: boolean;
  } = {}
) {
  const { debounceMs = 150, enabled = true } = options;
  const { loadViewport, getNodesInViewport, getEdgesInViewport, isLoading } =
    useStorage();

  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [loading, setLoading] = useState(false);

  // Create debounced load function
  const debouncedLoadRef = useRef<ReturnType<typeof debounce> | null>(null);

  useEffect(() => {
    debouncedLoadRef.current = debounce(async (bounds: ViewportBounds) => {
      setLoading(true);
      try {
        const result = await loadViewport(bounds);
        setNodes(result.nodes);
        setEdges(result.edges);
      } finally {
        setLoading(false);
      }
    }, debounceMs);

    return () => {
      // Cleanup would go here if debounce returned a cancel function
    };
  }, [loadViewport, debounceMs]);

  useEffect(() => {
    if (!viewport || !enabled) return;

    // Get cached data immediately
    setNodes(getNodesInViewport(viewport));
    setEdges(getEdgesInViewport(viewport));

    // Trigger debounced fetch for any missing data
    if (debouncedLoadRef.current) {
      debouncedLoadRef.current(viewport);
    }
  }, [viewport, enabled, getNodesInViewport, getEdgesInViewport]);

  return {
    nodes,
    edges,
    loading: loading || isLoading,
  };
}

/**
 * Hook for subscribing to a specific node's updates
 */
export function useNodeSubscription(nodeId: string | null) {
  const { service } = useStorage();
  const [node, setNode] = useState<GraphNode | null>(null);

  useEffect(() => {
    if (!nodeId || !service) return;

    // Get initial node
    service.getNode(nodeId).then(setNode);

    // Subscribe to updates
    const handleUpdate = (e: CustomEvent) => {
      const updatedNodes = e.detail.nodes as GraphNode[] | undefined;
      if (updatedNodes) {
        const updated = updatedNodes.find((n) => n.id === nodeId);
        if (updated) {
          setNode(updated);
        }
      }
    };

    service.addEventListener('nodes-updated', handleUpdate as EventListener);

    return () => {
      service.removeEventListener('nodes-updated', handleUpdate as EventListener);
    };
  }, [nodeId, service]);

  return node;
}

/**
 * Hook for batch node operations
 */
export function useBatchNodeOperations() {
  const { updateNode, addNode, deleteNode, flush } = useStorage();

  const batchUpdate = useCallback(
    async (nodes: GraphNode[], skipEmbedding = false) => {
      for (const node of nodes) {
        updateNode(node, skipEmbedding);
      }
      await flush();
    },
    [updateNode, flush]
  );

  const batchAdd = useCallback(
    async (nodes: GraphNode[], skipEmbedding = false) => {
      for (const node of nodes) {
        addNode(node, skipEmbedding);
      }
      await flush();
    },
    [addNode, flush]
  );

  const batchDelete = useCallback(
    async (nodeIds: string[]) => {
      for (const nodeId of nodeIds) {
        await deleteNode(nodeId);
      }
    },
    [deleteNode]
  );

  return {
    batchUpdate,
    batchAdd,
    batchDelete,
  };
}

/**
 * Hook for storage statistics (useful for debugging)
 */
export function useStorageStats() {
  const { service, isInitialized } = useStorage();
  const [stats, setStats] = useState({
    nodeCount: 0,
    edgeCount: 0,
    ghostNodeCount: 0,
    fetchedCellCount: 0,
    yjsDocCount: 0,
  });

  useEffect(() => {
    if (!isInitialized || !service) return;

    const updateStats = () => {
      setStats(service.getCacheStats());
    };

    updateStats();

    // Update stats on changes
    service.addEventListener('nodes-updated', updateStats);
    service.addEventListener('edges-updated', updateStats);

    return () => {
      service.removeEventListener('nodes-updated', updateStats);
      service.removeEventListener('edges-updated', updateStats);
    };
  }, [service, isInitialized]);

  return stats;
}
