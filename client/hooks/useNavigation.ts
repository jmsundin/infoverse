import { useRef, useCallback, useEffect } from "react";
import { GraphNode, GraphEdge, ViewportTransform } from "../types";
import { fetchNodesInViewport } from "../services/apiStorageService";
import { DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT } from "../constants";

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

    if (lastViewportFetchKeyRef.current === fetchKey) return;

    const now = Date.now();
    if (now - lastViewportFetchAtRef.current < 800) return;
    lastViewportFetchAtRef.current = now;
    lastViewportFetchKeyRef.current = fetchKey;

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

      if (newNodes) setNodes(newNodes);
      if (newEdges) setEdges(newEdges);
    } catch (e) {
      if ((e as any)?.name !== "AbortError") {
        console.error("Viewport fetch failed", e);
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
    setCurrentScopeId(nodeId);
    setSelectedNodeIds(new Set());
  }, [setCurrentScopeId, setSelectedNodeIds]);

  const handleNavigateUp = useCallback(
    (exitingScopeId?: string) => {
      if (exitingScopeId) {
        const exitingNode = nodes.find((n) => n.id === exitingScopeId);
        if (exitingNode) {
          setCurrentScopeId(exitingNode.parentId || null);
          setSelectedNodeIds(new Set([exitingNode.id]));
          const k = 1.0;
          const nodeCenterX = exitingNode.x + (exitingNode.width || DEFAULT_NODE_WIDTH) / 2;
          const nodeCenterY = exitingNode.y + (exitingNode.height || DEFAULT_NODE_HEIGHT) / 2;
          const newX = window.innerWidth / 2 - nodeCenterX * k;
          const newY = window.innerHeight / 2 - nodeCenterY * k;
          setViewTransform({ x: newX, y: newY, k });
          return;
        }
      }

      if (currentScopeId) {
        const currentNode = nodes.find((n) => n.id === currentScopeId);
        setCurrentScopeId(currentNode?.parentId || null);
        if (currentNode) setSelectedNodeIds(new Set([currentNode.id]));
      }
    },
    [currentScopeId, nodes, setCurrentScopeId, setSelectedNodeIds, setViewTransform]
  );

  const handleFocusNode = useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return;

      if ((node.parentId ?? null) !== (currentScopeId ?? null)) {
        setCurrentScopeId(node.parentId || null);
      }

      setSelectedNodeIds(new Set([nodeId]));

      const k = 1;
      const nodeCenterX = node.x + (node.width || DEFAULT_NODE_WIDTH) / 2;
      const nodeCenterY = node.y + (node.height || DEFAULT_NODE_HEIGHT) / 2;
      const newX = window.innerWidth / 2 - nodeCenterX * k;
      const newY = window.innerHeight / 2 - nodeCenterY * k;

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

