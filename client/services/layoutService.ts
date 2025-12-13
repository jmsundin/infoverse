import * as d3 from "d3";
import { GraphNode, GraphEdge } from "../types";
import { DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT, PARENT_NODE_WIDTH, PARENT_NODE_HEIGHT } from "../constants";

interface LayoutOptions {
  width: number;
  height: number;
}

const TREE_NODE_SIZE_TB: [number, number] = [PARENT_NODE_WIDTH + 50, PARENT_NODE_HEIGHT + 50];
const TREE_NODE_SIZE_LR: [number, number] = [PARENT_NODE_HEIGHT + 50, PARENT_NODE_WIDTH + 50];

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

  const nodeIds = new Set(nodes.map((n) => n.id));
  const filteredEdges = edges.filter(
    (e) => nodeIds.has(e.source) && nodeIds.has(e.target)
  );

  const indegreeByNodeId = new Map<string, number>();
  const parentByTargetId = new Map<string, string>();
  for (const node of nodes) indegreeByNodeId.set(node.id, 0);
  for (const edge of filteredEdges) {
    indegreeByNodeId.set(
      edge.target,
      (indegreeByNodeId.get(edge.target) ?? 0) + 1
    );
    if (!parentByTargetId.has(edge.target)) parentByTargetId.set(edge.target, edge.source);
  }

  const rootCandidate = nodes.find(
    (n) => (indegreeByNodeId.get(n.id) ?? 0) === 0
  );
  const rootId = (rootCandidate?.id ?? nodes[0]?.id) as string;

  const stratify = d3
    .stratify<GraphNode>()
    .id((d) => d.id)
    .parentId((d) => {
      // d3.stratify requires exactly one root (parentId === null).
      // If the chosen root has incoming edges (or the graph is cyclical), force it to be the root.
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
  const nodeIds = new Set(nodes.map((n) => n.id));
  const filteredEdges = edges.filter(
    (e) => nodeIds.has(e.source) && nodeIds.has(e.target)
  );

  const indegreeByNodeId = new Map<string, number>();
  const parentByTargetId = new Map<string, string>();
  for (const node of nodes) indegreeByNodeId.set(node.id, 0);
  for (const edge of filteredEdges) {
    indegreeByNodeId.set(
      edge.target,
      (indegreeByNodeId.get(edge.target) ?? 0) + 1
    );
    if (!parentByTargetId.has(edge.target)) parentByTargetId.set(edge.target, edge.source);
  }

  const rootCandidate = nodes.find(
    (n) => (indegreeByNodeId.get(n.id) ?? 0) === 0
  );
  const rootId = (rootCandidate?.id ?? nodes[0]?.id) as string;

  const stratify = d3
    .stratify<GraphNode>()
    .id((d) => d.id)
    .parentId((d) => {
      // d3.stratify requires exactly one root (parentId === null).
      // If the chosen root has incoming edges (or the graph is cyclical), force it to be the root.
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

const getSubgraphIds = (rootId: string, edges: GraphEdge[]): Set<string> => {
  const ids = new Set<string>();
  const queue = [rootId];
  ids.add(rootId);
  
  // Build adjacency list (directed)
  const adj = new Map<string, string[]>();
  edges.forEach(e => {
    const s = typeof e.source === 'object' ? (e.source as any).id : e.source;
    const t = typeof e.target === 'object' ? (e.target as any).id : e.target;
    if (!adj.has(s)) adj.set(s, []);
    adj.get(s)!.push(t);
  });
  
  while(queue.length > 0) {
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

export const applySubgraphIsolationLayout = (
  nodes: GraphNode[],
  edges: GraphEdge[],
  focusNodeId: string
): GraphNode[] => {
  if (nodes.length === 0) return nodes;

  const nodeIds = new Set(nodes.map((n) => n.id));
  if (!nodeIds.has(focusNodeId)) {
    console.warn("applySubgraphIsolationLayout: focus node missing", focusNodeId);
    return nodes;
  }

  const subgraphIds = getSubgraphIds(focusNodeId, edges);
  
  const innerCount = subgraphIds.size;
  // Radius estimation
  const nodeDiameter = 400; 
  const estimatedInnerRadius = Math.max(200, Math.sqrt(innerCount) * nodeDiameter * 0.6);
  
  const separationBuffer = 1200;
  const outerRingRadius = estimatedInnerRadius + separationBuffer;

  const simNodes = nodes.map((n) => {
    const isInner = subgraphIds.has(n.id);
    let { x, y } = n;

    // Smart Initialization: Teleport misplaced nodes to their target zones
    // This ensures immediate visual separation even before simulation ticks
    const dist = Math.sqrt(x * x + y * y);
    
    if (!isInner) {
        // If outer node is too close to center, push to ring
        if (dist < outerRingRadius) {
            const angle = Math.atan2(y, x) + (Math.random() - 0.5) * 0.5;
            x = Math.cos(angle) * outerRingRadius;
            y = Math.sin(angle) * outerRingRadius;
        }
    } else {
        // If inner node is too far, pull to center
        if (dist > estimatedInnerRadius + 500) {
             const angle = Math.atan2(y, x);
             x = Math.cos(angle) * estimatedInnerRadius;
             y = Math.sin(angle) * estimatedInnerRadius;
        }
    }

    return { 
      ...n,
      x,
      y,
      effectiveW: n.width || DEFAULT_NODE_WIDTH,
      effectiveH: n.height || DEFAULT_NODE_HEIGHT,
      isInner
    };
  });
  
  const filteredEdges = edges
    .filter(
      (e) =>
        nodeIds.has(typeof e.source === "object" ? (e.source as any).id : e.source) &&
        nodeIds.has(typeof e.target === "object" ? (e.target as any).id : e.target)
    )
    .map((e) => ({ ...e }));
  
  const simulation = d3
    .forceSimulation(simNodes as any)
    .force("charge", d3.forceManyBody().strength(-3000))
    .force(
      "link",
      d3
        .forceLink(filteredEdges)
        .id((d: any) => d.id)
        .distance((d: any) => {
           const sIn = subgraphIds.has(typeof d.source === 'object' ? d.source.id : d.source);
           const tIn = subgraphIds.has(typeof d.target === 'object' ? d.target.id : d.target);
           
           if (sIn && tIn) return 300;
           if (!sIn && !tIn) return 300;
           // Cross-boundary links
           return separationBuffer;
        })
    )
    .force(
      "collide",
      d3
        .forceCollide()
        .radius((d: any) => {
           return Math.sqrt(d.effectiveW * d.effectiveW + d.effectiveH * d.effectiveH) / 2 + 80;
        })
        .strength(0.9)
    )
    .force(
      "radial",
      d3.forceRadial(
        (d: any) => d.isInner ? 0 : outerRingRadius,
        0, 
        0
      ).strength((d: any) => d.isInner ? 0.05 : 0.6)
    )
    // Custom Force: Enforce Exclusion Zone
    .force("isolation", (alpha) => {
        const k = alpha * 0.8; // High strength
        for (const d of simNodes) {
             const dist = Math.sqrt(d.x! * d.x! + d.y! * d.y!);
             if (d.isInner) {
                 // Keep inner nodes bounded
                 if (dist > estimatedInnerRadius + 400) {
                     d.vx! -= d.x! * k * 0.05;
                     d.vy! -= d.y! * k * 0.05;
                 }
             } else {
                 // Push outer nodes out of the exclusion zone
                 if (dist < outerRingRadius - 100) {
                     const angle = Math.atan2(d.y!, d.x!);
                     d.vx! += Math.cos(angle) * k * 5;
                     d.vy! += Math.sin(angle) * k * 5;
                 }
             }
        }
    })
    .stop();

  simulation.tick(300);

  return nodes.map((n, i) => ({
    ...n,
    x: (simNodes[i] as any).x,
    y: (simNodes[i] as any).y,
  }));
};

export const resolveCollisions = (
  nodes: GraphNode[],
  edges: GraphEdge[],
  fixedNodeId?: string
): GraphNode[] => {
  // If no fixed node, we allow all nodes to move to resolve overlaps.
  // If fixed node exists, it stays pinned (via fx/fy in simNodes below).
  
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
