import * as d3 from "d3";
import { GraphNode, GraphEdge } from "../types";
import {
  DEFAULT_NODE_WIDTH,
  DEFAULT_NODE_HEIGHT,
  PARENT_NODE_WIDTH,
  PARENT_NODE_HEIGHT,
} from "../constants";

const getId = (d: any): string => {
  return typeof d === "object" ? d.id : d;
};

const TREE_NODE_SIZE_TB: [number, number] = [
  PARENT_NODE_WIDTH + 50,
  PARENT_NODE_HEIGHT + 50,
];
const TREE_NODE_SIZE_LR: [number, number] = [
  100, // Vertical spacing between siblings (reduced for tighter layout)
  PARENT_NODE_WIDTH + 50,
];

/**
 * Apply tree layout positioning.
 * Returns nodes with updated x,y positions in a tree hierarchy.
 * Physics engine should be run after this for settling.
 */
export const applyTreeLayout = (
  nodes: GraphNode[],
  edges: GraphEdge[],
  direction: "TB" | "LR"
): GraphNode[] => {
  if (nodes.length === 0) return nodes;

  const nodeIds = new Set(nodes.map((n) => n.id));
  const filteredEdges = edges.filter(
    (e) => nodeIds.has(getId(e.source)) && nodeIds.has(getId(e.target))
  );

  const indegreeByNodeId = new Map<string, number>();
  const parentByTargetId = new Map<string, string>();
  for (const node of nodes) indegreeByNodeId.set(node.id, 0);
  for (const edge of filteredEdges) {
    const targetId = getId(edge.target);
    const sourceId = getId(edge.source);
    indegreeByNodeId.set(targetId, (indegreeByNodeId.get(targetId) ?? 0) + 1);
    if (!parentByTargetId.has(targetId))
      parentByTargetId.set(targetId, sourceId);
  }

  const rootCandidate = nodes.find(
    (n) => (indegreeByNodeId.get(n.id) ?? 0) === 0
  );
  const rootId = (rootCandidate?.id ?? nodes[0]?.id) as string;

  const stratify = d3
    .stratify<GraphNode>()
    .id((d) => d.id)
    .parentId((d) => {
      if (d.id === rootId) return null;
      return parentByTargetId.get(d.id) ?? rootId;
    });

  try {
    const root = stratify(nodes);
    const treeLayout = d3
      .tree<GraphNode>()
      .nodeSize(direction === "TB" ? TREE_NODE_SIZE_TB : TREE_NODE_SIZE_LR);

    treeLayout(root);

    const descendants = root.descendants();
    return nodes.map((n) => {
      const d = descendants.find((dn) => dn.id === n.id);
      return d
        ? {
            ...n,
            x:
              (direction === "TB" ? d.x : d.y) -
              (n.width || DEFAULT_NODE_WIDTH) / 2,
            y:
              (direction === "TB" ? d.y : d.x) -
              (n.height || DEFAULT_NODE_HEIGHT) / 2,
          }
        : n;
    });
  } catch (e) {
    console.warn("Tree layout failed", e);
    return nodes; // Return unchanged if layout fails
  }
};

/**
 * Apply hybrid layout: tree structure for initial positioning.
 * Physics engine will handle the force simulation settling.
 */
export const applyHybridLayout = (
  nodes: GraphNode[],
  edges: GraphEdge[],
  direction: "TB" | "LR" = "TB"
): GraphNode[] => {
  if (nodes.length === 0) return nodes;

  // Use tree layout for initial positioning
  // Physics engine will add spring/collision forces for settling
  return applyTreeLayout(nodes, edges, direction);
};

/**
 * Get all node IDs in a subgraph rooted at rootId.
 */
export const getSubgraphIds = (
  rootId: string,
  edges: GraphEdge[]
): Set<string> => {
  const ids = new Set<string>();
  const queue = [rootId];
  ids.add(rootId);

  // Build adjacency list (directed)
  const adj = new Map<string, string[]>();
  edges.forEach((e) => {
    const s = getId(e.source);
    const t = getId(e.target);
    if (!adj.has(s)) adj.set(s, []);
    adj.get(s)!.push(t);
  });

  while (queue.length > 0) {
    const curr = queue.shift()!;
    const children = adj.get(curr) || [];
    for (const child of children) {
      if (!ids.has(child)) {
        ids.add(child);
        queue.push(child);
      }
    }
  }
  return ids;
};

/**
 * Apply subgraph isolation layout: focus subtree in center, others in outer ring.
 * This is initial positioning only - physics engine handles settling.
 */
export const applySubgraphIsolationLayout = (
  nodes: GraphNode[],
  edges: GraphEdge[],
  focusNodeId: string
): GraphNode[] => {
  if (nodes.length === 0) return nodes;

  const nodeIds = new Set(nodes.map((n) => n.id));
  if (!nodeIds.has(focusNodeId)) {
    console.warn(
      "applySubgraphIsolationLayout: focus node missing",
      focusNodeId
    );
    return nodes;
  }

  const subgraphIds = getSubgraphIds(focusNodeId, edges);

  const innerCount = subgraphIds.size;
  const nodeDiameter = 400;
  const estimatedInnerRadius = Math.max(
    200,
    Math.sqrt(innerCount) * nodeDiameter * 0.6
  );

  const separationBuffer = 1200;
  const outerRingRadius = estimatedInnerRadius + separationBuffer;

  // Position nodes: inner subtree near center, outer nodes in ring
  return nodes.map((n) => {
    const isInner = subgraphIds.has(n.id);
    let x = n.x + (n.width || DEFAULT_NODE_WIDTH) / 2;
    let y = n.y + (n.height || DEFAULT_NODE_HEIGHT) / 2;

    const dist = Math.sqrt(x * x + y * y);

    if (!isInner) {
      // Push outer nodes to ring if too close to center
      if (dist < outerRingRadius) {
        const angle = Math.atan2(y, x) + (Math.random() - 0.5) * 0.5;
        x = Math.cos(angle) * outerRingRadius;
        y = Math.sin(angle) * outerRingRadius;
      }
    } else {
      // Pull inner nodes toward center if too far
      if (dist > estimatedInnerRadius + 500) {
        const angle = Math.atan2(y, x);
        x = Math.cos(angle) * estimatedInnerRadius;
        y = Math.sin(angle) * estimatedInnerRadius;
      }
    }

    return {
      ...n,
      x: x - (n.width || DEFAULT_NODE_WIDTH) / 2,
      y: y - (n.height || DEFAULT_NODE_HEIGHT) / 2,
    };
  });
};

/**
 * Resolve overlapping nodes using rectangle-based collision detection.
 * Uses quadtree for efficient spatial queries.
 */
export const resolveCollisions = (
  nodes: GraphNode[],
  edges: GraphEdge[],
  fixedNodeId?: string,
  activeNodeIds?: Set<string>
): GraphNode[] => {
  const simNodes = nodes.map((n) => ({ ...n }));
  const iterations = 3;
  const padding = 20;

  // Sleep optimization: Only resolve collisions involving "awake" nodes.
  const awakeNodes = activeNodeIds ? new Set(activeNodeIds) : null;

  for (let iter = 0; iter < iterations; iter++) {
    const quadtree = d3
      .quadtree<GraphNode>()
      .x((d) => d.x)
      .y((d) => d.y)
      .addAll(simNodes);

    for (const node of simNodes) {
      if (node.id === fixedNodeId) continue;

      const w = node.width || DEFAULT_NODE_WIDTH;
      const h = node.height || DEFAULT_NODE_HEIGHT;
      const cx = node.x + w / 2;
      const cy = node.y + h / 2;

      const queryLeft = node.x - padding - 500;
      const queryRight = node.x + w + padding + 500;
      const queryTop = node.y - padding - 500;
      const queryBottom = node.y + h + padding + 500;

      quadtree.visit((quad, x1, y1, x2, y2) => {
        if (
          x1 > queryRight ||
          x2 < queryLeft ||
          y1 > queryBottom ||
          y2 < queryTop
        ) {
          return true;
        }

        if (!quad.length) {
          let current: any = quad;
          do {
            const other = current.data;
            if (other.id !== node.id) {
              const ow = other.width || DEFAULT_NODE_WIDTH;
              const oh = other.height || DEFAULT_NODE_HEIGHT;

              const ocx = other.x + ow / 2;
              const ocy = other.y + oh / 2;

              const minDistX = (w + ow) / 2 + padding;
              const minDistY = (h + oh) / 2 + padding;

              const deltaX = cx - ocx;
              const deltaY = cy - ocy;

              const absX = Math.abs(deltaX);
              const absY = Math.abs(deltaY);

              if (absX < minDistX && absY < minDistY) {
                if (
                  awakeNodes &&
                  !awakeNodes.has(node.id) &&
                  !awakeNodes.has(other.id)
                ) {
                  continue;
                }

                if (awakeNodes) {
                  awakeNodes.add(node.id);
                  awakeNodes.add(other.id);
                }

                const penX = minDistX - absX;
                const penY = minDistY - absY;

                if (penX < penY) {
                  const dir = deltaX >= 0 ? 1 : -1;
                  const factor = other.id === fixedNodeId ? 1.0 : 0.5;
                  node.x += dir * penX * factor;
                } else {
                  const dir = deltaY >= 0 ? 1 : -1;
                  const factor = other.id === fixedNodeId ? 1.0 : 0.5;
                  node.y += dir * penY * factor;
                }
              }
            }
          } while ((current = current.next));
        }
        return false;
      });
    }
  }

  return simNodes;
};
