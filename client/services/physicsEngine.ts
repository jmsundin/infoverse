import * as d3 from 'd3';
import { GraphNode, GraphEdge, PhysicsConfig, SimulationTrigger } from '../types';
import { DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT, DEFAULT_PHYSICS_CONFIG } from '../constants';

// Internal physics node with velocity and force accumulators
interface PhysicsNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  vx: number;  // Velocity X
  vy: number;  // Velocity Y
  fx: number;  // Accumulated force X (per tick)
  fy: number;  // Accumulated force Y (per tick)
  mass: number;
  pinned: boolean;
  parentId?: string;
}

// Simplified edge for physics calculations
interface PhysicsEdge {
  source: string;
  target: string;
}

// Subtree with centroid information
interface Subtree {
  rootId: string;
  nodeIds: Set<string>;
  centroid: { x: number; y: number };
}

// Simulation state
interface SimulationState {
  isRunning: boolean;
  tickCount: number;
  maxVelocity: number;
  trigger: SimulationTrigger | null;
  draggedNodeId: string | null;
  subtreeRootId: string | null;  // For manual-subtree: root node to keep fixed
  activeNodeIds: Set<string> | null;  // For manual-subtree: only these nodes participate
  // For rigid subtree dragging (vis-network style)
  lastDragX: number | null;
  lastDragY: number | null;
  dragSubtreeIds: Set<string> | null;
  // Solo drag mode: only move parent, children stay in place (Alt/Option key)
  dragSoloMode: boolean;
}

export class PhysicsEngine {
  private nodes: Map<string, PhysicsNode> = new Map();
  private edges: PhysicsEdge[] = [];
  private config: PhysicsConfig;
  private state: SimulationState;
  private animationFrameId: number | null = null;
  private onTick: ((positions: Map<string, { x: number; y: number }>) => void) | null = null;
  private onComplete: (() => void) | null = null;

  // Adjacency list for subtree traversal
  private childrenMap: Map<string, string[]> = new Map();
  private parentMap: Map<string, string> = new Map();

  // Statistics tracking
  private stats = {
    startTime: 0,
    collisionPairs: [] as Array<{ nodeA: string; nodeB: string; penX: number; penY: number }>,
    totalCollisionsResolved: 0,
  };

  constructor(config?: Partial<PhysicsConfig>) {
    this.config = { ...DEFAULT_PHYSICS_CONFIG, ...config };
    this.state = {
      isRunning: false,
      tickCount: 0,
      maxVelocity: 0,
      trigger: null,
      draggedNodeId: null,
      subtreeRootId: null,
      activeNodeIds: null,
      lastDragX: null,
      lastDragY: null,
      dragSubtreeIds: null,
      dragSoloMode: false,
    };
  }

  // ==================== Initialization ====================

  setNodes(graphNodes: GraphNode[]): void {
    // Preserve velocities for existing nodes, initialize new ones
    const newNodes = new Map<string, PhysicsNode>();

    for (const node of graphNodes) {
      // Skip nodes with invalid positions to prevent NaN propagation
      if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) {
        console.warn(`PhysicsEngine: Skipping node ${node.id} with invalid position: (${node.x}, ${node.y})`);
        continue;
      }

      const existing = this.nodes.get(node.id);
      const width = node.width || DEFAULT_NODE_WIDTH;
      const height = node.height || DEFAULT_NODE_HEIGHT;

      newNodes.set(node.id, {
        id: node.id,
        x: node.x + width / 2,  // Convert to center-based coordinates
        y: node.y + height / 2,
        width,
        height,
        vx: existing?.vx ?? 0,
        vy: existing?.vy ?? 0,
        fx: 0,
        fy: 0,
        mass: 1 + (width * height) / (DEFAULT_NODE_WIDTH * DEFAULT_NODE_HEIGHT), // Larger nodes have more mass
        pinned: node.pinned ?? false,
        parentId: node.parentId,
      });
    }

    this.nodes = newNodes;
    this.buildAdjacencyLists();
  }

  setEdges(graphEdges: GraphEdge[]): void {
    // Filter to only edges between existing nodes
    const nodeIds = new Set(this.nodes.keys());
    this.edges = graphEdges
      .filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))
      .map(e => ({ source: e.source, target: e.target }));

    this.buildAdjacencyLists();
  }

  setConfig(config: Partial<PhysicsConfig>): void {
    this.config = { ...this.config, ...config };
  }

  private buildAdjacencyLists(): void {
    this.childrenMap.clear();
    this.parentMap.clear();

    // Build parent-child relationships from edges
    for (const edge of this.edges) {
      if (!this.childrenMap.has(edge.source)) {
        this.childrenMap.set(edge.source, []);
      }
      this.childrenMap.get(edge.source)!.push(edge.target);

      // Track parent (first edge wins if multiple)
      if (!this.parentMap.has(edge.target)) {
        this.parentMap.set(edge.target, edge.source);
      }
    }
  }

  // ==================== Simulation Control ====================

  start(trigger: SimulationTrigger, subtreeRootId?: string): void {
    this.state.isRunning = true;
    this.state.tickCount = 0;
    this.state.trigger = trigger;
    this.state.subtreeRootId = null;
    this.state.activeNodeIds = null;

    // Reset statistics
    this.stats.startTime = performance.now();
    this.stats.collisionPairs = [];
    this.stats.totalCollisionsResolved = 0;

    console.log(`[Physics] START trigger=${trigger} nodes=${this.nodes.size} mode=${this.config.collisionOnly ? 'collision-only' : 'full'}`);

    if (trigger === 'drag-start' && subtreeRootId) {
      this.state.draggedNodeId = subtreeRootId;
    }

    // For manual-subtree: only simulate the root node's direct children
    // The root node is pinned (fixed) during simulation
    if (trigger === 'manual-subtree' && subtreeRootId) {
      this.state.subtreeRootId = subtreeRootId;

      // Pin the root node
      const rootNode = this.nodes.get(subtreeRootId);
      if (rootNode) {
        rootNode.pinned = true;
        rootNode.vx = 0;
        rootNode.vy = 0;
      }

      // Get only the direct children (not full subtree) + the root
      const directChildren = this.childrenMap.get(subtreeRootId) || [];
      this.state.activeNodeIds = new Set([subtreeRootId, ...directChildren]);
    }

    this.runLoop();
  }

  stop(): void {
    this.state.isRunning = false;
    this.state.draggedNodeId = null;
    this.state.subtreeRootId = null;
    this.state.activeNodeIds = null;
    // Clear rigid subtree drag state
    this.state.lastDragX = null;
    this.state.lastDragY = null;
    this.state.dragSubtreeIds = null;
    this.state.dragSoloMode = false;

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  private runLoop(): void {
    if (!this.state.isRunning) return;

    const stabilized = this.tick();

    // Periodic summary every 10 ticks
    if (this.state.tickCount % 10 === 0 && this.state.tickCount > 0) {
      const elapsed = performance.now() - this.stats.startTime;
      console.log(`[Physics] PROGRESS tick=${this.state.tickCount} elapsed=${elapsed.toFixed(0)}ms collisions=${this.stats.totalCollisionsResolved} maxVel=${this.state.maxVelocity.toFixed(2)}`);

      // Log current collision pairs if any
      if (this.stats.collisionPairs.length > 0) {
        const topPairs = this.stats.collisionPairs.slice(0, 5);
        console.log(`[Physics] TOP_COLLISIONS:`, topPairs.map(p =>
          `${p.nodeA.slice(0,8)}↔${p.nodeB.slice(0,8)} pen=(${p.penX.toFixed(1)},${p.penY.toFixed(1)})`
        ).join(', '));
      }
    }

    if (stabilized || this.state.tickCount >= this.config.maxIterations) {
      // Final summary on stabilization
      const elapsed = performance.now() - this.stats.startTime;
      const reason = stabilized ? 'stabilized' : 'max-iterations';
      console.log(`[Physics] END reason=${reason} ticks=${this.state.tickCount} elapsed=${elapsed.toFixed(0)}ms totalCollisions=${this.stats.totalCollisionsResolved}`);

      this.stop();
      this.onComplete?.();
      return;
    }

    this.animationFrameId = requestAnimationFrame(() => this.runLoop());
  }

  tick(): boolean {
    if (this.nodes.size === 0) return true;

    // Collision-only mode: no forces, just push overlapping nodes apart
    if (this.config.collisionOnly) {
      const hadOverlap = this.resolveCollisionsCollisionOnly();
      this.emitPositions();
      this.state.tickCount++;
      return !hadOverlap;
    }

    // For manual-subtree mode, use simplified physics
    if (this.state.trigger === 'manual-subtree' && this.state.activeNodeIds) {
      return this.tickSubtreeOnly();
    }

    // 1. Reset forces
    this.nodes.forEach(node => {
      node.fx = 0;
      node.fy = 0;
    });

    // 2. Identify subtrees
    const subtrees = this.identifySubtrees();

    // 3. Apply forces
    this.applySpringForces();
    this.applyGravityForces(subtrees);
    this.applySubtreeRepulsion(subtrees);

    if (this.state.draggedNodeId) {
      this.applyDragForces();
    }

    // 4. Update positions
    this.updatePositions();

    // 5. Resolve collisions
    this.resolveCollisions();

    // 6. Emit positions
    this.emitPositions();

    // 7. Check stabilization
    this.state.tickCount++;
    return this.checkStabilization();
  }

  /**
   * Simplified tick for manual-subtree mode.
   * Only operates on the root node's direct children.
   */
  private tickSubtreeOnly(): boolean {
    const activeIds = this.state.activeNodeIds!;
    const rootId = this.state.subtreeRootId!;

    // 1. Reset forces for active nodes only
    activeIds.forEach(nodeId => {
      const node = this.nodes.get(nodeId);
      if (node) {
        node.fx = 0;
        node.fy = 0;
      }
    });

    // 2. Apply spring forces only between root and children
    const rootNode = this.nodes.get(rootId);
    if (rootNode) {
      activeIds.forEach(childId => {
        if (childId === rootId) return;
        const childNode = this.nodes.get(childId);
        if (!childNode) return;

        const dx = rootNode.x - childNode.x;
        const dy = rootNode.y - childNode.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist === 0) return;

        // Spring force pulling child toward preferred distance from parent
        const displacement = dist - this.config.springLength;
        const force = this.config.springConstant * displacement;

        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        // Child is pulled toward parent
        childNode.fx += fx;
        childNode.fy += fy;
      });
    }

    // 3. Apply collision avoidance between sibling nodes
    const childArray = Array.from(activeIds)
      .filter(id => id !== rootId)
      .map(id => this.nodes.get(id))
      .filter((n): n is PhysicsNode => n !== undefined);

    for (let i = 0; i < childArray.length; i++) {
      for (let j = i + 1; j < childArray.length; j++) {
        const nodeA = childArray[i];
        const nodeB = childArray[j];

        const dx = nodeB.x - nodeA.x;
        const dy = nodeB.y - nodeA.y;
        const distSq = dx * dx + dy * dy;
        const dist = Math.sqrt(distSq);

        if (dist < 1) continue;

        // Repulsion between siblings (use subtreeRepulsionConstant scaled down)
        const minDist = (nodeA.width + nodeB.width) / 2 + this.config.collisionPadding;
        if (dist < minDist * 2) {
          const repulsion = (this.config.subtreeRepulsionConstant * 0.1) / Math.max(distSq, 100);
          const fx = (dx / dist) * repulsion;
          const fy = (dy / dist) * repulsion;

          nodeA.fx -= fx;
          nodeA.fy -= fy;
          nodeB.fx += fx;
          nodeB.fy += fy;
        }
      }
    }

    // 4. Update positions for active nodes only
    this.state.maxVelocity = 0;
    const MAX_VELOCITY = 100;
    const MAX_FORCE = 1000;

    activeIds.forEach(nodeId => {
      const node = this.nodes.get(nodeId);
      if (!node || node.pinned) return;

      // Clamp forces
      node.fx = Math.max(-MAX_FORCE, Math.min(MAX_FORCE, node.fx));
      node.fy = Math.max(-MAX_FORCE, Math.min(MAX_FORCE, node.fy));

      if (!Number.isFinite(node.fx)) node.fx = 0;
      if (!Number.isFinite(node.fy)) node.fy = 0;

      node.vx += node.fx / node.mass;
      node.vy += node.fy / node.mass;
      node.vx *= this.config.dampingFactor;
      node.vy *= this.config.dampingFactor;

      node.vx = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, node.vx));
      node.vy = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, node.vy));

      if (!Number.isFinite(node.vx)) node.vx = 0;
      if (!Number.isFinite(node.vy)) node.vy = 0;

      node.x += node.vx;
      node.y += node.vy;

      if (!Number.isFinite(node.x)) node.x = 0;
      if (!Number.isFinite(node.y)) node.y = 0;

      const velocity = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
      if (velocity > this.state.maxVelocity) {
        this.state.maxVelocity = velocity;
      }
    });

    // 5. Resolve collisions between active nodes
    this.resolveCollisionsSubtree(childArray);

    // 6. Emit positions (only for active nodes)
    this.emitPositionsSubtree(activeIds);

    // 7. Check stabilization
    this.state.tickCount++;
    return this.checkStabilization();
  }

  private resolveCollisionsSubtree(nodes: PhysicsNode[]): void {
    const padding = this.config.collisionPadding;

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const nodeA = nodes[i];
        const nodeB = nodes[j];
        if (nodeA.pinned && nodeB.pinned) continue;

        this.resolveCollisionPair(nodeA, nodeB, padding);
      }
    }
  }

  private emitPositionsSubtree(activeIds: Set<string>): void {
    if (!this.onTick) return;

    const positions = new Map<string, { x: number; y: number }>();

    activeIds.forEach(id => {
      const node = this.nodes.get(id);
      if (!node) return;

      const x = node.x - node.width / 2;
      const y = node.y - node.height / 2;

      if (Number.isFinite(x) && Number.isFinite(y)) {
        positions.set(id, { x, y });
      }
    });

    this.onTick(positions);
  }

  // ==================== Subtree Identification ====================

  private identifySubtrees(): Subtree[] {
    const visited = new Set<string>();
    const subtrees: Subtree[] = [];

    // Find root nodes (nodes with no parent in the edge graph)
    const roots: string[] = [];
    this.nodes.forEach((_, nodeId) => {
      if (!this.parentMap.has(nodeId)) {
        roots.push(nodeId);
      }
    });

    // If no clear roots, treat each unvisited node as a potential root
    if (roots.length === 0) {
      this.nodes.forEach((_, nodeId) => roots.push(nodeId));
    }

    // BFS from each root to identify subtrees
    for (const rootId of roots) {
      if (visited.has(rootId)) continue;

      const subtreeNodeIds = new Set<string>();
      const queue = [rootId];

      while (queue.length > 0) {
        const nodeId = queue.shift()!;
        if (visited.has(nodeId)) continue;

        visited.add(nodeId);
        subtreeNodeIds.add(nodeId);

        // Add children
        const children = this.childrenMap.get(nodeId) || [];
        for (const childId of children) {
          if (!visited.has(childId) && this.nodes.has(childId)) {
            queue.push(childId);
          }
        }
      }

      if (subtreeNodeIds.size > 0) {
        subtrees.push({
          rootId,
          nodeIds: subtreeNodeIds,
          centroid: this.calculateCentroid(subtreeNodeIds),
        });
      }
    }

    return subtrees;
  }

  private calculateCentroid(nodeIds: Set<string>): { x: number; y: number } {
    let sumX = 0, sumY = 0, count = 0;

    nodeIds.forEach(nodeId => {
      const node = this.nodes.get(nodeId);
      if (node) {
        sumX += node.x;
        sumY += node.y;
        count++;
      }
    });

    return count > 0
      ? { x: sumX / count, y: sumY / count }
      : { x: 0, y: 0 };
  }

  // ==================== Force Calculations ====================

  private applySpringForces(): void {
    for (const edge of this.edges) {
      const source = this.nodes.get(edge.source);
      const target = this.nodes.get(edge.target);
      if (!source || !target) continue;

      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist === 0) continue;

      // Hooke's law: F = -k * (x - x0)
      const displacement = dist - this.config.springLength;
      const force = this.config.springConstant * displacement;

      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      if (!source.pinned) {
        source.fx += fx;
        source.fy += fy;
      }
      if (!target.pinned) {
        target.fx -= fx;
        target.fy -= fy;
      }
    }
  }

  private applyGravityForces(subtrees: Subtree[]): void {
    for (const subtree of subtrees) {
      const { centroid, nodeIds } = subtree;

      nodeIds.forEach(nodeId => {
        const node = this.nodes.get(nodeId);
        if (!node || node.pinned) return;

        // Pull toward subtree centroid
        const dx = centroid.x - node.x;
        const dy = centroid.y - node.y;

        node.fx += dx * this.config.gravityConstant;
        node.fy += dy * this.config.gravityConstant;
      });
    }
  }

  private applySubtreeRepulsion(subtrees: Subtree[]): void {
    if (subtrees.length < 2) return;

    // Calculate repulsion between each pair of subtree centroids
    for (let i = 0; i < subtrees.length; i++) {
      for (let j = i + 1; j < subtrees.length; j++) {
        const subtreeA = subtrees[i];
        const subtreeB = subtrees[j];

        const dx = subtreeB.centroid.x - subtreeA.centroid.x;
        const dy = subtreeB.centroid.y - subtreeA.centroid.y;
        const distSq = dx * dx + dy * dy;
        const dist = Math.sqrt(distSq);

        if (dist < 1) continue; // Prevent division by zero

        // Inverse-square repulsion: F = k / d²
        // Negative constant means repulsion
        const force = this.config.subtreeRepulsionConstant / distSq;

        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        // Distribute force equally to all nodes in each subtree
        const forcePerNodeA = 1 / subtreeA.nodeIds.size;
        const forcePerNodeB = 1 / subtreeB.nodeIds.size;

        subtreeA.nodeIds.forEach(nodeId => {
          const node = this.nodes.get(nodeId);
          if (node && !node.pinned) {
            node.fx += fx * forcePerNodeA;
            node.fy += fy * forcePerNodeA;
          }
        });

        subtreeB.nodeIds.forEach(nodeId => {
          const node = this.nodes.get(nodeId);
          if (node && !node.pinned) {
            node.fx -= fx * forcePerNodeB;
            node.fy -= fy * forcePerNodeB;
          }
        });
      }
    }
  }

  private applyDragForces(): void {
    const draggedId = this.state.draggedNodeId;
    if (!draggedId) return;

    const draggedNode = this.nodes.get(draggedId);
    if (!draggedNode) return;

    // Get subtree of dragged node
    const subtreeIds = this.getSubtreeNodeIds(draggedId);

    // Apply spring forces from parent to children
    subtreeIds.forEach(nodeId => {
      if (nodeId === draggedId) return;

      const node = this.nodes.get(nodeId);
      if (!node || node.pinned) return;

      // Find parent in the subtree
      const parentId = this.parentMap.get(nodeId);
      if (!parentId) return;

      const parent = this.nodes.get(parentId);
      if (!parent) return;

      // Spring force toward parent
      const dx = parent.x - node.x;
      const dy = parent.y - node.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > 0) {
        const force = this.config.childFollowTightness * dist;
        node.fx += (dx / dist) * force;
        node.fy += (dy / dist) * force;
      }
    });
  }

  private getSubtreeNodeIds(rootId: string): Set<string> {
    const nodeIds = new Set<string>();
    const queue = [rootId];

    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      if (nodeIds.has(nodeId)) continue;

      nodeIds.add(nodeId);

      const children = this.childrenMap.get(nodeId) || [];
      for (const childId of children) {
        if (this.nodes.has(childId)) {
          queue.push(childId);
        }
      }
    }

    return nodeIds;
  }

  // ==================== Position Updates ====================

  private updatePositions(): void {
    this.state.maxVelocity = 0;

    // Maximum velocity to prevent numerical instability
    const MAX_VELOCITY = 100;
    // Maximum force to prevent explosions
    const MAX_FORCE = 1000;

    this.nodes.forEach(node => {
      if (node.pinned) return;

      // If this is the dragged node, don't update from forces
      if (node.id === this.state.draggedNodeId) return;

      // Clamp forces to prevent numerical explosion
      node.fx = Math.max(-MAX_FORCE, Math.min(MAX_FORCE, node.fx));
      node.fy = Math.max(-MAX_FORCE, Math.min(MAX_FORCE, node.fy));

      // Guard against NaN forces
      if (!Number.isFinite(node.fx)) node.fx = 0;
      if (!Number.isFinite(node.fy)) node.fy = 0;

      // Update velocity: v += a * dt (dt = 1 for simplicity)
      // a = F / m
      node.vx += node.fx / node.mass;
      node.vy += node.fy / node.mass;

      // Apply damping
      node.vx *= this.config.dampingFactor;
      node.vy *= this.config.dampingFactor;

      // Clamp velocity to prevent runaway
      node.vx = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, node.vx));
      node.vy = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, node.vy));

      // Guard against NaN velocities
      if (!Number.isFinite(node.vx)) node.vx = 0;
      if (!Number.isFinite(node.vy)) node.vy = 0;

      // Update position
      node.x += node.vx;
      node.y += node.vy;

      // Guard against NaN positions
      if (!Number.isFinite(node.x)) node.x = 0;
      if (!Number.isFinite(node.y)) node.y = 0;

      // Track max velocity for stabilization
      const velocity = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
      if (velocity > this.state.maxVelocity) {
        this.state.maxVelocity = velocity;
      }
    });
  }

  // ==================== Collision Resolution ====================

  private resolveCollisions(): void {
    const iterations = 3;
    const padding = this.config.collisionPadding;

    // Build quadtree for efficient collision detection
    const nodeArray = Array.from(this.nodes.values());

    for (let iter = 0; iter < iterations; iter++) {
      const quadtree = d3.quadtree<PhysicsNode>()
        .x(d => d.x)
        .y(d => d.y)
        .addAll(nodeArray);

      for (const node of nodeArray) {
        if (node.pinned) continue;

        const hw = node.width / 2;
        const hh = node.height / 2;

        // Query nearby nodes
        const queryLeft = node.x - hw - padding - 500;
        const queryRight = node.x + hw + padding + 500;
        const queryTop = node.y - hh - padding - 500;
        const queryBottom = node.y + hh + padding + 500;

        quadtree.visit((quad, x1, y1, x2, y2) => {
          // Skip quads outside query range
          if (x1 > queryRight || x2 < queryLeft || y1 > queryBottom || y2 < queryTop) {
            return true;
          }

          if (!quad.length) {
            let current: any = quad;
            do {
              const other = current.data as PhysicsNode;
              if (other.id !== node.id) {
                this.resolveCollisionPair(node, other, padding);
              }
            } while ((current = current.next));
          }
          return false;
        });
      }
    }
  }

  private resolveCollisionPair(node: PhysicsNode, other: PhysicsNode, padding: number): void {
    const ohw = other.width / 2;
    const ohh = other.height / 2;
    const nhw = node.width / 2;
    const nhh = node.height / 2;

    // Calculate minimum required distance between centers
    const minDistX = nhw + ohw + padding;
    const minDistY = nhh + ohh + padding;

    const deltaX = node.x - other.x;
    const deltaY = node.y - other.y;

    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    // Check for overlap
    if (absX < minDistX && absY < minDistY) {
      // Calculate penetration depth
      const penX = minDistX - absX;
      const penY = minDistY - absY;

      // Use proportional diagonal push instead of axis-switching to avoid jitter
      const totalPen = penX + penY;
      const ratioX = penX / totalPen;
      const ratioY = penY / totalPen;

      // Smooth separation over multiple frames
      const separationStrength = 0.4;

      const dirX = deltaX >= 0 ? 1 : -1;
      const dirY = deltaY >= 0 ? 1 : -1;

      const factor = other.pinned ? 1.0 : 0.5;

      const pushX = dirX * penX * ratioX * separationStrength;
      const pushY = dirY * penY * ratioY * separationStrength;

      node.x += pushX * factor;
      node.y += pushY * factor;

      if (!other.pinned) {
        other.x -= pushX * (1 - factor);
        other.y -= pushY * (1 - factor);
      }
    }
  }

  /**
   * Collision-only resolution: returns true if any overlap was resolved.
   * Uses tighter query bounds and fewer iterations for efficiency.
   */
  private resolveCollisionsCollisionOnly(): boolean {
    let moved = false;
    const iterations = 6; // Increased from 4 for better cascade handling
    const padding = this.config.collisionPadding;
    const nodeArray = Array.from(this.nodes.values());

    for (let iter = 0; iter < iterations; iter++) {
      const quadtree = d3.quadtree<PhysicsNode>()
        .x(d => d.x)
        .y(d => d.y)
        .addAll(nodeArray);

      for (const node of nodeArray) {
        if (node.pinned) continue;

        const hw = node.width / 2;
        const hh = node.height / 2;

        // Tighter query bounds for collision-only mode (80px margin vs 500px)
        const margin = 80;
        const queryLeft = node.x - hw - padding - margin;
        const queryRight = node.x + hw + padding + margin;
        const queryTop = node.y - hh - padding - margin;
        const queryBottom = node.y + hh + padding + margin;

        quadtree.visit((quad, x1, y1, x2, y2) => {
          if (x1 > queryRight || x2 < queryLeft || y1 > queryBottom || y2 < queryTop) {
            return true;
          }

          if (!quad.length) {
            let current: any = quad;
            do {
              const other = current.data as PhysicsNode;
              if (other.id !== node.id) {
                const didMove = this.resolveCollisionPairReturnMoved(node, other, padding);
                if (didMove) moved = true;
              }
            } while ((current = current.next));
          }
          return false;
        });
      }
    }

    // Removed: velocity dampening was causing oscillation instead of preventing it
    // The stronger separation strength (0.7) should handle convergence without dampening

    return moved;
  }

  /**
   * Same as resolveCollisionPair but returns true if nodes were actually moved.
   */
  private resolveCollisionPairReturnMoved(node: PhysicsNode, other: PhysicsNode, padding: number): boolean {
    const ohw = other.width / 2;
    const ohh = other.height / 2;
    const nhw = node.width / 2;
    const nhh = node.height / 2;

    const minDistX = nhw + ohw + padding;
    const minDistY = nhh + ohh + padding;

    const deltaX = node.x - other.x;
    const deltaY = node.y - other.y;

    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    if (absX < minDistX && absY < minDistY) {
      // Early exit if both nodes are pinned - neither can move
      if (node.pinned && other.pinned) {
        return false;
      }

      const penX = minDistX - absX;
      const penY = minDistY - absY;

      // Treat sub-pixel overlaps as resolved to prevent infinite oscillation
      if (penX < 1 && penY < 1) {
        return false;
      }

      // Track collision pair for statistics
      this.stats.totalCollisionsResolved++;
      // Keep only recent collision pairs, sorted by penetration depth
      const existingIdx = this.stats.collisionPairs.findIndex(p =>
        (p.nodeA === node.id && p.nodeB === other.id) || (p.nodeA === other.id && p.nodeB === node.id)
      );
      if (existingIdx >= 0) {
        this.stats.collisionPairs[existingIdx] = { nodeA: node.id, nodeB: other.id, penX, penY };
      } else if (this.stats.collisionPairs.length < 20) {
        this.stats.collisionPairs.push({ nodeA: node.id, nodeB: other.id, penX, penY });
      }
      // Sort by total penetration (descending)
      this.stats.collisionPairs.sort((a, b) => (b.penX + b.penY) - (a.penX + a.penY));

      // Use proportional diagonal push instead of axis-switching to avoid jitter
      const totalPen = penX + penY;
      const ratioX = penX / totalPen;
      const ratioY = penY / totalPen;

      // Faster separation to prevent oscillation (was 0.4)
      const separationStrength = 0.7;

      const dirX = deltaX >= 0 ? 1 : -1;
      const dirY = deltaY >= 0 ? 1 : -1;

      // Calculate factor based on which nodes can move
      // When node is pinned, other does 100% of moving (and vice versa)
      let factor: number;
      if (node.pinned) {
        factor = 0;  // node can't move, other does 100%
      } else if (other.pinned) {
        factor = 1.0;  // other can't move, node does 100%
      } else {
        factor = 0.5;  // both can move, split 50/50
      }

      const pushX = dirX * penX * ratioX * separationStrength;
      const pushY = dirY * penY * ratioY * separationStrength;

      // Only move nodes that aren't pinned
      if (!node.pinned) {
        node.x += pushX * factor;
        node.y += pushY * factor;
      }

      if (!other.pinned) {
        other.x -= pushX * (1 - factor);
        other.y -= pushY * (1 - factor);
      }

      return true;
    }
    return false;
  }

  // ==================== Stabilization ====================

  private checkStabilization(): boolean {
    return this.state.maxVelocity < this.config.velocityThreshold;
  }

  // ==================== Output ====================

  private emitPositions(): void {
    if (!this.onTick) return;

    const positions = new Map<string, { x: number; y: number }>();

    this.nodes.forEach((node, id) => {
      // Convert back to top-left coordinates
      const x = node.x - node.width / 2;
      const y = node.y - node.height / 2;

      // Only emit valid positions to prevent NaN from propagating
      if (Number.isFinite(x) && Number.isFinite(y)) {
        positions.set(id, { x, y });
      }
    });

    this.onTick(positions);
  }

  getNodePositions(): Map<string, { x: number; y: number }> {
    const positions = new Map<string, { x: number; y: number }>();

    this.nodes.forEach((node, id) => {
      positions.set(id, {
        x: node.x - node.width / 2,
        y: node.y - node.height / 2,
      });
    });

    return positions;
  }

  // ==================== Drag Mode ====================

  /**
   * Start drag mode.
   * @param nodeId - The node being dragged
   * @param soloMode - If true, only move the parent node (Alt/Option key held).
   *                   Children stay in place unless they're not pinned/locked.
   */
  startDrag(nodeId: string, soloMode: boolean = false): void {
    this.state.draggedNodeId = nodeId;
    this.state.dragSoloMode = soloMode;

    const node = this.nodes.get(nodeId);
    if (node) {
      // Store initial position for delta calculation
      this.state.lastDragX = node.x;
      this.state.lastDragY = node.y;
      node.vx = 0;
      node.vy = 0;
    }

    // Cache subtree for rigid movement (vis-network style)
    // In solo mode, we still cache but won't move them
    this.state.dragSubtreeIds = this.getSubtreeNodeIds(nodeId);

    // Zero velocities for all subtree nodes
    this.state.dragSubtreeIds.forEach(id => {
      const n = this.nodes.get(id);
      if (n) {
        n.vx = 0;
        n.vy = 0;
      }
    });

    console.log(`[Physics:drag] START node=${nodeId} subtreeSize=${this.state.dragSubtreeIds.size} soloMode=${soloMode}`);
  }

  updateDragPosition(nodeId: string, x: number, y: number): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    const newX = x + node.width / 2;
    const newY = y + node.height / 2;

    const lastX = this.state.lastDragX ?? node.x;
    const lastY = this.state.lastDragY ?? node.y;

    const dx = newX - lastX;
    const dy = newY - lastY;

    // Move dragged node
    node.x = newX;
    node.y = newY;
    node.vx = 0;
    node.vy = 0;

    // In solo mode (Alt/Option held), don't move children at all
    if (!this.state.dragSoloMode) {
      // Move subtree rigidly (vis-network style)
      // BUT skip pinned/locked children - they stay in place
      const subtree = this.state.dragSubtreeIds ?? this.getSubtreeNodeIds(nodeId);
      subtree.forEach(id => {
        if (id === nodeId) return;
        const child = this.nodes.get(id);
        if (!child) return;
        // Pinned/locked children don't move with parent
        if (child.pinned) return;
        child.x += dx;
        child.y += dy;
        child.vx = 0;
        child.vy = 0;
      });
    }

    this.state.lastDragX = newX;
    this.state.lastDragY = newY;
  }

  endDrag(): void {
    if (this.state.draggedNodeId) {
      console.log(`[Physics:drag] END node=${this.state.draggedNodeId} soloMode=${this.state.dragSoloMode}`);
    }
    this.state.draggedNodeId = null;
    this.state.lastDragX = null;
    this.state.lastDragY = null;
    this.state.dragSubtreeIds = null;
    this.state.dragSoloMode = false;
  }

  // ==================== Node State ====================

  pinNode(id: string): void {
    const node = this.nodes.get(id);
    if (node) {
      node.pinned = true;
      node.vx = 0;
      node.vy = 0;
    }
  }

  unpinNode(id: string): void {
    const node = this.nodes.get(id);
    if (node) {
      node.pinned = false;
    }
  }

  // ==================== Callbacks ====================

  onTickCallback(cb: (positions: Map<string, { x: number; y: number }>) => void): void {
    this.onTick = cb;
  }

  onCompleteCallback(cb: () => void): void {
    this.onComplete = cb;
  }

  // ==================== State Accessors ====================

  isRunning(): boolean {
    return this.state.isRunning;
  }

  getState(): SimulationState {
    return { ...this.state };
  }
}
