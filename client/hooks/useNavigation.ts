import { useRef, useCallback, useEffect } from "react";
import { GraphNode, GraphEdge, ViewportTransform } from "../types";
import { fetchNodesInViewport } from "../services/apiStorageService";
import { DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT } from "../constants";
import {
  summarizeTransform,
  viewportDebugLog,
} from "../utils/viewportDebug";

export const useNavigation = (
  nodes: GraphNode[],
  currentScopeId: string | null,
  setCurrentScopeId: (id: string | null) => void,
  setSelectedNodeIds: (ids: Set<string>) => void,
  viewTransform: ViewportTransform,
  setViewTransform: (t: ViewportTransform) => void,
  setNodes: (nodes: GraphNode[]) => void,
  setEdges: (edges: GraphEdge[]) => void,
  user: any,
  dirName: string | null
) => {
  const fetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewportFetchAbortRef = useRef<AbortController | null>(null);
  const lastViewportFetchKeyRef = useRef<string | null>(null);
  const lastViewportFetchAtRef = useRef<number>(0);

  const fetchViewportNodes = useCallback(async () => {
    if (!user || dirName !== "Cloud Storage") return;

    const { x, y, k } = viewTransform;
    if (!k || k === 0) return;

    const width = window.innerWidth;
    const height = window.innerHeight;

    const minX = -x / k;
    const minY = -y / k;
    const maxX = (width - x) / k;
    const maxY = (height - y) / k;

    const w = maxX - minX;
    const h = maxY - minY;
    const bufferX = w * 0.2;
    const bufferY = h * 0.2;

    const bufferedMinX = minX - bufferX;
    const bufferedMinY = minY - bufferY;
    const bufferedMaxX = maxX + bufferX;
    const bufferedMaxY = maxY + bufferY;

    const quantizeStepX = Math.max(w * 0.25, 1);
    const quantizeStepY = Math.max(h * 0.25, 1);
    const q = (v: number, step: number) => Math.round(v / step) * step;
    const fetchKey = [
      q(bufferedMinX, quantizeStepX),
      q(bufferedMinY, quantizeStepY),
      q(bufferedMaxX, quantizeStepX),
      q(bufferedMaxY, quantizeStepY),
      Math.round(k * 1000) / 1000,
    ].join("|");

    if (lastViewportFetchKeyRef.current === fetchKey) {
      viewportDebugLog("navigation.viewport-fetch-skip-same-key", {
        fetchKey,
        transform: summarizeTransform(viewTransform),
      });
      return;
    }

    const now = Date.now();
    if (now - lastViewportFetchAtRef.current < 800) {
      viewportDebugLog("navigation.viewport-fetch-skip-rate-limit", {
        fetchKey,
        elapsedMs: now - lastViewportFetchAtRef.current,
      });
      return;
    }
    lastViewportFetchAtRef.current = now;
    lastViewportFetchKeyRef.current = fetchKey;

    viewportDebugLog("navigation.viewport-fetch-start", {
      fetchKey,
      bounds: {
        minX: Number(bufferedMinX.toFixed(2)),
        minY: Number(bufferedMinY.toFixed(2)),
        maxX: Number(bufferedMaxX.toFixed(2)),
        maxY: Number(bufferedMaxY.toFixed(2)),
      },
      transform: summarizeTransform(viewTransform),
    });

    try {
      if (viewportFetchAbortRef.current) {
        viewportFetchAbortRef.current.abort();
      }
      const controller = new AbortController();
      viewportFetchAbortRef.current = controller;

      const { nodes: newNodes, edges: newEdges } = await fetchNodesInViewport(
        bufferedMinX,
        bufferedMinY,
        bufferedMaxX,
        bufferedMaxY,
        controller.signal
      );

      viewportDebugLog("navigation.viewport-fetch-complete", {
        fetchKey,
        nodeCount: newNodes?.length ?? 0,
        edgeCount: newEdges?.length ?? 0,
      });

      if (newNodes) setNodes(newNodes);
      if (newEdges) setEdges(newEdges);
    } catch (e) {
      if ((e as any)?.name !== "AbortError") {
        console.error("Viewport fetch failed", e);
        viewportDebugLog("navigation.viewport-fetch-error", {
          fetchKey,
          message: (e as Error)?.message || "unknown",
        });
      }
    }
  }, [viewTransform, user, dirName, setNodes, setEdges]);

  useEffect(() => {
    if (!user || dirName !== "Cloud Storage") return;
    if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current);
    fetchTimeoutRef.current = setTimeout(() => {
      fetchViewportNodes();
    }, 600);
    return () => {
      if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current);
    };
  }, [viewTransform, user, dirName, fetchViewportNodes]);

  const handleNavigateDown = useCallback((nodeId: string) => {
    viewportDebugLog("navigation.down", {
      nodeId,
      previousScopeId: currentScopeId,
    });
    setCurrentScopeId(nodeId);
    setSelectedNodeIds(new Set());
  }, [currentScopeId, setCurrentScopeId, setSelectedNodeIds]);

  const handleNavigateUp = useCallback(
    (exitingScopeId?: string) => {
      if (exitingScopeId) {
        const exitingNode = nodes.find((n) => n.id === exitingScopeId);
        if (exitingNode) {
          setCurrentScopeId(exitingNode.scopeId || null);
          setSelectedNodeIds(new Set([exitingNode.id]));
          const k = 1.0;
          const nodeCenterX = exitingNode.x + (exitingNode.width || DEFAULT_NODE_WIDTH) / 2;
          const nodeCenterY = exitingNode.y + (exitingNode.height || DEFAULT_NODE_HEIGHT) / 2;
          const newX = window.innerWidth / 2 - nodeCenterX * k;
          const newY = window.innerHeight / 2 - nodeCenterY * k;
          viewportDebugLog("navigation.up-exit-node", {
            exitingScopeId,
            nextScopeId: exitingNode.scopeId || null,
            selectedNodeId: exitingNode.id,
            nextTransform: summarizeTransform({ x: newX, y: newY, k }),
          });
          setViewTransform({ x: newX, y: newY, k });
          return;
        }
      }

      if (currentScopeId) {
        const currentNode = nodes.find((n) => n.id === currentScopeId);
        viewportDebugLog("navigation.up-current-scope", {
          currentScopeId,
          nextScopeId: currentNode?.scopeId || null,
          selectedNodeId: currentNode?.id || null,
        });
        setCurrentScopeId(currentNode?.scopeId || null);
        if (currentNode) setSelectedNodeIds(new Set([currentNode.id]));
      }
    },
    [currentScopeId, nodes, setCurrentScopeId, setSelectedNodeIds, setViewTransform]
  );

  const handleFocusNode = useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return;

      if ((node.scopeId ?? null) !== (currentScopeId ?? null)) {
        setCurrentScopeId(node.scopeId || null);
      }

      setSelectedNodeIds(new Set([nodeId]));

      const k = 1;
      const nodeCenterX = node.x + (node.width || DEFAULT_NODE_WIDTH) / 2;
      const nodeCenterY = node.y + (node.height || DEFAULT_NODE_HEIGHT) / 2;
      const newX = window.innerWidth / 2 - nodeCenterX * k;
      const newY = window.innerHeight / 2 - nodeCenterY * k;

      viewportDebugLog("navigation.focus-node", {
        nodeId,
        scopeId: node.scopeId ?? null,
        currentScopeId,
        nextTransform: summarizeTransform({ x: newX, y: newY, k }),
      });

      setViewTransform({ x: newX, y: newY, k });
    },
    [nodes, currentScopeId, setCurrentScopeId, setSelectedNodeIds, setViewTransform]
  );

  return {
    handleNavigateDown,
    handleNavigateUp,
    handleFocusNode,
    fetchViewportNodes,
  };
};
