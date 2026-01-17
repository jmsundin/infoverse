import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from "react";
import * as d3 from "d3";
import {
  GraphEdge,
  GraphNode,
  NodeType,
  ViewportTransform,
  ResizeDirection,
  ChatMessage,
  LODLevel,
  SelectionTooltipState,
  EdgeStyle,
} from "../types";
import { SidePanelLayout } from "./SidePanel";
import { GraphNodeComponent } from "./GraphNode";
import { Edge } from "./Edge";
import { SkeletonGraph, NodeSkeleton } from "./SkeletonGraph";
import {
  DEFAULT_NODE_HEIGHT,
  DEFAULT_NODE_WIDTH,
  MIN_NODE_WIDTH,
  MIN_NODE_HEIGHT,
  COLORS,
  NODE_COLORS,
  NODE_HEADER_HEIGHT,
} from "../constants";
import {
  applyTreeLayout,
  applyHybridLayout,
  applySubgraphIsolationLayout,
  resolveCollisions as resolveCollisionsService,
} from "../services/layoutService";
import {
  calculateDynamicLOD,
  DEFAULT_LOD_CONFIG,
} from "../utils/lodThresholds";
import { SimulationTrigger } from "../types";

interface CanvasProps {
  nodes: GraphNode[];
  allNodes: GraphNode[];
  edges: GraphEdge[];
  setNodes: React.Dispatch<React.SetStateAction<GraphNode[]>>;
  setEdges: React.Dispatch<React.SetStateAction<GraphEdge[]>>;
  viewTransform: ViewportTransform;
  onViewTransformChange: (transform: ViewportTransform) => void;
  isSaving?: boolean;
  onOpenLink: (url: string) => void;
  onNavigateToNode: (title: string) => void;
  onMaximizeNode: (id: string) => void;
  onExpandNode: (id: string, topic: string) => void;
  onExpandNodeFromWikidata?: (id: string, topic: string) => void;
  onDeleteNode: (id: string) => void;
  onUpdateNode: (id: string, updates: Partial<GraphNode>) => void;
  expandingNodeIds: string[];
  onToggleMenu?: () => void;
  connectingNodeId: string | null;
  onConnectStart: (id: string) => void;
  onConnectEnd: (sourceId: string, targetId: string) => void;
  onCancelConnect: () => void;
  onNavigateDown?: (id: string) => void;
  onNavigateUp?: (exitingScopeId?: string) => void;
  currentScopeId?: string | null;
  autoGraphEnabled?: boolean;
  onSetAutoGraphEnabled?: (enabled: boolean) => void;
  selectedNodeIds: Set<string>;
  onNodeSelect: (id: string | null, multi?: boolean | "remove") => void;
  onMultiSelect?: (ids: string[], multi?: boolean) => void;
  canvasShiftX: number;
  canvasShiftY: number;
  onSelectionTooltipChange?: (tooltip: SelectionTooltipState | null) => void;
  isResizing?: boolean;
  cutNodeId: string | null;
  setCutNodeId: React.Dispatch<React.SetStateAction<string | null>>;
  aiProvider?: "gemini" | "huggingface";
  // Physics simulation props (passed from App.tsx)
  isSimulating?: boolean;
  startSimulation?: (trigger: SimulationTrigger, subtreeRootId?: string) => void;
  stopSimulation?: () => void;
  physicsStartDrag?: (nodeId: string) => void;
  physicsUpdateDrag?: (nodeId: string, x: number, y: number) => void;
  physicsEndDrag?: () => void;
  pinNode?: (nodeId: string) => void;
  unpinNode?: (nodeId: string) => void;
  togglePinNode?: (nodeId: string) => void;
}

// Semantic zoom shift threshold - triggers scope navigation when zoomed very far out
const LOD_THRESHOLD_SEMANTIC_SHIFT = 0.05;

const CHILD_SURROUND_GAP_PX = 20;
const CHILD_SURROUND_MIN_RING_SPACING_PX = 100;

const getEffectiveNodeSize = (node: GraphNode) => {
  return {
    width: node.width ?? DEFAULT_NODE_WIDTH,
    height: node.height ?? DEFAULT_NODE_HEIGHT,
  };
};

const computeSurroundChildPositions = (
  parentNode: GraphNode,
  childNodes: GraphNode[]
) => {
  console.assert(
    !!parentNode?.id,
    "computeSurroundChildPositions: missing parentNode.id"
  );
  if (childNodes.length === 0)
    return new Map<string, { x: number; y: number }>();

  const { width: parentWidth, height: parentHeight } =
    getEffectiveNodeSize(parentNode);
  const parentCenterX = parentNode.x + parentWidth / 2;
  const parentCenterY = parentNode.y + parentHeight / 2;

  let maxChildDiagonal = 0;
  for (const childNode of childNodes) {
    const { width, height } = getEffectiveNodeSize(childNode);
    const diagonal = Math.sqrt(width * width + height * height);
    if (diagonal > maxChildDiagonal) maxChildDiagonal = diagonal;
  }
  const maxChildRadius = maxChildDiagonal / 2;

  const baseRadius =
    Math.max(parentWidth, parentHeight) / 2 +
    CHILD_SURROUND_GAP_PX +
    maxChildRadius;
  const minPackingRadius =
    (childNodes.length * (maxChildDiagonal + CHILD_SURROUND_GAP_PX)) /
    (2 * Math.PI);
  const radius = Math.max(baseRadius, minPackingRadius);

  const positionsById = new Map<string, { x: number; y: number }>();
  const orderedChildren = [...childNodes].sort((a, b) =>
    a.id.localeCompare(b.id)
  );
  for (let i = 0; i < orderedChildren.length; i++) {
    const childNode = orderedChildren[i];
    const { width: childWidth, height: childHeight } =
      getEffectiveNodeSize(childNode);

    const ringIndex = Math.floor(i / 12);
    const ringRadius = radius + ringIndex * CHILD_SURROUND_MIN_RING_SPACING_PX;
    const indexWithinRing = i - ringIndex * 12;
    const itemsInRing = Math.min(12, orderedChildren.length - ringIndex * 12);
    const angle =
      itemsInRing <= 1 ? 0 : (2 * Math.PI * indexWithinRing) / itemsInRing;

    const childCenterX = parentCenterX + ringRadius * Math.cos(angle);
    const childCenterY = parentCenterY + ringRadius * Math.sin(angle);
    positionsById.set(childNode.id, {
      x: childCenterX - childWidth / 2,
      y: childCenterY - childHeight / 2,
    });
  }

  return positionsById;
};

type LayoutType =
  | "force"
  | "tree-tb"
  | "tree-lr"
  | "hybrid"
  | "isolate-subgraph";

interface LayoutOption {
  type: LayoutType;
  label: string;
  description: string;
  icon: React.ReactNode;
  requiresSelection?: boolean;
}

const SIDEBAR_LAYOUT_OPTIONS: LayoutOption[] = [
  {
    type: "tree-tb",
    label: "Tree Vertical",
    description: "Top to bottom structure",
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-5 h-5"
      >
        <circle cx="12" cy="5" r="2" />
        <circle cx="5" cy="19" r="2" />
        <circle cx="19" cy="19" r="2" />
        <line x1="12" y1="7" x2="5" y2="17" />
        <line x1="12" y1="7" x2="19" y2="17" />
      </svg>
    ),
  },
  {
    type: "tree-lr",
    label: "Tree Horizontal",
    description: "Left to right flow",
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-5 h-5"
      >
        <circle cx="5" cy="12" r="2" />
        <circle cx="19" cy="5" r="2" />
        <circle cx="19" cy="19" r="2" />
        <line x1="7" y1="12" x2="17" y2="5" />
        <line x1="7" y1="12" x2="17" y2="19" />
      </svg>
    ),
  },
  {
    type: "hybrid",
    label: "Hybrid Layout",
    description: "Tree grid blend",
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-5 h-5"
      >
        <path d="M12 2v20" />
        <path d="M2 12h20" />
        <circle cx="12" cy="12" r="3" />
        <circle cx="12" cy="4" r="2" />
        <circle cx="12" cy="20" r="2" />
        <circle cx="4" cy="12" r="2" />
        <circle cx="20" cy="12" r="2" />
      </svg>
    ),
  },
  {
    type: "isolate-subgraph",
    label: "Isolate Subgraph",
    description: "Center connected nodes",
    requiresSelection: true,
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-5 h-5"
      >
        <circle cx="12" cy="12" r="3" />
        <circle cx="12" cy="12" r="9" strokeDasharray="4 4" />
        <line x1="12" y1="3" x2="12" y2="5" />
        <line x1="12" y1="19" x2="12" y2="21" />
        <line x1="3" y1="12" x2="5" y2="12" />
        <line x1="19" y1="12" x2="21" y2="12" />
      </svg>
    ),
  },
  {
    type: "force",
    label: "Force Layout",
    description: "Physics-based spread",
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-5 h-5"
      >
        <circle cx="18" cy="5" r="3" />
        <circle cx="6" cy="12" r="3" />
        <circle cx="18" cy="19" r="3" />
        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
        <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
      </svg>
    ),
  },
];

const resolveCollisionsInScope = (
  allNodes: GraphNode[],
  scopeEdges: GraphEdge[],
  fixedNodeId: string | null,
  currentScopeId: string | null | undefined,
  selectedNodeIds: Set<string>,
  activeNodeIds?: Set<string>
) => {
  const scopeNodes = allNodes.filter((n) => n.scopeId == currentScopeId);
  if (scopeNodes.length === 0) return allNodes;

  // Map to effective layout nodes (handling compact size for unselected)
  const effectiveNodes = scopeNodes.map((n) => ({
    ...n,
    width: selectedNodeIds.has(n.id)
      ? n.width || DEFAULT_NODE_WIDTH
      : DEFAULT_NODE_WIDTH, // Width stays uniform for now, or match compact width logic if needed
    height: selectedNodeIds.has(n.id)
      ? n.height || DEFAULT_NODE_HEIGHT
      : NODE_HEADER_HEIGHT,
  }));

  const resolvedScopeNodes = resolveCollisionsService(
    effectiveNodes,
    scopeEdges,
    fixedNodeId ?? undefined,
    activeNodeIds
  );

  // Map positions back to original nodes (preserving original dimensions)
  const resolvedById = new Map<string, { x: number; y: number }>(
    resolvedScopeNodes.map((n) => [n.id, { x: n.x, y: n.y }])
  );

  return allNodes.map((node) => {
    const pos = resolvedById.get(node.id);
    return pos ? { ...node, x: pos.x, y: pos.y } : node;
  });
};

export const Canvas: React.FC<CanvasProps> = ({
  nodes,
  allNodes,
  edges,
  setNodes,
  setEdges,
  viewTransform,
  onViewTransformChange,
  isSaving = false,
  onOpenLink,
  onNavigateToNode,
  onMaximizeNode,
  onExpandNode,
  onExpandNodeFromWikidata,
  onDeleteNode,
  onUpdateNode,
  expandingNodeIds,
  onToggleMenu,
  connectingNodeId,
  onConnectStart,
  onConnectEnd,
  onCancelConnect,
  onNavigateDown,
  onNavigateUp,
  currentScopeId,
  autoGraphEnabled,
  onSetAutoGraphEnabled,
  selectedNodeIds,
  onNodeSelect,
  onMultiSelect,
  isResizing,
  onSelectionTooltipChange,
  canvasShiftX,
  canvasShiftY,
  cutNodeId,
  setCutNodeId,
  aiProvider,
  // Physics simulation props
  isSimulating,
  startSimulation,
  stopSimulation,
  physicsStartDrag,
  physicsUpdateDrag,
  physicsEndDrag,
  pinNode,
  unpinNode,
  togglePinNode,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const longPressContextMenuTimerRef = useRef<number | null>(null);
  const longPressContextMenuStartPointRef = useRef<{
    x: number;
    y: number;
  } | null>(null);
  const longPressContextMenuOpenedRef = useRef(false);
  const twoFingerLongPressTimerRef = useRef<number | null>(null);
  const twoFingerLongPressStartPointRef = useRef<{
    x: number;
    y: number;
  } | null>(null);
  const twoFingerTapStartTimeRef = useRef<number | null>(null);
  const layoutMenuContainerRef = useRef<HTMLDivElement | null>(null);
  const createMenuContainerRef = useRef<HTMLDivElement | null>(null);

  // Derived state
  const selectedNodeId = useMemo(
    () => (selectedNodeIds.size === 1 ? Array.from(selectedNodeIds)[0] : null),
    [selectedNodeIds]
  );

  const [containerSize, setContainerSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  // Track the most recently clicked node for highlight styling
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [resizingId, setResizingId] = useState<string | null>(null);
  const [resizeDirection, setResizeDirection] =
    useState<ResizeDirection | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  const [selectionBox, setSelectionBox] = useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);

  // Track previous LOD for hysteresis (prevents flickering at thresholds)
  const [previousLOD, setPreviousLOD] = useState<LODLevel>("DETAIL");

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    canvasX: number;
    canvasY: number;
  } | null>(null);
  const lastTapRef = useRef<number>(0);
  const [isLayoutMenuOpen, setIsLayoutMenuOpen] = useState(false);
  const [isCreateMenuOpen, setIsCreateMenuOpen] = useState(false);
  const [activeLayout, setActiveLayout] = useState<LayoutType | null>(null);

  const dragStartRef = useRef<{
    mouseX: number;
    mouseY: number;
    lastX: number;
    lastY: number;
    initialPositions: Map<string, { x: number; y: number }>;
    // Specifics for resize (which is always single node)
    nodeWidth?: number;
    nodeHeight?: number;
    // Physics State
    velocities?: Map<string, { vx: number; vy: number }>;
    childrenMasses?: Map<string, number>;
  } | null>(null);

  const isDraggingRef = useRef(false);
  const draggingIdRef = useRef(draggingId);
  const resizingIdRef = useRef(resizingId);
  const connectingNodeIdRef = useRef(connectingNodeId);

  const zoomBehaviorRef = useRef<d3.ZoomBehavior<
    HTMLDivElement,
    unknown
  > | null>(null);

  useEffect(() => {
    draggingIdRef.current = draggingId;
  }, [draggingId]);
  useEffect(() => {
    resizingIdRef.current = resizingId;
  }, [resizingId]);
  useEffect(() => {
    connectingNodeIdRef.current = connectingNodeId;
  }, [connectingNodeId]);
  useEffect(() => {
    if (!isLayoutMenuOpen) return;

    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (
        layoutMenuContainerRef.current &&
        layoutMenuContainerRef.current.contains(event.target as Node)
      ) {
        return;
      }
      setIsLayoutMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsLayoutMenuOpen(false);
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isLayoutMenuOpen]);

  // Close create menu on click outside or Escape
  useEffect(() => {
    if (!isCreateMenuOpen) return;

    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (
        createMenuContainerRef.current &&
        createMenuContainerRef.current.contains(event.target as Node)
      ) {
        return;
      }
      setIsCreateMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsCreateMenuOpen(false);
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isCreateMenuOpen]);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      if (!entries[0]) return;
      const { width, height } = entries[0].contentRect;
      setContainerSize({ width, height });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Spatial Indexing: Build Quadtree
  const quadtree = useMemo(() => {
    return d3
      .quadtree<GraphNode>()
      .x((d) => d.x)
      .y((d) => d.y)
      .addAll(nodes);
  }, [nodes]);

  // Determine "Parents" (Nodes that are sources of edges)
  const parentIds = useMemo(() => {
    const pIds = new Set<string>();
    edges.forEach((e) => pIds.add(e.source));
    return pIds;
  }, [edges]);

  // Build map of scope -> children for cluster visualization
  const childrenByScope = useMemo(() => {
    const map = new Map<string, GraphNode[]>();
    nodes.forEach((node) => {
      if (node.scopeId) {
        const children = map.get(node.scopeId) || [];
        children.push(node);
        map.set(node.scopeId, children);
      }
    });
    return map;
  }, [nodes]);

  // Memoize viewport bounds separately for better cache hit rate
  const viewportBounds = useMemo(() => {
    const k = viewTransform.k || 0.1;
    return {
      vpX: -viewTransform.x / k,
      vpY: -viewTransform.y / k,
      vpW: containerSize.width / k,
      vpH: containerSize.height / k,
      k,
    };
  }, [
    viewTransform.x,
    viewTransform.y,
    viewTransform.k,
    containerSize.width,
    containerSize.height,
  ]);

  // Safe transform values to prevent NaN from breaking SVG rendering
  const safeTransform = useMemo(() => ({
    x: Number.isFinite(viewTransform.x) ? viewTransform.x : 0,
    y: Number.isFinite(viewTransform.y) ? viewTransform.y : 0,
    k: Number.isFinite(viewTransform.k) && viewTransform.k > 0 ? viewTransform.k : 1,
  }), [viewTransform.x, viewTransform.y, viewTransform.k]);

  const { visibleNodes, skeletonNodes, bufferedNodes, visibleEdges, lodLevel, nodeMap } =
    useMemo(() => {
      const { vpX, vpY, vpW, vpH, k } = viewportBounds;

      // First pass: count visible nodes for density calculation
      // We'll do a quick viewport check before dynamic LOD calculation
      let roughVisibleCount = 0;
      quadtree.visit((node, x1, y1, x2, y2) => {
        if (!node.length) {
          do {
            const d = node.data;
            if (
              d.x < vpX + vpW + 500 &&
              d.x + (d.width || 300) > vpX - 500 &&
              d.y < vpY + vpH + 500 &&
              d.y + (d.height || 200) > vpY - 500
            ) {
              roughVisibleCount++;
            }
          } while ((node = node.next));
        }
        return (
          x1 > vpX + vpW + 500 ||
          y1 > vpY + vpH + 500 ||
          x2 < vpX - 500 ||
          y2 < vpY - 500
        );
      });

      // Determine LOD Level dynamically based on zoom AND node density
      const { lodLevel: currentLod } = calculateDynamicLOD(
        k,
        roughVisibleCount,
        previousLOD,
        DEFAULT_LOD_CONFIG
      );

      // Viewport Calculations
      // Buffer determines how much off-screen content we render to allow smooth panning
      // At low zoom (high info density), we reduce buffer to save performance
      const bufferMultiplier = 1.5;
      const bufferX = vpW * bufferMultiplier;
      const bufferY = vpH * bufferMultiplier;

      const renderRect = {
        left: vpX - bufferX,
        top: vpY - bufferY,
        right: vpX + vpW + bufferX,
        bottom: vpY + vpH + bufferY,
      };

      // Quadtree Range Search
      // Since quadtree indexes points (x,y), and nodes have width/height,
      // we must expand the query box left/up by the max possible node size
      // to catch nodes whose top-left is outside but body is inside.
      const MAX_NODE_DIM = 4000; // Increased from 2000 to better handle large nodes and long edges
      const queryLeft = renderRect.left - MAX_NODE_DIM;
      const queryTop = renderRect.top - MAX_NODE_DIM;

      const visible: GraphNode[] = [];

      // Visit Quadtree to find visible nodes
      quadtree.visit((node, x1, y1, x2, y2) => {
        // Cull quadrants completely outside
        if (!node.length) {
          do {
            const d = node.data;
            const nW = d.width || DEFAULT_NODE_WIDTH;
            const nH = d.height || DEFAULT_NODE_HEIGHT;

            // Validate coordinates to avoid rendering crashes
            if (
              typeof d.x !== "number" ||
              typeof d.y !== "number" ||
              isNaN(d.x) ||
              isNaN(d.y)
            ) {
              return;
            }

            // Check intersection
            const right = d.x + nW;
            const bottom = d.y + nH;

            if (
              d.x < renderRect.right &&
              right > renderRect.left &&
              d.y < renderRect.bottom &&
              bottom > renderRect.top
            ) {
              visible.push(d);
            }
          } while ((node = node.next));
        }
        return (
          x1 >= renderRect.right ||
          y1 >= renderRect.bottom ||
          x2 < queryLeft ||
          y2 < queryTop
        );
      });

      // Edge visibility calculation
      let visEdges: GraphEdge[] = [];
      const nodeMap = new Map(nodes.map((n) => [n.id, n]));

      // Use a more generous buffer for edge culling to prevent flickering
      const EDGE_CULL_BUFFER = 500; // Extra buffer beyond renderRect

      // Helper to determine if two nodes are in the same cluster (share same scope)
      const isIntraClusterEdge = (
        source: GraphNode,
        target: GraphNode
      ): boolean => {
        // If both nodes have the same scope, they're in the same cluster
        if (source.scopeId && source.scopeId === target.scopeId) return true;
        // If one node is the scope parent of the other, it's intra-cluster
        if (source.id === target.scopeId || target.id === source.scopeId)
          return true;
        return false;
      };

      visEdges = edges.filter((e) => {
        const source = nodeMap.get(e.source);
        const target = nodeMap.get(e.target);
        // Must have both nodes to render edge
        if (!source || !target) return false;

        // Check for valid coordinates
        if (
          typeof source.x !== "number" ||
          typeof source.y !== "number" ||
          typeof target.x !== "number" ||
          typeof target.y !== "number" ||
          isNaN(source.x) ||
          isNaN(source.y) ||
          isNaN(target.x) ||
          isNaN(target.y)
        ) {
          return false;
        }


        const sW = source.width || DEFAULT_NODE_WIDTH;
        const sH = source.height || DEFAULT_NODE_HEIGHT;
        const tW = target.width || DEFAULT_NODE_WIDTH;
        const tH = target.height || DEFAULT_NODE_HEIGHT;

        // Calculate bounding box that encompasses the entire edge path
        // This includes both nodes and the space between them
        const left = Math.min(source.x, target.x);
        const right = Math.max(source.x + sW, target.x + tW);
        const top = Math.min(source.y, target.y);
        const bottom = Math.max(source.y + sH, target.y + tH);

        // Apply generous buffer to prevent edges from disappearing at viewport boundaries
        return (
          left < renderRect.right + EDGE_CULL_BUFFER &&
          right > renderRect.left - EDGE_CULL_BUFFER &&
          top < renderRect.bottom + EDGE_CULL_BUFFER &&
          bottom > renderRect.top - EDGE_CULL_BUFFER
        );
      });

      // Separate loaded nodes from skeleton nodes based on _loadState
      const loadedNodes = visible.filter(
        (n) => n._loadState === "loaded" || n._loadState === undefined
      );
      const skeletonNodes = visible.filter(
        (n) => n._loadState === "position-only" || n._loadState === "loading"
      );

      return {
        visibleNodes: loadedNodes,
        skeletonNodes,
        bufferedNodes: [], // Deprecated in favor of Quadtree direct query
        visibleEdges: visEdges,
        lodLevel: currentLod,
        nodeMap,
      };
    }, [nodes, edges, viewTransform, containerSize, quadtree, previousLOD]);

  // Update previous LOD for hysteresis calculation
  useEffect(() => {
    setPreviousLOD(lodLevel);
  }, [lodLevel]);

  // Fractal Zoom & Interaction
  useEffect(() => {
    if (!containerRef.current) return;
    const selection = d3.select(containerRef.current);

    const zoom = d3
      .zoom<HTMLDivElement, unknown>()
      .scaleExtent([0.01, 4]) // Allow zooming out further (0.01) for infinite canvas feel
      .on("start", () => {
        isDraggingRef.current = false;
      })
      .on("zoom", (event) => {
        isDraggingRef.current = true;
        const t = event.transform;

        // Semantic Zoom Shift
        // If we hit the semantic shift threshold, we pop up to the parent scope
        if (
          t.k < LOD_THRESHOLD_SEMANTIC_SHIFT &&
          onNavigateUp &&
          currentScopeId
        ) {
          onNavigateUp(currentScopeId);
          zoom.transform(selection, d3.zoomIdentity.translate(0, 0).scale(1));
          return;
        }

        onViewTransformChange(t);
      })
      .filter((event) => {
        if (event.shiftKey) return false;
        if (
          draggingIdRef.current ||
          resizingIdRef.current ||
          connectingNodeIdRef.current
        )
          return false;
        const target = event.target as HTMLElement;
        if (["INPUT", "BUTTON", "A", "TEXTAREA"].includes(target.tagName)) {
          if (event.type === "wheel") return event.ctrlKey;
          if (event.type === "mousedown" || event.type === "touchstart")
            return false;
        }
        // Disable zoom/pan if interacting with a node or the selection tooltip
        const nodeElement = target.closest(".graph-node") as HTMLElement;
        if (nodeElement) {
          if (event.type === "mousedown" || event.type === "touchstart")
            return false;
        }
        if (target.closest(".selection-tooltip")) return false;

        // Allow wheel events for zoom ONLY if Ctrl is pressed
        if (event.type === "wheel") return event.ctrlKey;
        // Block two-finger touches so our custom gesture handler can process them
        if (event.type === "touchstart" && (event as TouchEvent).touches?.length >= 2) {
          return false;
        }
        return !event.button; // Only allow panning with no button pressed (i.e. mouse wheel, or touch pan)
      });
    zoomBehaviorRef.current = zoom;
    selection
      .call(zoom)
      .on("dblclick.zoom", null)
      .on("wheel.pan", (event) => {
        if (!event.ctrlKey) {
          event.preventDefault();
          const currentT = d3.zoomTransform(selection.node()!);
          zoom.translateBy(
            selection,
            -event.deltaX / currentT.k,
            -event.deltaY / currentT.k
          );
        }
      });

    return () => {
      selection.on(".zoom", null);
      selection.on("wheel.pan", null);
    };
  }, [onViewTransformChange, onNavigateDown, onNavigateUp, currentScopeId]);

  // Sync React ViewTransform -> D3 Zoom State
  useEffect(() => {
    if (!containerRef.current || !zoomBehaviorRef.current) return;
    const selection = d3.select(containerRef.current);
    const currentT = d3.zoomTransform(selection.node()!);
    const kDiff = Math.abs(currentT.k - viewTransform.k);
    const xDiff = Math.abs(currentT.x - viewTransform.x);
    const yDiff = Math.abs(currentT.y - viewTransform.y);
    if (kDiff > 0.001 || xDiff > 0.1 || yDiff > 0.1) {
      selection.call(
        zoomBehaviorRef.current.transform,
        d3.zoomIdentity
          .translate(viewTransform.x, viewTransform.y)
          .scale(viewTransform.k)
      );
    }
  }, [viewTransform]);

  // Capture-phase handler for wheel events (zoom and pan)
  useEffect(() => {
    if (!containerRef.current || !zoomBehaviorRef.current) return;

    const container = containerRef.current;
    const zoom = zoomBehaviorRef.current;
    const selection = d3.select(container);

    const handleWheelCapture = (event: WheelEvent) => {
      const target = event.target as HTMLElement;
      const nodeElement = target.closest(".graph-node") as HTMLElement | null;

      // Check if hovering over a selected node
      const isOverSelectedNode =
        nodeElement && selectedNodeIds.has(nodeElement.dataset.nodeId || "");

      if (event.ctrlKey) {
        // ZOOM: Ctrl+wheel always zooms canvas, even over selected nodes
        event.preventDefault();
        event.stopPropagation();

        // Calculate zoom delta (normalize across different browsers/input devices)
        const delta =
          -event.deltaY *
          (event.deltaMode === 1 ? 0.05 : event.deltaMode ? 1 : 0.002);

        const currentTransform = d3.zoomTransform(container);
        const rect = container.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;

        const scaleFactor = Math.pow(2, delta);
        let newK = currentTransform.k * scaleFactor;

        const [minK, maxK] = zoom.scaleExtent();
        newK = Math.max(minK, Math.min(maxK, newK));

        // Semantic Zoom Shift: Navigate up if zoomed out past threshold
        // if (
        //   newK < LOD_THRESHOLD_SEMANTIC_SHIFT &&
        //   onNavigateUp &&
        //   currentScopeId
        // ) {
        //   onNavigateUp(currentScopeId);
        //   selection.call(
        //     zoom.transform,
        //     d3.zoomIdentity.translate(0, 0).scale(1)
        //   );
        //   return;
        // }

        const newX = x - (x - currentTransform.x) * (newK / currentTransform.k);
        const newY = y - (y - currentTransform.y) * (newK / currentTransform.k);

        const newTransform = d3.zoomIdentity.translate(newX, newY).scale(newK);
        selection.call(zoom.transform, newTransform);
      } else {
        // PAN: Regular scroll (no Ctrl)
        if (isOverSelectedNode) {
          // Over selected node: stop propagation to prevent wheel.pan handler,
          // but DON'T preventDefault so browser scrolls the node content
          event.stopPropagation();
          return;
        }

        // Over unselected node or canvas: pan the canvas
        event.preventDefault();
        event.stopPropagation();

        const currentTransform = d3.zoomTransform(container);
        zoom.translateBy(
          selection,
          -event.deltaX / currentTransform.k,
          -event.deltaY / currentTransform.k
        );
      }
    };

    // Use capture phase to intercept before child elements handle the event
    container.addEventListener("wheel", handleWheelCapture, {
      capture: true,
      passive: false,
    });

    return () => {
      container.removeEventListener("wheel", handleWheelCapture, {
        capture: true,
      });
    };
  }, [currentScopeId, selectedNodeIds]);

  const resolveCollisions = useCallback(
    (fixedNodeId?: string, activeNodeIds?: Set<string>) => {
      // Use functional state update to ensure we always have latest nodes
      // AND prevent race conditions where we overwrite the position of the dragged node
      // with an old position from the simulation start.
      setNodes((currentNodes) => {
        // If we are dragging, we must ensure the fixedNodeId (the dragged node)
        // maintains the position set by the mouse event, which might be newer than
        // what's in 'currentNodes' if state updates are batched.
        // actually, currentNodes inside setNodes is the latest committed state.
        // The issue is if we call resolveCollisions, it runs a simulation on currentNodes.
        // If we are dragging, the mouse move updates state -> triggers render.
        // If we call resolveCollisions inside the mouse move handler, it stacks up.

        return resolveCollisionsInScope(
          currentNodes,
          edges,
          fixedNodeId ?? null,
          currentScopeId ?? null,
          selectedNodeIds,
          activeNodeIds
        );
      });
    },
    [setNodes, edges, currentScopeId]
  );

  const prevNodesLength = useRef(nodes.length);
  useEffect(() => {
    if (nodes.length > prevNodesLength.current) {
      setTimeout(() => resolveCollisions(), 50);
    }
    prevNodesLength.current = nodes.length;
  }, [nodes.length, resolveCollisions]);

  // Selection Listeners
  useEffect(() => {
    const handleSelectionChange = () => {
      const sel = window.getSelection();
      if (
        (!sel || sel.isCollapsed) &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        onSelectionTooltipChange?.(null);
      }
    };
    const handleMouseUp = (e: MouseEvent | TouchEvent) => {
      if (draggingId || resizingId || dragStartRef.current || connectingNodeId)
        return;
      const target = e.target as HTMLElement;
      if (target.closest(".selection-tooltip")) return;

      let text = "",
        rect: {
          left: number;
          top: number;
          width: number;
          height: number;
          bottom?: number;
        } | null = null,
        sourceId: string | undefined;
      const activeEl = document.activeElement as HTMLElement;

      if (activeEl && activeEl.tagName === "TEXTAREA") {
        const textarea = activeEl as HTMLTextAreaElement;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        if (start !== end) {
          text = textarea.value.substring(start, end);
          let clientX =
            "touches" in e
              ? (e as TouchEvent).changedTouches[0].clientX
              : (e as MouseEvent).clientX;
          let clientY =
            "touches" in e
              ? (e as TouchEvent).changedTouches[0].clientY
              : (e as MouseEvent).clientY;
          rect = {
            left: clientX,
            top: clientY - 40,
            width: 0,
            height: 0,
            bottom: clientY + 10,
          };
          let curr: HTMLElement | null = textarea;
          while (curr && !curr.dataset.nodeId) curr = curr.parentElement;
          if (curr) sourceId = curr.dataset.nodeId;
        }
      } else {
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed) {
          text = selection.toString();
          if (text.trim()) {
            const range = selection.getRangeAt(0);
            const r = range.getBoundingClientRect();
            rect = {
              left: r.left,
              top: r.top,
              width: r.width,
              height: r.height,
              bottom: r.bottom,
            };
            let curr: Node | null = selection.anchorNode;
            while (
              curr &&
              (curr.nodeType !== Node.ELEMENT_NODE ||
                !(curr as HTMLElement).dataset.nodeId)
            ) {
              curr = curr.parentNode;
            }
            if (curr) sourceId = (curr as HTMLElement).dataset.nodeId;
          }
        }
      }

      if (text && rect) {
        onSelectionTooltipChange?.({
          x: rect.left + rect.width / 2,
          y: rect.top,
          bottom: rect.bottom,
          text: text.trim(),
          sourceId,
        });
      } else {
        onSelectionTooltipChange?.(null);
      }
    };

    document.addEventListener("selectionchange", handleSelectionChange);
    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("touchend", handleMouseUp);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("touchend", handleMouseUp);
    };
  }, [draggingId, resizingId, connectingNodeId, onSelectionTooltipChange]);

  // Drag Logic
  useEffect(() => {
    const handleEnd = (e: MouseEvent | TouchEvent) => {
      // Box Selection End
      if (selectionBox) {
        const x = Math.min(selectionBox.startX, selectionBox.currentX);
        const y = Math.min(selectionBox.startY, selectionBox.currentY);
        const w = Math.abs(selectionBox.startX - selectionBox.currentX);
        const h = Math.abs(selectionBox.startY - selectionBox.currentY);

        if (w > 5 || h > 5) {
          const toCanvas = (sx: number, sy: number) => ({
            x: (sx - viewTransform.x) / viewTransform.k,
            y: (sy - viewTransform.y) / viewTransform.k,
          });

          const p1 = toCanvas(x, y);
          const p2 = toCanvas(x + w, y + h);

          const left = Math.min(p1.x, p2.x);
          const right = Math.max(p1.x, p2.x);
          const top = Math.min(p1.y, p2.y);
          const bottom = Math.max(p1.y, p2.y);

          const selectedIds = nodes
            .filter((n) => {
              const nW = n.width || DEFAULT_NODE_WIDTH;
              const nH = n.height || DEFAULT_NODE_HEIGHT;
              const nRight = n.x + nW;
              const nBottom = n.y + nH;
              // Check intersection
              return (
                n.x < right && nRight > left && n.y < bottom && nBottom > top
              );
            })
            .map((n) => n.id);

          if (onMultiSelect && selectedIds.length > 0) {
            onMultiSelect(selectedIds, true);
          }
        } else {
          // Treat as click? Handled by handleBackgroundClick usually
        }
        setSelectionBox(null);
      }

      // Check for Click on Selected Node (Deselect others)
      if (draggingId && dragStartRef.current) {
        let clientX =
          "touches" in e
            ? e.changedTouches[0].clientX
            : (e as MouseEvent).clientX;
        let clientY =
          "touches" in e
            ? e.changedTouches[0].clientY
            : (e as MouseEvent).clientY;

        const { mouseX, mouseY } = dragStartRef.current;
        const dist = Math.hypot(clientX - mouseX, clientY - mouseY);

        if (dist < 5) {
          // Node click without drag - no action needed
          // Nodes are only minimized via the minimize button, not by clicking
        }
      }

      // End physics drag mode (simulation continues until stabilized)
      if (draggingId) {
        physicsEndDrag();
      }

      setDraggingId(null);
      setResizingId(null);
      setResizeDirection(null);
      dragStartRef.current = null;

      // Physics engine now handles collision resolution during simulation
      // No need for manual resolveCollisions call
    };

    const handleMove = (e: MouseEvent | TouchEvent) => {
      let clientX =
        "touches" in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
      let clientY =
        "touches" in e ? e.touches[0].clientY : (e as MouseEvent).clientY;

      setMousePos({ x: clientX, y: clientY });

      if (selectionBox) {
        setSelectionBox((prev) =>
          prev ? { ...prev, currentX: clientX, currentY: clientY } : null
        );
        return;
      }

      if (!dragStartRef.current) return;
      if (e.type === "touchmove" && (draggingId || resizingId))
        e.preventDefault();

      const {
        mouseX,
        mouseY,
        initialPositions,
        nodeWidth,
        nodeHeight,
        lastX,
        lastY,
      } = dragStartRef.current;
      const dx = (clientX - mouseX) / viewTransform.k;
      const dy = (clientY - mouseY) / viewTransform.k;

      const incDx = (clientX - lastX) / viewTransform.k;
      const incDy = (clientY - lastY) / viewTransform.k;

      dragStartRef.current.lastX = clientX;
      dragStartRef.current.lastY = clientY;

      if (draggingId) {
        const currentDragState = dragStartRef.current;
        if (!currentDragState) {
          console.error("dragStartRef.current is null during dragging.");
          return;
        }

        // Calculate new position for dragged node
        const init = currentDragState.initialPositions.get(draggingId);
        if (init) {
          const newX = init.x + dx;
          const newY = init.y + dy;

          // Update the dragged node position directly
          setNodes((prev) =>
            prev.map((node) =>
              node.id === draggingId
                ? { ...node, x: newX, y: newY }
                : node
            )
          );

          // Update physics engine with new drag position
          // The physics engine handles subtree following and collisions
          physicsUpdateDrag(draggingId, newX, newY);
        }
      } else if (resizingId && nodeWidth && nodeHeight) {
        setNodes((prev) =>
          prev.map((node) => {
            if (node.id === resizingId) {
              const initPos =
                dragStartRef.current?.initialPositions.get(resizingId);
              if (!initPos) return node;

              let newWidth = nodeWidth;
              let newHeight = nodeHeight;
              let newX = initPos.x;
              let newY = initPos.y;

              switch (resizeDirection) {
                case "e":
                  newWidth = Math.max(MIN_NODE_WIDTH, nodeWidth + dx);
                  break;
                case "s":
                  newHeight = Math.max(MIN_NODE_HEIGHT, nodeHeight + dy);
                  break;
                case "se":
                  newWidth = Math.max(MIN_NODE_WIDTH, nodeWidth + dx);
                  newHeight = Math.max(MIN_NODE_HEIGHT, nodeHeight + dy);
                  break;
                case "sw":
                  // Left edge moves, right edge stays fixed
                  newWidth = Math.max(MIN_NODE_WIDTH, nodeWidth - dx);
                  newX = initPos.x + (nodeWidth - newWidth);
                  newHeight = Math.max(MIN_NODE_HEIGHT, nodeHeight + dy);
                  break;
                case "nw":
                  // Top-left corner: both edges move, bottom-right stays fixed
                  newWidth = Math.max(MIN_NODE_WIDTH, nodeWidth - dx);
                  newX = initPos.x + (nodeWidth - newWidth);
                  newHeight = Math.max(MIN_NODE_HEIGHT, nodeHeight - dy);
                  newY = initPos.y + (nodeHeight - newHeight);
                  break;
                case "ne":
                  // Top-right corner: top edge moves, bottom stays fixed
                  newWidth = Math.max(MIN_NODE_WIDTH, nodeWidth + dx);
                  newHeight = Math.max(MIN_NODE_HEIGHT, nodeHeight - dy);
                  newY = initPos.y + (nodeHeight - newHeight);
                  break;
                default:
                  break;
              }

              return {
                ...node,
                x: newX,
                y: newY,
                width: newWidth,
                height: newHeight,
              };
            }
            return node;
          })
        );
      }
    };

    window.addEventListener("mouseup", handleEnd);
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("touchend", handleEnd);
    window.addEventListener("touchmove", handleMove, { passive: false });
    return () => {
      window.removeEventListener("mouseup", handleEnd);
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("touchend", handleEnd);
      window.removeEventListener("touchmove", handleMove);
    };
  }, [
    draggingId,
    resizingId,
    resizeDirection,
    selectionBox,
    viewTransform,
    setNodes,
    resolveCollisions,
    nodes,
    selectedNodeIds,
    onMultiSelect,
    onNodeSelect,
  ]);

  const handleNodeMouseDown = useCallback(
    (e: React.MouseEvent | React.TouchEvent, id: string) => {
      e.stopPropagation();
      if (connectingNodeId) {
        if (id !== connectingNodeId) onConnectEnd(connectingNodeId, id);
        return;
      }

      const isShift = (e as React.MouseEvent).shiftKey;
      const isSelected = selectedNodeIds.has(id);

      // Set this node as the active (highlighted) node
      setActiveNodeId(id);

      if (isShift) {
        // Toggle selection
        onNodeSelect(id, true);
        // If we are deselecting (was selected, now toggled off), do not start drag
        if (isSelected) return;
      } else {
        // No Shift - always add to selection (keeps other nodes expanded)
        // Nodes are only minimized via the minimize button, not by clicking other nodes
        onNodeSelect(id, true);
      }

      // Calculate the effective selection for dragging purposes
      // Only drag the single clicked node, not the entire expanded group
      const effectiveSelectedIds = new Set<string>();
      effectiveSelectedIds.add(id);

      const target = e.target as HTMLElement;
      if (
        ["INPUT", "TEXTAREA"].includes(target.tagName) ||
        target.closest("button") ||
        target.closest("a")
      )
        return;

      let clientX =
        "touches" in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
      let clientY =
        "touches" in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;

      setDraggingId(id);

      // Start physics simulation for drag
      physicsStartDrag(id);

      const initialPositions = new Map();
      nodes.forEach((n) => {
        if (effectiveSelectedIds.has(n.id)) {
          initialPositions.set(n.id, { x: n.x, y: n.y });
        }
      });

      dragStartRef.current = {
        mouseX: clientX,
        mouseY: clientY,
        lastX: clientX,
        lastY: clientY,
        initialPositions,
      };
    },
    [nodes, connectingNodeId, onConnectEnd, onNodeSelect, selectedNodeIds, physicsStartDrag]
  );

  const handleBackgroundMouseDown = useCallback((e: React.MouseEvent) => {
    // Shift + Drag on background -> Box Selection
    if (e.shiftKey && e.button === 0) {
      e.stopPropagation();
      e.preventDefault(); // Prevent text selection etc
      const clientX = e.clientX;
      const clientY = e.clientY;

      setSelectionBox({
        startX: clientX,
        startY: clientY,
        currentX: clientX,
        currentY: clientY,
      });
    }
  }, []);

  const handleBackgroundClick = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (contextMenu) setContextMenu(null);
      if (connectingNodeId) {
        onCancelConnect();
        return;
      }
      if (isDraggingRef.current) return;
      const target = e.target as HTMLElement;

      if (target.closest(".graph-node")) return;

      if (
        target === containerRef.current ||
        target.closest(".canvas-background")
      ) {
        // Clear active node (deselect) but keep nodes expanded
        // Node minimization is handled by the minimize button in the node tooltip
        setActiveNodeId(null);
        onSelectionTooltipChange?.(null);
      }
    },
    [connectingNodeId, onCancelConnect, contextMenu, onSelectionTooltipChange]
  );

  const openContextMenuAtClientPoint = useCallback(
    (clientX: number, clientY: number) => {
      const canvasX = (clientX - viewTransform.x) / viewTransform.k;
      const canvasY = (clientY - viewTransform.y) / viewTransform.k;

      setContextMenu({
        x: clientX,
        y: clientY,
        canvasX,
        canvasY,
      });
    },
    [viewTransform]
  );

  const cancelLongPressContextMenu = useCallback(() => {
    if (longPressContextMenuTimerRef.current) {
      clearTimeout(longPressContextMenuTimerRef.current);
      longPressContextMenuTimerRef.current = null;
    }
    longPressContextMenuStartPointRef.current = null;
    if (twoFingerLongPressTimerRef.current) {
      clearTimeout(twoFingerLongPressTimerRef.current);
      twoFingerLongPressTimerRef.current = null;
    }
    twoFingerLongPressStartPointRef.current = null;
  }, []);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (draggingId || resizingId || connectingNodeId) return;

      const target = e.target as HTMLElement;
      if (
        ["INPUT", "BUTTON", "A", "TEXTAREA"].includes(target.tagName) ||
        target.closest("button")
      ) {
        return;
      }

      openContextMenuAtClientPoint(e.clientX, e.clientY);
    },
    [openContextMenuAtClientPoint, draggingId, resizingId, connectingNodeId]
  );

  const handleBackgroundTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (draggingId || resizingId || connectingNodeId) return;
      const target = e.target as HTMLElement;
      if (target.closest(".graph-node")) return;

      // Two-finger gestures: tap (quick) or long-press
      if (e.touches.length === 2) {
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const clientX = (t1.clientX + t2.clientX) / 2;
        const clientY = (t1.clientY + t2.clientY) / 2;

        // Cancel any existing one-finger long-press timer
        cancelLongPressContextMenu();

        // Store midpoint for two-finger long-press
        twoFingerLongPressStartPointRef.current = { x: clientX, y: clientY };

        // Track start time for two-finger tap detection
        twoFingerTapStartTimeRef.current = Date.now();

        // Start two-finger long-press timer (500ms)
        twoFingerLongPressTimerRef.current = window.setTimeout(() => {
          const start = twoFingerLongPressStartPointRef.current;
          if (!start) return;
          longPressContextMenuOpenedRef.current = true;
          openContextMenuAtClientPoint(start.x, start.y);
        }, 500);
        return;
      }

      // One-finger long press
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      longPressContextMenuOpenedRef.current = false;
      longPressContextMenuStartPointRef.current = {
        x: touch.clientX,
        y: touch.clientY,
      };
      cancelLongPressContextMenu();
      longPressContextMenuTimerRef.current = window.setTimeout(() => {
        const start = longPressContextMenuStartPointRef.current;
        if (!start) return;
        longPressContextMenuOpenedRef.current = true;
        openContextMenuAtClientPoint(start.x, start.y);
      }, 500);
    },
    [
      draggingId,
      resizingId,
      connectingNodeId,
      cancelLongPressContextMenu,
      openContextMenuAtClientPoint,
    ]
  );

  const handleBackgroundTouchMove = useCallback(
    (e: React.TouchEvent) => {
      // Handle two-finger gesture movement cancellation (both tap and long-press)
      if (e.touches.length === 2 && twoFingerLongPressStartPointRef.current) {
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const currentMidX = (t1.clientX + t2.clientX) / 2;
        const currentMidY = (t1.clientY + t2.clientY) / 2;
        const start = twoFingerLongPressStartPointRef.current;
        const dist = Math.hypot(currentMidX - start.x, currentMidY - start.y);
        if (dist > 10) {
          cancelLongPressContextMenu();
          twoFingerTapStartTimeRef.current = null; // Also cancel tap tracking
        }
        return;
      }

      // Handle one-finger long-press movement cancellation
      const start = longPressContextMenuStartPointRef.current;
      if (!start) return;
      if (e.touches.length !== 1) {
        cancelLongPressContextMenu();
        return;
      }
      const touch = e.touches[0];
      const dist = Math.hypot(touch.clientX - start.x, touch.clientY - start.y);
      if (dist > 10) {
        cancelLongPressContextMenu();
      }
    },
    [cancelLongPressContextMenu]
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      // Capture values before cancelling (cancel clears the refs)
      const twoFingerTapStartTime = twoFingerTapStartTimeRef.current;
      const twoFingerMidpoint = twoFingerLongPressStartPointRef.current;
      const longPressOpened = longPressContextMenuOpenedRef.current;

      // Cancel any pending long-press timers
      cancelLongPressContextMenu();

      // Long-press menu opened: consume end so we don't also trigger tap logic
      if (longPressOpened) {
        longPressContextMenuOpenedRef.current = false;
        twoFingerTapStartTimeRef.current = null;
        return;
      }

      // Two-finger tap: if we had two fingers down and now all fingers lifted quickly
      if (
        twoFingerTapStartTime &&
        twoFingerMidpoint &&
        e.touches.length === 0
      ) {
        const elapsed = Date.now() - twoFingerTapStartTime;
        if (elapsed < 300) {
          // Quick two-finger tap - open context menu at stored midpoint
          openContextMenuAtClientPoint(twoFingerMidpoint.x, twoFingerMidpoint.y);
          twoFingerTapStartTimeRef.current = null;
          return;
        }
      }
      twoFingerTapStartTimeRef.current = null;

      const now = Date.now();
      if (now - lastTapRef.current < 300) {
        // Double tap
        if (e.changedTouches.length > 0) {
          const touch = e.changedTouches[0];
          openContextMenuAtClientPoint(touch.clientX, touch.clientY);
        }
      }
      lastTapRef.current = now;
    },
    [cancelLongPressContextMenu, openContextMenuAtClientPoint]
  );

  const handleResizeStart = useCallback(
    (
      e: React.MouseEvent | React.TouchEvent,
      id: string,
      direction: ResizeDirection
    ) => {
      e.stopPropagation();
      const node = nodes.find((n) => n.id === id);
      if (!node) return;
      let clientX =
        "touches" in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
      let clientY =
        "touches" in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
      setResizingId(id);
      setResizeDirection(direction);

      const initialPositions = new Map();
      initialPositions.set(id, { x: node.x, y: node.y });

      dragStartRef.current = {
        mouseX: clientX,
        mouseY: clientY,
        lastX: clientX,
        lastY: clientY,
        initialPositions,
        nodeWidth: node.width || DEFAULT_NODE_WIDTH,
        nodeHeight: node.height || DEFAULT_NODE_HEIGHT,
      };
    },
    [nodes]
  );

  const handleFocusCanvas = useCallback(() => {
    if (nodes.length === 0) return;

    let targetX: number | undefined;
    let targetY: number | undefined;
    let k = 1;

    // 1. Focus on Selected Node
    if (selectedNodeId) {
      const node = nodes.find((n) => n.id === selectedNodeId);
      if (node) {
        targetX = node.x + (node.width || DEFAULT_NODE_WIDTH) / 2;
        targetY = node.y + (node.height || DEFAULT_NODE_HEIGHT) / 2;
      }
    }

    // 2. Focus on Center of Mass (if no selection)
    if (targetX === undefined || targetY === undefined) {
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;

      let hasValidNodes = false;
      nodes.forEach((n) => {
        if (
          typeof n.x !== "number" ||
          typeof n.y !== "number" ||
          isNaN(n.x) ||
          isNaN(n.y)
        )
          return;
        hasValidNodes = true;
        const w = n.width || DEFAULT_NODE_WIDTH;
        const h = n.height || DEFAULT_NODE_HEIGHT;
        minX = Math.min(minX, n.x);
        minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x + w);
        maxY = Math.max(maxY, n.y + h);
      });

      if (!hasValidNodes) return;

      const width = maxX - minX + 200; // Padding
      const height = maxY - minY + 200;

      targetX = (minX + maxX) / 2;
      targetY = (minY + maxY) / 2;

      const scaleX = window.innerWidth / width;
      const scaleY = window.innerHeight / height;
      k = Math.min(scaleX, scaleY, 1);
      k = Math.max(k, 0.1);
    }

    const newX = window.innerWidth / 2 - targetX * k;
    const newY = window.innerHeight / 2 - targetY * k;

    onViewTransformChange({ x: newX, y: newY, k });
  }, [nodes, selectedNodeId, onViewTransformChange]);

  // Handler for arranging children of a node using physics simulation
  const handleArrangeChildren = useCallback((nodeId: string) => {
    if (!startSimulation) return;

    // Find the node to center on
    const node = nodes.find((n) => n.id === nodeId);
    if (node) {
      // Center viewport on the node
      const nodeCenterX = node.x + (node.width || DEFAULT_NODE_WIDTH) / 2;
      const nodeCenterY = node.y + (node.height || DEFAULT_NODE_HEIGHT) / 2;
      const k = viewTransform.k;
      const newX = window.innerWidth / 2 - nodeCenterX * k;
      const newY = window.innerHeight / 2 - nodeCenterY * k;
      onViewTransformChange({ x: newX, y: newY, k });
    }

    // Start the physics simulation for this node's children
    startSimulation('manual-subtree', nodeId);
  }, [nodes, startSimulation, viewTransform.k, onViewTransformChange]);

  // Handler for arranging children of a node in a circular layout (immediate, no physics)
  const handleCircularLayout = useCallback((nodeId: string) => {
    const parentNode = nodes.find((n) => n.id === nodeId);
    if (!parentNode) return;

    const childNodes = childrenByScope.get(nodeId) || [];
    if (childNodes.length === 0) return;

    // Compute circular positions for children
    const positions = computeSurroundChildPositions(parentNode, childNodes);

    // Update all child positions
    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        const newPos = positions.get(node.id);
        if (newPos) {
          return { ...node, x: newPos.x, y: newPos.y };
        }
        return node;
      })
    );

    // Center viewport on the parent node
    const nodeCenterX = parentNode.x + (parentNode.width || DEFAULT_NODE_WIDTH) / 2;
    const nodeCenterY = parentNode.y + (parentNode.height || DEFAULT_NODE_HEIGHT) / 2;
    const k = viewTransform.k;
    const newX = window.innerWidth / 2 - nodeCenterX * k;
    const newY = window.innerHeight / 2 - nodeCenterY * k;
    onViewTransformChange({ x: newX, y: newY, k });
  }, [nodes, childrenByScope, setNodes, viewTransform.k, onViewTransformChange]);

  const applyLayout = (type: LayoutType) => {
    if (nodes.length === 0) return;
    setActiveLayout(type);

    // For force layout, just trigger physics simulation without repositioning
    if (type === "force") {
      startSimulation("manual-relayout");
      return;
    }

    setNodes((currentNodes) => {
      // Create effective nodes for layout calculation
      const effectiveNodes = currentNodes.map((n) => ({
        ...n,
        height: selectedNodeIds.has(n.id)
          ? n.height || DEFAULT_NODE_HEIGHT
          : NODE_HEADER_HEIGHT,
      }));

      let laidOutNodes: GraphNode[] = currentNodes;

      switch (type) {
        case "tree-tb":
          laidOutNodes = applyTreeLayout(effectiveNodes, edges, "TB");
          break;
        case "tree-lr":
          laidOutNodes = applyTreeLayout(effectiveNodes, edges, "LR");
          break;
        case "hybrid":
          laidOutNodes = applyHybridLayout(effectiveNodes, edges, "TB");
          break;
        case "isolate-subgraph":
          if (!selectedNodeId) return currentNodes;
          laidOutNodes = applySubgraphIsolationLayout(
            effectiveNodes,
            edges,
            selectedNodeId
          );
          break;
        default:
          return currentNodes;
      }

      // Map positions back to original nodes
      const posMap = new Map(
        laidOutNodes.map((n) => [n.id, { x: n.x, y: n.y }])
      );
      return currentNodes.map((n) => {
        const pos = posMap.get(n.id);
        return pos ? { ...n, x: pos.x, y: pos.y } : n;
      });
    });

    // After initial positioning, run physics simulation to let nodes settle
    setTimeout(() => {
      startSimulation("manual-relayout");
    }, 50);
  };

  const addNewNode = (type: NodeType, pos?: { x: number; y: number }) => {
    let cx, cy;
    if (pos) {
      cx = pos.x;
      cy = pos.y;
    } else {
      cx =
        (containerSize.width / 2 - viewTransform.x) / viewTransform.k -
        DEFAULT_NODE_WIDTH / 2;
      cy =
        (containerSize.height / 2 - viewTransform.y) / viewTransform.k -
        DEFAULT_NODE_HEIGHT / 2;
    }
    const newNode: GraphNode = {
      id: crypto.randomUUID(),
      type,
      x: cx,
      y: cy,
      content: type === NodeType.CHAT ? "New Chat" : "",
      width: DEFAULT_NODE_WIDTH,
      height: DEFAULT_NODE_HEIGHT,
      messages: [],
      scopeId: currentScopeId || undefined,
    };
    setNodes((prev) => [...prev, newNode]);
    onNodeSelect(newNode.id);
    setContextMenu(null);

    // If added via sidebar (no specific position provided), center viewport on new node
    if (!pos) {
      const k = 1; // Focus zoom level
      const nodeCenterX = newNode.x + (newNode.width || DEFAULT_NODE_WIDTH) / 2;
      const nodeCenterY =
        newNode.y + (newNode.height || DEFAULT_NODE_HEIGHT) / 2;

      const newX = window.innerWidth / 2 - nodeCenterX * k;
      const newY = window.innerHeight / 2 - nodeCenterY * k;

      onViewTransformChange({ x: newX, y: newY, k });
    }
  };

  const bgSize = 40 * viewTransform.k;
  const bgX = Math.round(viewTransform.x % bgSize);
  const bgY = Math.round(viewTransform.y % bgSize);

  let connectingLine = null;
  if (connectingNodeId) {
    const source = nodes.find((n) => n.id === connectingNodeId);
    if (source) {
      const startX = source.x + (source.width || DEFAULT_NODE_WIDTH) / 2;
      const startY = source.y + (source.height || DEFAULT_NODE_HEIGHT) / 2;
      const endX = (mousePos.x - viewTransform.x) / viewTransform.k;
      const endY = (mousePos.y - viewTransform.y) / viewTransform.k;
      connectingLine = (
        <line
          x1={startX}
          y1={startY}
          x2={endX}
          y2={endY}
          stroke={COLORS.activeEdgeStroke}
          strokeWidth={2}
          strokeDasharray="5,5"
          className="animate-pulse pointer-events-none"
        />
      );
    }
  }

  const isMobile =
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 768px)").matches;

  const canvasStyle: React.CSSProperties = useMemo(() => {
    if (isMobile) return {};

    const style: React.CSSProperties = {};

    if (canvasShiftX > 0) {
      style.marginLeft = `${canvasShiftX}px`;
    } else if (canvasShiftX < 0) {
      style.marginRight = `${-canvasShiftX}px`;
    }

    if (canvasShiftY > 0) {
      style.marginTop = `${canvasShiftY}px`;
    } else if (canvasShiftY < 0) {
      style.marginBottom = `${-canvasShiftY}px`;
    }

    return style;
  }, [canvasShiftX, canvasShiftY, isMobile]);

  return (
    <div className="flex flex-col-reverse md:flex-row w-full h-full overflow-hidden bg-slate-950">
      {/* Toolbar */}
      <div className="z-40 bg-slate-900 border-t md:border-t-0 md:border-r border-slate-800 shadow-xl w-full h-16 md:w-16 md:h-full flex flex-row md:flex-col items-center justify-between p-2 md:py-4 shrink-0">
        <div className="flex flex-row md:flex-col gap-4 md:gap-4 items-center">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleMenu && onToggleMenu();
            }}
            className="hidden md:flex w-10 h-10 rounded-full bg-gradient-to-br from-sky-500 to-blue-600 items-center justify-center shadow-lg mb-4 hover:brightness-110 transition-all group"
            title="Toggle Outline View"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-5 h-5 group-hover:scale-110 transition-transform"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {/* Outline/tree icon */}
              <circle cx="5" cy="6" r="1.5" />
              <line x1="10" y1="6" x2="20" y2="6" />
              <circle cx="8" cy="12" r="1.5" />
              <line x1="13" y1="12" x2="20" y2="12" />
              <circle cx="8" cy="18" r="1.5" />
              <line x1="13" y1="18" x2="20" y2="18" />
            </svg>
          </button>
        </div>
        <div className="flex flex-row md:flex-col gap-4 md:gap-4 border-l md:border-l-0 md:border-t border-slate-800 pl-4 md:pl-0 md:pt-4 items-center">
          <button
            onClick={handleFocusCanvas}
            className="p-2 text-slate-500 hover:text-sky-400 hover:bg-slate-800 rounded-lg md:mb-2 mr-2 md:mr-0"
            title={selectedNodeId ? "Focus Selected" : "Focus Canvas"}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <circle cx="12" cy="12" r="3" />
              <line x1="12" y1="2" x2="12" y2="5" />
              <line x1="12" y1="19" x2="12" y2="22" />
              <line x1="2" y1="12" x2="5" y2="12" />
              <line x1="19" y1="12" x2="22" y2="12" />
            </svg>
          </button>
          <div
            ref={layoutMenuContainerRef}
            className="relative md:mb-2 mr-2 md:mr-0"
          >
            <button
              onClick={() => setIsLayoutMenuOpen((prev) => !prev)}
              className={`p-2 rounded-lg transition-all ${
                isLayoutMenuOpen
                  ? "text-sky-400 bg-slate-800 ring-1 ring-sky-500/40"
                  : "text-slate-500 hover:text-sky-400 hover:bg-slate-800"
              }`}
              title="Choose Layout"
              aria-haspopup="menu"
              aria-expanded={isLayoutMenuOpen}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-5 h-5"
              >
                <rect x="3" y="4" width="7" height="7" rx="1" />
                <rect x="14" y="4" width="7" height="7" rx="1" />
                <rect x="3" y="15" width="7" height="7" rx="1" />
                <rect x="14" y="15" width="7" height="7" rx="1" />
              </svg>
            </button>
            {isLayoutMenuOpen && (
              <div
                className="absolute z-50 w-64 bg-slate-950 border border-slate-800 rounded-2xl shadow-2xl p-3 pointer-events-auto animate-in fade-in
                bottom-full mb-3 right-0 origin-bottom-right slide-in-from-bottom-2
                md:bottom-0 md:mb-0 md:left-full md:ml-3 md:right-auto md:top-auto md:origin-bottom-left md:slide-in-from-left-2 md:slide-in-from-bottom-0"
              >
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2 px-1">
                  Choose Layout
                </p>
                <div className="flex flex-col gap-1">
                  {SIDEBAR_LAYOUT_OPTIONS.map((option) => {
                    const disabled =
                      option.requiresSelection && !selectedNodeId;
                    return (
                      <button
                        key={option.type}
                        onClick={() => {
                          if (disabled) return;
                          applyLayout(option.type);
                          setIsLayoutMenuOpen(false);
                        }}
                        className={`w-full flex items-start gap-3 px-3 py-2 rounded-xl text-left transition-colors ${
                          disabled
                            ? "opacity-40 cursor-not-allowed"
                            : "hover:bg-slate-900/80 focus-visible:outline-none focus:bg-slate-900/80"
                        }`}
                        title={
                          disabled && option.requiresSelection
                            ? "Select a node to use this layout"
                            : option.label
                        }
                      >
                        <span className="text-slate-400 shrink-0">
                          {option.icon}
                        </span>
                        <span className="flex-1">
                          <span className="block text-sm font-semibold text-white">
                            {option.label}
                          </span>
                          <span className="block text-xs text-slate-400">
                            {option.description}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 relative overflow-hidden">
        {/* Fullscreen Background & Event Handler Wrapper */}
        <div
          ref={containerRef} // Attach D3 zoom to this fullscreen wrapper
          className={`absolute inset-0 overflow-hidden cursor-default canvas-background touch-none ${
            connectingNodeId ? "cursor-crosshair" : ""
          }`}
          style={{
            backgroundImage: "radial-gradient(#334155 1px, transparent 1px)",
            backgroundSize: `${bgSize}px ${bgSize}px`,
            backgroundPosition: `${bgX}px ${bgY}px`,
            backgroundRepeat: "repeat",
          }}
          onMouseDown={handleBackgroundMouseDown}
          onClick={handleBackgroundClick}
          onContextMenu={handleContextMenu}
          onTouchStart={handleBackgroundTouchStart}
          onTouchMove={handleBackgroundTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {/* Content Container with Margins (for side panel avoidance) */}
          <div
            className="absolute inset-0 overflow-visible pointer-events-none"
            style={{
              ...canvasStyle,
              transition: isResizing ? "none" : "margin 0.3s ease-out",
            }}
          >
            {/* Mobile Outline Toggle - Fixed Top Left */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleMenu && onToggleMenu();
              }}
              className="md:hidden absolute top-4 left-4 z-50 w-10 h-10 rounded-full bg-slate-900/80 backdrop-blur border border-slate-700 text-white flex items-center justify-center shadow-lg pointer-events-auto"
              title="Toggle Outline View"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="w-5 h-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {/* Outline/tree icon */}
                <circle cx="5" cy="6" r="1.5" />
                <line x1="10" y1="6" x2="20" y2="6" />
                <circle cx="8" cy="12" r="1.5" />
                <line x1="13" y1="12" x2="20" y2="12" />
                <circle cx="8" cy="18" r="1.5" />
                <line x1="13" y1="18" x2="20" y2="18" />
              </svg>
            </button>

            {/* Floating Create Button - Bottom Center */}
            <div
              ref={createMenuContainerRef}
              className="absolute bottom-20 md:bottom-4 left-1/2 -translate-x-1/2 z-50 pointer-events-auto"
            >
              <button
                onClick={() => setIsCreateMenuOpen((prev) => !prev)}
                className={`w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-all ${
                  isCreateMenuOpen
                    ? "bg-sky-500 text-white ring-2 ring-sky-400/50"
                    : "bg-gradient-to-br from-sky-500 to-blue-600 text-white hover:brightness-110"
                }`}
                title="Create Node"
                aria-haspopup="menu"
                aria-expanded={isCreateMenuOpen}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={`transition-transform ${isCreateMenuOpen ? "rotate-45" : ""}`}
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
              {isCreateMenuOpen && (
                <div
                  className="absolute z-50 w-48 bg-slate-950 border border-slate-800 rounded-2xl shadow-2xl p-2 animate-in fade-in slide-in-from-bottom-2
                  bottom-full mb-3 left-1/2 -translate-x-1/2 origin-bottom"
                >
                  <button
                    onClick={() => {
                      addNewNode(NodeType.NOTE);
                      setIsCreateMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-colors hover:bg-slate-900/80"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="text-slate-400"
                    >
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                    <span className="text-sm font-medium text-white">Create Note</span>
                  </button>
                  <button
                    onClick={() => {
                      addNewNode(NodeType.CHAT);
                      setIsCreateMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-colors hover:bg-slate-900/80"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="text-slate-400"
                    >
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                    <span className="text-sm font-medium text-white">Create AI Chat</span>
                  </button>
                </div>
              )}
            </div>

            {/* Selection Box */}
            {selectionBox && (
              <div
                className="absolute border border-sky-400 bg-sky-400/20 pointer-events-none z-[9999]"
                style={{
                  left: Math.min(selectionBox.startX, selectionBox.currentX),
                  top: Math.min(selectionBox.startY, selectionBox.currentY),
                  width: Math.abs(selectionBox.startX - selectionBox.currentX),
                  height: Math.abs(selectionBox.startY - selectionBox.currentY),
                }}
              />
            )}

            {connectingNodeId && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-sky-900/80 text-sky-200 px-4 py-2 rounded-full text-sm font-bold z-50 pointer-events-none animate-in fade-in slide-in-from-top-4">
                Click another node to connect
              </div>
            )}

            <svg
              ref={svgRef}
              className="absolute top-0 left-0 w-full h-full pointer-events-none overflow-visible"
            >
              <defs>
                <marker
                  id="arrowhead"
                  markerWidth="10"
                  markerHeight="7"
                  refX="10"
                  refY="3.5"
                  orient="auto"
                >
                  <polygon points="0 0, 10 3.5, 0 7" fill={COLORS.edgeStroke} />
                </marker>
                <marker
                  id="arrowhead-active"
                  markerWidth="10"
                  markerHeight="7"
                  refX="10"
                  refY="3.5"
                  orient="auto"
                >
                  <polygon
                    points="0 0, 10 3.5, 0 7"
                    fill={COLORS.activeEdgeStroke}
                  />
                </marker>
              </defs>
              <g
                transform={`translate(${safeTransform.x},${safeTransform.y}) scale(${safeTransform.k})`}
              >
                {visibleEdges.map((edge) => (
                  <Edge
                    key={edge.id}
                    edge={edge}
                    sourceNode={nodeMap.get(edge.source)!}
                    targetNode={nodeMap.get(edge.target)!}
                    lodLevel={lodLevel}
                    sourceIsParent={parentIds.has(edge.source)}
                    targetIsParent={parentIds.has(edge.target)}
                    sourceIsSelected={selectedNodeIds.has(edge.source)}
                    targetIsSelected={selectedNodeIds.has(edge.target)}
                    isDragging={draggingId !== null}
                    edgeStyle={
                      activeLayout === "tree-lr" ? "sankey-lr" : "default"
                    }
                  />
                ))}
                {expandingNodeIds.map((id) => {
                  const node = nodes.find((n) => n.id === id);
                  if (!node) return null;
                  return (
                    <SkeletonGraph
                      key={`skeleton-${id}`}
                      x={node.x + (node.width || 300) + 50}
                      y={node.y}
                    />
                  );
                })}
                {connectingLine}
              </g>
            </svg>

            <div
              className="absolute top-0 left-0 overflow-visible origin-top-left pointer-events-none"
              style={{
                width: "0px",
                height: "0px",
                transform: `translate(${safeTransform.x}px, ${safeTransform.y}px) scale(${safeTransform.k})`,
              }}
            >
              {/* Render skeleton nodes (position-only or loading) with LOD awareness */}
              {skeletonNodes.map((node) => (
                <NodeSkeleton
                  key={`skeleton-${node.id}`}
                  x={node.x}
                  y={node.y}
                  width={node.width || DEFAULT_NODE_WIDTH}
                  height={
                    lodLevel === "TITLE"
                      ? NODE_HEADER_HEIGHT
                      : node.height || DEFAULT_NODE_HEIGHT
                  }
                  color={node.color}
                  lodLevel={lodLevel}
                  isLoading={node._loadState === "loading"}
                />
              ))}

              {visibleNodes.map((node) => (
                <div key={node.id} className="pointer-events-auto">
                  <GraphNodeComponent
                    key={node.id}
                    node={node}
                    allNodes={allNodes}
                    childNodes={childrenByScope.get(node.id)}
                    isSelected={
                      activeNodeId === node.id || connectingNodeId === node.id
                    }
                    isExpanded={
                      selectedNodeIds.has(node.id) ||
                      connectingNodeId === node.id
                    }
                    isDragging={draggingId === node.id}
                    viewMode="canvas"
                    lodLevel={lodLevel}
                    isClusterParent={parentIds.has(node.id)}
                    onMouseDown={handleNodeMouseDown}
                    onUpdate={onUpdateNode}
                    onExpand={onExpandNode}
                    onExpandFromWikidata={onExpandNodeFromWikidata}
                    onDelete={onDeleteNode}
                    onResizeStart={handleResizeStart}
                    onToggleMaximize={onMaximizeNode}
                    onMinimize={(id) => {
                      onNodeSelect(id, "remove");
                      if (activeNodeId === id) setActiveNodeId(null);
                    }}
                    onOpenLink={onOpenLink}
                    onNavigateToNode={onNavigateToNode}
                    onConnectStart={onConnectStart}
                    onViewSubgraph={(id) => {
                      if (onNavigateDown) onNavigateDown(id);
                    }}
                    autoGraphEnabled={autoGraphEnabled}
                    onSetAutoGraphEnabled={onSetAutoGraphEnabled}
                    scale={viewTransform.k}
                    cutNodeId={cutNodeId}
                    aiProvider={aiProvider}
                    onTogglePin={togglePinNode}
                    onArrangeChildren={startSimulation ? handleArrangeChildren : undefined}
                    onCircularLayout={handleCircularLayout}
                  />
                </div>
              ))}
            </div>

            <div className="absolute bottom-20 md:bottom-6 left-6 pointer-events-none opacity-50 text-xs text-slate-500 font-mono">
              ZOOM: {Math.round(viewTransform.k * 100)}% | NODES:{" "}
              {visibleNodes.length}/{nodes.length}
              {skeletonNodes.length > 0 && ` (${skeletonNodes.length} loading)`} | EDGES:{" "}
              {visibleEdges.length}/{edges.length}
            </div>

            {expandingNodeIds.length > 0 && (
              <div className="absolute bottom-20 md:bottom-6 right-6 bg-slate-800/90 backdrop-blur text-sky-400 px-4 py-2 rounded-full border border-sky-500/30 shadow-lg animate-pulse flex items-center gap-2 z-[100]">
                <div className="w-2 h-2 bg-sky-400 rounded-full animate-bounce" />
                <span className="text-xs font-bold uppercase tracking-wide">
                  Generating Graph ({expandingNodeIds.length})...
                </span>
              </div>
            )}

            {contextMenu && (
              <div
                className="fixed z-[10000] bg-slate-800 text-white rounded-lg shadow-xl border border-slate-700 flex flex-col min-w-[150px] overflow-hidden animate-in fade-in zoom-in duration-100 origin-top-left pointer-events-auto"
                style={{
                  left: contextMenu.x,
                  top: contextMenu.y,
                }}
                onClick={(e) => e.stopPropagation()}
                onContextMenu={(e) => e.preventDefault()}
              >
                <button
                  className="w-full text-left px-4 py-2 hover:bg-slate-700 text-sm flex items-center gap-2"
                  onClick={() => {
                    addNewNode(NodeType.NOTE, {
                      x: contextMenu.canvasX,
                      y: contextMenu.canvasY,
                    });
                  }}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-slate-400"
                  >
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                  Create Note
                </button>
                <button
                  className="w-full text-left px-4 py-2 hover:bg-slate-700 text-sm flex items-center gap-2 border-t border-slate-700"
                  onClick={() => {
                    addNewNode(NodeType.CHAT, {
                      x: contextMenu.canvasX,
                      y: contextMenu.canvasY,
                    });
                  }}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-slate-400"
                  >
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  Create AI Chat
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
