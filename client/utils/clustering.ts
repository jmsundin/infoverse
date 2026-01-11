import { GraphNode, GraphEdge, NodeType, ClusterMemberNode, ClusterInternalEdge } from "../types";
import { DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT } from "../constants";
import { cleanTitleMarkdown } from "./titleUtils";

export const performGreedyClustering = (
  nodes: GraphNode[],
  edges: GraphEdge[],
  zoom: number,
  clusterRadiusPx: number = 100 // Default radius
): GraphNode[] => {
  // If zoom is high enough, show details (disable clustering)
  // User suggestion: "When Zoom < 50%, do not return individual nodes."
  // 0.5 is a reasonable threshold.
  if (zoom >= 0.5) {
    return nodes;
  }

  // World radius for clustering
  const r = clusterRadiusPx / zoom;
  const rSq = r * r;

  const clusters: GraphNode[] = [];
  const assigned = new Set<string>();

  // Sort nodes to make clustering deterministic and prioritize "important" nodes if we had that metric.
  // Using ID for stability.
  const sortedNodes = [...nodes].sort((a, b) => a.id.localeCompare(b.id));

  for (const node of sortedNodes) {
    if (assigned.has(node.id)) continue;

    const clusterNodes = [node];
    assigned.add(node.id);

    for (const other of sortedNodes) {
      if (assigned.has(other.id)) continue;

      const dx = node.x - other.x;
      const dy = node.y - other.y;
      const distSq = dx * dx + dy * dy;

      if (distSq <= rSq) {
        clusterNodes.push(other);
        assigned.add(other.id);
      }
    }

    if (clusterNodes.length === 1) {
      clusters.push(node);
    } else {
      // Create supernode
      // Position is centroid of cluster members
      const avgX = clusterNodes.reduce((sum, n) => sum + n.x, 0) / clusterNodes.length;
      const avgY = clusterNodes.reduce((sum, n) => sum + n.y, 0) / clusterNodes.length;

      // Calculate bounding box for relative positioning
      const minX = Math.min(...clusterNodes.map(n => n.x));
      const maxX = Math.max(...clusterNodes.map(n => n.x));
      const minY = Math.min(...clusterNodes.map(n => n.y));
      const maxY = Math.max(...clusterNodes.map(n => n.y));

      const boundsWidth = maxX - minX || 1;  // Avoid division by zero
      const boundsHeight = maxY - minY || 1;

      // Create member node representations with relative positions
      const clusterMemberIds = new Set(clusterNodes.map(n => n.id));
      const clusterMemberNodes: ClusterMemberNode[] = clusterNodes.map(n => ({
        id: n.id,
        relativeX: (n.x - minX) / boundsWidth,
        relativeY: (n.y - minY) / boundsHeight,
        color: n.color || 'slate',
        title: cleanTitleMarkdown(n.title || n.content?.substring(0, 30) || ''),
      }));

      // Filter edges to only those between cluster members
      const clusterInternalEdges: ClusterInternalEdge[] = edges
        .filter(e => clusterMemberIds.has(e.source) && clusterMemberIds.has(e.target))
        .map(e => ({
          sourceId: e.source,
          targetId: e.target,
        }));

      const clusterNode: GraphNode = {
        id: `cluster-${node.id}`, // Use primary node ID to keep ID stable-ish
        type: NodeType.CLUSTER,
        x: avgX,
        y: avgY,
        content: `${clusterNodes.length} Nodes`,
        width: DEFAULT_NODE_WIDTH, // Could scale with count?
        height: DEFAULT_NODE_HEIGHT,
        clusterCount: clusterNodes.length,
        clusterIds: clusterNodes.map(n => n.id),
        clusterMemberNodes,
        clusterInternalEdges,
        color: 'slate' // Default color for clusters
      };
      clusters.push(clusterNode);
    }
  }

  return clusters;
};
