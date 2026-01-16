import { GraphNode, GraphEdge } from "../types";

/**
 * Clustering has been removed from the schema.
 * This function now returns nodes unchanged.
 * @deprecated Clustering is no longer supported
 */
export const performGreedyClustering = (
  nodes: GraphNode[],
  _edges: GraphEdge[],
  _zoom: number,
  _clusterRadiusPx: number = 100
): GraphNode[] => {
  return nodes;
};
