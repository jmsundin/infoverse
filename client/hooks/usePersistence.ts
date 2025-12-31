import { useRef, useMemo, useCallback } from "react";
import { GraphNode, GraphEdge, ViewportTransform } from "../types";
import { debounce } from "../services/debounceService";
import { 
  scheduleSaveNode, 
  scheduleSaveEdges 
} from "../services/storageService";
import { 
  saveNodesBatchToApi, 
  saveEdgesToApi 
} from "../services/apiStorageService";

const LOCAL_STORAGE_KEY = "wiki-graph-data";

export const usePersistence = (
  user: any,
  dirHandle: FileSystemDirectoryHandle | null
) => {
  const dirtyNodesByIdRef = useRef<Map<string, { node: GraphNode; skipEmbedding: boolean }>>(new Map());
  const edgesDirtyRef = useRef(false);

  const saveGraphToLocalStorage = useCallback(
    (
      nodesToSave: GraphNode[],
      edgesToSave: GraphEdge[],
      currentViewTransform: ViewportTransform,
      currentAutoGraphEnabled: boolean,
      currentScopeId: string | null,
      currentSelectedNodeIds: Set<string>
    ) => {
      if (typeof window === "undefined") return;
      const data = {
        nodes: nodesToSave,
        edges: edgesToSave,
        viewTransform: currentViewTransform,
        autoGraphEnabled: currentAutoGraphEnabled,
        currentScopeId: currentScopeId,
        selectedNodeIds: Array.from(currentSelectedNodeIds),
      };
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
    },
    []
  );

  const debouncedFlushSaves = useMemo(
    () =>
      debounce(
        async (
          nodesSnapshot: GraphNode[],
          edgesSnapshot: GraphEdge[],
          currentViewTransform: ViewportTransform,
          currentAutoGraphEnabled: boolean,
          currentScopeId: string | null,
          currentSelectedNodeIds: Set<string>
        ) => {
          // Save to local storage
          saveGraphToLocalStorage(
            nodesSnapshot,
            edgesSnapshot,
            currentViewTransform,
            currentAutoGraphEnabled,
            currentScopeId,
            currentSelectedNodeIds
          );

          const dirtyNodes = Array.from(dirtyNodesByIdRef.current.values());
          dirtyNodesByIdRef.current.clear();
          const edgesDirty = edgesDirtyRef.current;
          edgesDirtyRef.current = false;

          // Save to file system (Master)
          if (dirHandle) {
            for (const { node } of dirtyNodes) {
              scheduleSaveNode(dirHandle, node);
            }
            if (edgesDirty) {
              scheduleSaveEdges(dirHandle, edgesSnapshot);
            }
          }

          // Save to cloud (Secondary)
          if (user && !dirHandle) {
            if (dirtyNodes.length > 0) {
              await saveNodesBatchToApi(
                dirtyNodes.map(({ node, skipEmbedding }) => ({
                  ...(node as any),
                  skipEmbedding,
                }))
              );
            }
            if (edgesDirty) {
              saveEdgesToApi(edgesSnapshot);
            }
          }
        },
        2000
      ),
    [saveGraphToLocalStorage, dirHandle, user]
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

