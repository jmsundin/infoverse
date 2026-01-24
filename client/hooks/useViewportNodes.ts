import { useMemo, useState, useEffect, useRef } from "react";
import { GraphNode, ViewportTransform } from "../types";
import { DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT } from "../constants";

interface UseViewportNodesOptions {
  nodes: GraphNode[];
  viewTransform: ViewportTransform;
  containerWidth: number;
  containerHeight: number;
  debounceMs?: number;
}

interface UseViewportNodesResult {
  viewportNodeIds: Set<string>;
  hasViewportNodes: boolean;
}

export function useViewportNodes(
  options: UseViewportNodesOptions
): UseViewportNodesResult {
  const {
    nodes,
    viewTransform,
    containerWidth,
    containerHeight,
    debounceMs = 200,
  } = options;

  // Track debounced viewport node IDs
  const [debouncedViewportNodeIds, setDebouncedViewportNodeIds] = useState<
    Set<string>
  >(new Set());

  // Debounce timer ref
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Calculate viewport bounds (same logic as Canvas.tsx)
  const viewportBounds = useMemo(() => {
    const k = viewTransform.k || 0.1;
    return {
      vpX: -viewTransform.x / k,
      vpY: -viewTransform.y / k,
      vpW: containerWidth / k,
      vpH: containerHeight / k,
    };
  }, [
    viewTransform.x,
    viewTransform.y,
    viewTransform.k,
    containerWidth,
    containerHeight,
  ]);

  // Calculate viewport nodes immediately
  const immediateViewportNodeIds = useMemo(() => {
    const { vpX, vpY, vpW, vpH } = viewportBounds;
    const ids = new Set<string>();

    for (const node of nodes) {
      // Skip nodes with invalid coordinates
      if (
        typeof node.x !== "number" ||
        typeof node.y !== "number" ||
        isNaN(node.x) ||
        isNaN(node.y)
      ) {
        continue;
      }

      const nW = node.width ?? DEFAULT_NODE_WIDTH;
      const nH = node.height ?? DEFAULT_NODE_HEIGHT;

      // AABB intersection test
      if (
        node.x < vpX + vpW &&
        node.x + nW > vpX &&
        node.y < vpY + vpH &&
        node.y + nH > vpY
      ) {
        ids.add(node.id);
      }
    }

    return ids;
  }, [nodes, viewportBounds]);

  // Debounced update
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      setDebouncedViewportNodeIds(immediateViewportNodeIds);
    }, debounceMs);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [immediateViewportNodeIds, debounceMs]);

  return {
    viewportNodeIds: debouncedViewportNodeIds,
    hasViewportNodes: debouncedViewportNodeIds.size > 0,
  };
}
