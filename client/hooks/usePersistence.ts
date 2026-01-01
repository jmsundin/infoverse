import { useRef, useMemo, useCallback } from "react";
import { GraphNode, GraphEdge, ViewportTransform } from "../types";
import { debounce } from "../services/debounceService";
import {
  scheduleSaveNode,
  getOutgoingEdges,
} from "../services/storageService";
import {
  saveNodesBatchToApi,
  saveEdgesToApi
} from "../services/apiStorageService";

export const usePersistence = (
  user: any,
  dirHandle: FileSystemDirectoryHandle | null
) => {
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

          // Save to file system (Master) - edges embedded in node files
          if (dirHandle) {
            // For dirty nodes, include their outgoing edges
            for (const { node } of dirtyNodes) {
              const outgoingEdges = getOutgoingEdges(node.id, edgesSnapshot);
              scheduleSaveNode(dirHandle, node, outgoingEdges);
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
                  scheduleSaveNode(dirHandle, node, outgoingEdges);
                }
              }
            }
          }

          // Background cloud sync (when user is logged in)
          if (user) {
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
        2000
      ),
    [dirHandle, user]
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
