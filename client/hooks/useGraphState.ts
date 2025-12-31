import { useState, useCallback, useRef } from "react";
import { GraphNode, GraphEdge } from "../types";
import { createDefaultGraphNodes } from "../utils/graphUtils";

export const useGraphState = () => {
  const [nodes, setNodes] = useState<GraphNode[]>(createDefaultGraphNodes);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [currentScopeId, setCurrentScopeId] = useState<string | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  const [isGraphLoaded, setIsGraphLoaded] = useState(false);

  const setNodesCallback = useCallback((newNodes: GraphNode[] | ((prev: GraphNode[]) => GraphNode[])) => {
      setNodes(prev => {
          const resolved = typeof newNodes === 'function' ? newNodes(prev) : newNodes;
          // Deduplicate by ID
          return Array.from(new Map(resolved.map(n => [n.id, n])).values());
      });
  }, []);

  const setEdgesCallback = useCallback((newEdges: GraphEdge[] | ((prev: GraphEdge[]) => GraphEdge[])) => {
      setEdges(newEdges);
  }, []);

  return {
    nodes,
    setNodes,
    setNodesCallback,
    edges,
    setEdges,
    setEdgesCallback,
    currentScopeId,
    setCurrentScopeId,
    selectedNodeIds,
    setSelectedNodeIds,
    isGraphLoaded,
    setIsGraphLoaded,
  };
};

