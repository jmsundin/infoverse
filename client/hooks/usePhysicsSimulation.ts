import { useRef, useCallback, useState, useEffect } from 'react';
import { GraphNode, GraphEdge, PhysicsConfig, SimulationTrigger } from '../types';
import { PhysicsEngine } from '../services/physicsEngine';
import { DEFAULT_PHYSICS_CONFIG } from '../constants';

interface UsePhysicsSimulationOptions {
  config?: Partial<PhysicsConfig>;
  onPositionsUpdate?: (positions: Map<string, { x: number; y: number }>) => void;
}

export function usePhysicsSimulation(
  nodes: GraphNode[],
  edges: GraphEdge[],
  setNodes: React.Dispatch<React.SetStateAction<GraphNode[]>>,
  options: UsePhysicsSimulationOptions = {}
) {
  const { config, onPositionsUpdate } = options;
  const engineRef = useRef<PhysicsEngine | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);

  // Initialize engine
  useEffect(() => {
    const finalConfig = { ...DEFAULT_PHYSICS_CONFIG, ...config };
    engineRef.current = new PhysicsEngine(finalConfig);

    // Set up tick callback to update React state
    engineRef.current.onTickCallback((positions) => {
      // Batch update React state
      setNodes(prev => {
        const updated = prev.map(node => {
          const pos = positions.get(node.id);
          // Only update if position is valid (not NaN)
          if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
            if (node.x !== pos.x || node.y !== pos.y) {
              return { ...node, x: pos.x, y: pos.y };
            }
          }
          return node;
        });
        return updated;
      });

      // Optional external callback
      onPositionsUpdate?.(positions);
    });

    // Set up completion callback
    engineRef.current.onCompleteCallback(() => {
      setIsSimulating(false);
    });

    return () => {
      engineRef.current?.stop();
    };
  }, []); // Only create engine once

  // Update config when it changes
  useEffect(() => {
    if (config && engineRef.current) {
      engineRef.current.setConfig(config);
    }
  }, [config]);

  // NOTE: We intentionally do NOT auto-sync nodes/edges to the engine on every change.
  // This would cause an infinite loop:
  //   nodes change → sync to engine → tick updates positions → setNodes() → nodes change → ...
  // Instead, nodes/edges are synced only when simulation is explicitly started
  // (in startSimulation and startDrag callbacks).

  // Start simulation
  const startSimulation = useCallback((
    trigger: SimulationTrigger,
    subtreeRootId?: string
  ) => {
    if (!engineRef.current) return;
    // Skip if physics is disabled
    if (config?.physicsEnabled === false) return;

    // Re-sync nodes and edges before starting
    engineRef.current.setNodes(nodes);
    engineRef.current.setEdges(edges);

    setIsSimulating(true);
    engineRef.current.start(trigger, subtreeRootId);
  }, [nodes, edges, config?.physicsEnabled]);

  // Stop simulation
  const stopSimulation = useCallback(() => {
    engineRef.current?.stop();
    setIsSimulating(false);
  }, []);

  // Drag mode controls
  /**
   * Start drag mode.
   * @param nodeId - The node being dragged
   * @param soloMode - If true, only move the parent (Alt/Option held), children stay in place
   */
  const startDrag = useCallback((nodeId: string, soloMode: boolean = false) => {
    if (!engineRef.current) return;
    // Skip if physics is disabled
    if (config?.physicsEnabled === false) return;

    // Re-sync before drag
    engineRef.current.setNodes(nodes);
    engineRef.current.setEdges(edges);

    engineRef.current.startDrag(nodeId, soloMode);
    setIsSimulating(true);
    engineRef.current.start('drag-start', nodeId);
  }, [nodes, edges, config?.physicsEnabled]);

  const updateDragPosition = useCallback((nodeId: string, x: number, y: number) => {
    engineRef.current?.updateDragPosition(nodeId, x, y);
  }, []);

  const endDrag = useCallback(() => {
    engineRef.current?.endDrag();
    // Simulation continues until stabilized
  }, []);

  // Pin controls
  const pinNode = useCallback((nodeId: string) => {
    engineRef.current?.pinNode(nodeId);
    // Also update the node in React state
    setNodes(prev => prev.map(node =>
      node.id === nodeId ? { ...node, pinned: true } : node
    ));
  }, [setNodes]);

  const unpinNode = useCallback((nodeId: string) => {
    engineRef.current?.unpinNode(nodeId);
    // Also update the node in React state
    setNodes(prev => prev.map(node =>
      node.id === nodeId ? { ...node, pinned: false } : node
    ));
  }, [setNodes]);

  const togglePinNode = useCallback((nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId);
    if (node?.pinned) {
      unpinNode(nodeId);
    } else {
      pinNode(nodeId);
    }
  }, [nodes, pinNode, unpinNode]);

  // Manual tick (for testing or custom control)
  const tick = useCallback(() => {
    return engineRef.current?.tick() ?? true;
  }, []);

  // Get current simulation state
  const getState = useCallback(() => {
    return engineRef.current?.getState() ?? {
      isRunning: false,
      tickCount: 0,
      maxVelocity: 0,
      trigger: null,
      draggedNodeId: null,
    };
  }, []);

  return {
    isSimulating,
    startSimulation,
    stopSimulation,
    startDrag,
    updateDragPosition,
    endDrag,
    pinNode,
    unpinNode,
    togglePinNode,
    tick,
    getState,
  };
}
