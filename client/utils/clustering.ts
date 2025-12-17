import { GraphNode, NodeType } from "../types";
import { DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT } from "../constants";

export const performGreedyClustering = (
  nodes: GraphNode[],
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
        color: 'slate' // Default color for clusters
      };
      clusters.push(clusterNode);
    }
  }

  return clusters;
};

