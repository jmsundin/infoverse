import { useRef, useMemo, useCallback } from "react";
import { GraphNode, GraphEdge, ViewportTransform } from "../types";
import { debounce } from "../services/debounceService";
import {
  saveNodeToFile,
  getOutgoingEdges,
} from "../services/storageService";
import {
  saveNodesBatchToApi,
  saveEdgesToApi
} from "../services/apiStorageService";
import { useAuth } from "../context/AuthContext";
import { useStorage } from "../context/StorageContext";

export const usePersistence = (
  user: any,
  dirHandle: FileSystemDirectoryHandle | null
) => {
  // Get storage mode from context to determine if we should persist
  const { isAuthenticated } = useAuth();
  const { storageMode } = useStorage();

  const dirtyNodesByIdRef = useRef<Map<string, { node: GraphNode; skipEmbedding: boolean }>>(new Map());
  const edgesDirtyRef = useRef(false);

  const debouncedFlushSaves = useMemo(
    () =>
      debounce(
        async (
          nodesSnapshot: GraphNode[],
          edgesSnapshot: GraphEdge[],
          _currentViewTransform: ViewportTransform,
          _currentAutoGraphEnabled: boolean,
          _currentScopeId: string | null,
          _currentSelectedNodeIds: Set<string>
        ) => {
          const dirtyNodes = Array.from(dirtyNodesByIdRef.current.values());
          dirtyNodesByIdRef.current.clear();
          const edgesDirty = edgesDirtyRef.current;
          edgesDirtyRef.current = false;

          // In-memory mode: skip all persistence
          // Data is stored in the in-memory adapter via StorageContext
          if (storageMode === 'memory') {
            return;
          }

          // Save to file system (Master) - edges embedded in node files
          if (dirHandle) {
            // For dirty nodes, include their outgoing edges
            for (const { node } of dirtyNodes) {
              const outgoingEdges = getOutgoingEdges(node.id, edgesSnapshot);
              saveNodeToFile(dirHandle, node, outgoingEdges);
            }

            // If edges changed, we need to update all affected source nodes
            if (edgesDirty) {
              // Find all unique source nodes that have edges
              const sourceNodeIds = new Set(edgesSnapshot.map(e => e.source));

              // Save each source node with its updated edges
              for (const sourceId of sourceNodeIds) {
                const node = nodesSnapshot.find(n => n.id === sourceId);
                if (node) {
                  const outgoingEdges = getOutgoingEdges(node.id, edgesSnapshot);
                  saveNodeToFile(dirHandle, node, outgoingEdges);
                }
              }
            }
          }

          // Background cloud sync (when user is logged in)
          if (user && isAuthenticated) {
            if (dirtyNodes.length > 0) {
              // Non-blocking cloud save
              saveNodesBatchToApi(
                dirtyNodes.map(({ node, skipEmbedding }) => ({
                  ...(node as any),
                  skipEmbedding,
                }))
              ).catch(err => console.error("Cloud sync error (nodes):", err));
            }
            if (edgesDirty) {
              // Non-blocking cloud save
              saveEdgesToApi(edgesSnapshot)
                .catch(err => console.error("Cloud sync error (edges):", err));
            }
          }
        },
        500
      ),
    [dirHandle, user, storageMode, isAuthenticated]
  );

  const markNodeDirty = useCallback((node: GraphNode, skipEmbedding: boolean) => {
    dirtyNodesByIdRef.current.set(node.id, { node, skipEmbedding });
  }, []);

  const markEdgesDirty = useCallback(() => {
    edgesDirtyRef.current = true;
  }, []);

  return {
    debouncedFlushSaves,
    markNodeDirty,
    markEdgesDirty,
  };
};
