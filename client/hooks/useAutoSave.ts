import { useEffect, useRef, useMemo } from 'react';
import { useStore } from './useAppStore';
import { AppState, Action } from '../store';
import { GraphNode, GraphEdge } from '../types';
import { debounce } from '../services/debounceService';
import {
  saveNodeToFile,
  getOutgoingEdges,
} from '../services/storageService';
import {
  saveNodesBatchToApi,
  saveEdgesToApi,
} from '../services/apiStorageService';

// Actions that mutate nodes
const NODE_MUTATING_ACTIONS = new Set([
  'NODES_SET',
  'NODES_ADD',
  'NODE_UPDATE',
  'NODES_MERGE',
  'RESTORE_NODES',
  'GRAPH_LOAD_FROM_STORAGE',
]);

// Actions that mutate edges
const EDGE_MUTATING_ACTIONS = new Set([
  'EDGES_SET',
  'EDGE_ADD',
  'EDGES_ADD',
  'RESTORE_NODES',
  'GRAPH_LOAD_FROM_STORAGE',
]);

/**
 * Subscribes to the store and persists node/edge changes to filesystem + cloud.
 * Replaces the old usePersistence hook.
 */
export function useAutoSave() {
  const store = useStore();
  const dirtyNodesByIdRef = useRef<Map<string, { node: GraphNode; skipEmbedding: boolean }>>(new Map());
  const edgesDirtyRef = useRef(false);
  const prevNodesRef = useRef<GraphNode[]>(store.getState().nodes);

  const debouncedFlush = useMemo(
    () =>
      debounce(async () => {
        const state = store.getState();
        const { dirHandle, user, storageMode } = state;

        const dirtyNodes = Array.from(dirtyNodesByIdRef.current.values());
        dirtyNodesByIdRef.current.clear();
        const edgesDirty = edgesDirtyRef.current;
        edgesDirtyRef.current = false;

        // In-memory mode: skip all persistence
        if (storageMode === 'memory') return;

        // Save to file system (Master)
        if (dirHandle) {
          for (const { node } of dirtyNodes) {
            const outgoingEdges = getOutgoingEdges(node.id, state.edges);
            saveNodeToFile(dirHandle, node, outgoingEdges);
          }

          if (edgesDirty) {
            const sourceNodeIds = new Set(state.edges.map((e) => e.source));
            for (const sourceId of sourceNodeIds) {
              const node = state.nodes.find((n) => n.id === sourceId);
              if (node) {
                const outgoingEdges = getOutgoingEdges(node.id, state.edges);
                saveNodeToFile(dirHandle, node, outgoingEdges);
              }
            }
          }
        }

        // Background cloud sync
        if (user) {
          if (dirtyNodes.length > 0) {
            saveNodesBatchToApi(
              dirtyNodes.map(({ node, skipEmbedding }) => ({
                ...(node as any),
                skipEmbedding,
              }))
            ).catch((err) => console.error('Cloud sync error (nodes):', err));
          }
          if (edgesDirty) {
            saveEdgesToApi(state.edges).catch((err) =>
              console.error('Cloud sync error (edges):', err)
            );
          }
        }
      }, 500),
    [store]
  );

  useEffect(() => {
    const unsubscribe = store.subscribe((state: AppState, action: Action) => {
      if (NODE_MUTATING_ACTIONS.has(action.type)) {
        // Determine which nodes changed by comparing with previous snapshot
        const prevById = new Map(prevNodesRef.current.map((n) => [n.id, n]));

        for (const n of state.nodes) {
          const p = prevById.get(n.id);
          if (!p || p !== n) {
            const semanticChanged =
              !p ||
              p.content !== n.content ||
              p.summary !== n.summary ||
              JSON.stringify(p.aliases || []) !== JSON.stringify(n.aliases || []);
            dirtyNodesByIdRef.current.set(n.id, { node: n, skipEmbedding: !semanticChanged });
          }
        }

        prevNodesRef.current = state.nodes;
        debouncedFlush();
      }

      if (EDGE_MUTATING_ACTIONS.has(action.type)) {
        edgesDirtyRef.current = true;
        debouncedFlush();
      }
    });

    return unsubscribe;
  }, [store, debouncedFlush]);
}
