import * as d3 from "d3";
import { GraphNode, GraphEdge } from "../types";
import { DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT } from "../constants";

interface LayoutOptions {
  width: number;
  height: number;
}

const TREE_NODE_SIZE_TB: [number, number] = [320, 220];
const TREE_NODE_SIZE_LR: [number, number] = [320, 250];

export const applyForceLayout = (
  nodes: GraphNode[],
  edges: GraphEdge[],
  options?: LayoutOptions
): GraphNode[] => {
  if (nodes.length === 0) return nodes;

  const simNodes = nodes.map((n) => ({ ...n }));
  // Filter edges to only those connecting existing nodes
  const nodeIds = new Set(nodes.map((n) => n.id));
  const simEdges = edges
    .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
    .map((e) => ({ ...e }));

  const simulation = d3
    .forceSimulation(simNodes as any)
    .force("charge", d3.forceManyBody().strength(-2000))
    .force(
      "link",
      d3
        .forceLink(simEdges)
        .id((d: any) => d.id)
        .distance(500)
    )
    .force("center", d3.forceCenter(0, 0))
    .force("collide", d3.forceCollide().radius(200))
    .stop();

  // Run simulation synchronously
  simulation.tick(300);

  return nodes.map((n, i) => ({
    ...n,
    x: (simNodes[i] as any).x,
    y: (simNodes[i] as any).y,
  }));
};

export const applyTreeLayout = (
  nodes: GraphNode[],
  edges: GraphEdge[],
  direction: "TB" | "LR"
): GraphNode[] => {
  if (nodes.length === 0) return nodes;

  const rootId = nodes[0].id;
  const nodeIds = new Set(nodes.map((n) => n.id));
  
  const stratify = d3
    .stratify<GraphNode>()
    .id((d) => d.id)
    .parentId((d) => {
      // Only use edges where the source is also in the current set of nodes
      const edge = edges.find((e) => e.target === d.id && nodeIds.has(e.source));
      return edge ? edge.source : d.id === rootId ? null : rootId;
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
            x: direction === "TB" ? d.x : d.y,
            y: direction === "TB" ? d.y : d.x,
          }
        : n;
    });
  } catch (e) {
    console.warn("Tree layout failed, falling back to force layout", e);
    return applyForceLayout(nodes, edges);
  }
};

export const applyHybridLayout = (
  nodes: GraphNode[],
  edges: GraphEdge[],
  direction: "TB" | "LR" = "TB"
): GraphNode[] => {
  if (nodes.length === 0) return nodes;

  // 1. Initial Tree Layout to get ideal ranks
  const rootId = nodes[0].id;
  const nodeIds = new Set(nodes.map((n) => n.id));

  const stratify = d3
    .stratify<GraphNode>()
    .id((d) => d.id)
    .parentId((d) => {
      // Only use edges where the source is also in the current set of nodes
      const edge = edges.find((e) => e.target === d.id && nodeIds.has(e.source));
      return edge ? edge.source : d.id === rootId ? null : rootId;
    });

  try {
    const root = stratify(nodes);
    const treeLayout = d3
      .tree<GraphNode>()
      .nodeSize(direction === "TB" ? TREE_NODE_SIZE_TB : TREE_NODE_SIZE_LR);
    
    treeLayout(root);
    
    const descendants = root.descendants();
    
    // Map initial positions from tree
    const simNodes = nodes.map((n) => {
      const d = descendants.find((dn) => dn.id === n.id);
      return {
        ...n,
        // Start at tree positions
        x: d ? (direction === "TB" ? d.x : d.y) : n.x,
        y: d ? (direction === "TB" ? d.y : d.x) : n.y,
        // Store target rank position
        targetX: d ? (direction === "TB" ? d.x : d.y) : 0,
        targetY: d ? (direction === "TB" ? d.y : d.x) : 0,
        effectiveW: n.width || DEFAULT_NODE_WIDTH,
        effectiveH: n.height || DEFAULT_NODE_HEIGHT,
      };
    });

    const simEdges = edges.map((e) => ({ ...e }));
    const nodeIds = new Set(simNodes.map((n) => n.id));
    const validEdges = simEdges.filter(
      (e) => nodeIds.has(e.source) && nodeIds.has(e.target)
    );

    // 2. Run Force Simulation with constrained axes
    const simulation = d3
      .forceSimulation(simNodes as any)
      .force(
        "link",
        d3
          .forceLink(validEdges)
          .id((d: any) => d.id)
          .distance(300) 
          .strength(1) 
      )
      .force(
        "collide",
        d3
          .forceCollide()
          .radius((d: any) => {
             // Roughly half-diagonal + padding
             return Math.sqrt(d.effectiveW * d.effectiveW + d.effectiveH * d.effectiveH) / 2 + 50;
          })
          .strength(0.8)
          .iterations(2)
      )
      // Strong force to keep nodes at their hierarchical level (Y for TB, X for LR)
      .force(
        direction === "TB" ? "y" : "x", 
        d3.forceY((d: any) => d.targetY).strength(3) // High strength to enforce layers
      )
      // Weak force to center nodes horizontally (TB) or vertically (LR)
      .force(
        direction === "TB" ? "x" : "y",
        d3.forceX((d: any) => d.targetX).strength(0.05) // Very weak, allow floating
      )
      .stop();

    // Run more ticks for stability
    simulation.tick(300);

    return nodes.map((n, i) => ({
      ...n,
      x: (simNodes[i] as any).x,
      y: (simNodes[i] as any).y,
    }));

  } catch (e) {
    console.warn("Hybrid layout failed (likely cyclical), falling back to force", e);
    return applyForceLayout(nodes, edges);
  }
};

export const resolveCollisions = (
  nodes: GraphNode[],
  edges: GraphEdge[],
  fixedNodeId?: string
): GraphNode[] => {
  if (!fixedNodeId) return nodes;

  const fixedNode = nodes.find((n) => n.id === fixedNodeId);
  if (!fixedNode) return nodes;

  // STRICT OVERLAP RESOLUTION
  // We want ZERO movement unless nodes physically overlap.
  
  const simNodes = nodes.map((n) => ({
    ...n,
    // Fix the node being dragged
    fx: n.id === fixedNodeId ? n.x : undefined,
    fy: n.id === fixedNodeId ? n.y : undefined,
    // If not the fixed node, we also initially fix everything else!
    // We only unfix them if they are colliding?
    // Actually, D3 forceCollide works best if nodes are free to move.
    // To prevent rotation/drift, we remove ALL forces except collide.
    // And we add a high "alphaDecay" so movement stops instantly after collision is resolved.
    
    effectiveW: n.width || DEFAULT_NODE_WIDTH,
    effectiveH: n.height || DEFAULT_NODE_HEIGHT,
  }));

  const simulation = d3
    .forceSimulation(simNodes as any)
    .alpha(0.5) 
    .alphaDecay(0.2) // Very fast decay - stop as soon as overlap is gone
    .velocityDecay(0.6) // High friction
    // 1. NO CHARGE (prevents repulsion/drift)
    .force("charge", null) 
    // 2. NO CENTER (prevents global drift)
    .force("center", null) 
    // 3. NO LINKS (prevents pulling neighbors / rotation)
    .force("link", null)
    // 4. PURE COLLISION
    .force(
      "collide",
      d3
        .forceCollide()
        .radius((d: any) => {
          const w = d.effectiveW;
          const h = d.effectiveH;
          // Use exact bounding circle or slightly larger
          const radius = Math.sqrt(w * w + h * h) / 2;
          return radius + 5; // Small buffer
        })
        .iterations(2) // Fast resolution
        .strength(1) // Hard constraint
    )
    .stop();

  // Run just enough ticks to separate overlapping nodes
  for (let i = 0; i < 10; ++i) simulation.tick();

  return nodes.map((n, i) => ({
    ...n,
    x: (simNodes[i] as any).x,
    y: (simNodes[i] as any).y,
  }));
};

