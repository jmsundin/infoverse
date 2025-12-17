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
  applyForceLayout,
  applyTreeLayout,
  applyHybridLayout,
  applySubgraphIsolationLayout,
  resolveCollisions as resolveCollisionsService,
  getSubgraphIds,
} from "../services/layoutService";

interface CanvasProps {
  nodes: GraphNode[];
  allNodes: GraphNode[];
  edges: GraphEdge[];
  setNodes: React.Dispatch<React.SetStateAction<GraphNode[]>>;
  setEdges: React.Dispatch<React.SetStateAction<GraphEdge[]>>;
  viewTransform: ViewportTransform;
  onViewTransformChange: (transform: ViewportTransform) => void;
  onOpenStorage?: () => void;
  storageConnected?: boolean;
  storageDirName?: string | null;
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
  onNodeSelect: (id: string | null, multi?: boolean) => void;
  onMultiSelect?: (ids: string[], multi?: boolean) => void;
  canvasShiftX: number;
  canvasShiftY: number;
  onSelectionTooltipChange?: (tooltip: SelectionTooltipState | null) => void;
  isResizing?: boolean;
  cutNodeId: string | null;
  setCutNodeId: React.Dispatch<React.SetStateAction<string | null>>;
  aiProvider?: 'gemini' | 'huggingface';
}

// Semantic Zoom Thresholds
// < 0.25: Cluster/Dot Mode (Infinite Canvas Optimization)
// 0.25 - 0.5: Title Mode (Headers)
// > 0.5: Detail Mode (Full Content)
const LOD_THRESHOLD_CLUSTER = 0.4;
const LOD_THRESHOLD_TITLE = 0.6;
const LOD_THRESHOLD_SEMANTIC_SHIFT = 0.05; // Trigger scope up very far out

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
  const scopeNodes = allNodes.filter((n) => n.parentId == currentScopeId);
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
  onOpenStorage,
  storageConnected = false,
  storageDirName,
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
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const longPressContextMenuTimerRef = useRef<number | null>(null);
  const longPressContextMenuStartPointRef = useRef<{
    x: number;
    y: number;
  } | null>(null);
  const longPressContextMenuOpenedRef = useRef(false);
  const layoutMenuContainerRef = useRef<HTMLDivElement | null>(null);

  // Derived state
  const selectedNodeId = useMemo(
    () => (selectedNodeIds.size === 1 ? Array.from(selectedNodeIds)[0] : null),
    [selectedNodeIds]
  );

  const [containerSize, setContainerSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
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

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    canvasX: number;
    canvasY: number;
  } | null>(null);
  const lastTapRef = useRef<number>(0);
  const [isLayoutMenuOpen, setIsLayoutMenuOpen] = useState(false);

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

  const { visibleNodes, bufferedNodes, visibleEdges, lodLevel, nodeMap } =
    useMemo(() => {
      const k = viewTransform.k || 0.1;
      const vpX = -viewTransform.x / k;
      const vpY = -viewTransform.y / k;
      const vpW = containerSize.width / k;
      const vpH = containerSize.height / k;

      // Determine LOD Level based on zoom
      let currentLod: LODLevel = "DETAIL";
      if (k < LOD_THRESHOLD_CLUSTER) currentLod = "CLUSTER";
      else if (k < LOD_THRESHOLD_TITLE) currentLod = "TITLE";

      // Viewport Calculations
      // Buffer determines how much off-screen content we render to allow smooth panning
      // At low zoom (high info density), we reduce buffer to save performance
      const bufferMultiplier = currentLod === "CLUSTER" ? 0.5 : 1.5;
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
      const MAX_NODE_DIM = 2000;
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

      // In CLUSTER mode, do not render edges/connections
      let visEdges: GraphEdge[] = [];
      const nodeMap = new Map(nodes.map((n) => [n.id, n]));

      // Always render edges regardless of LOD
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
          typeof target.y !== "number"
        ) {
          return false;
        }

        const sW = source.width || DEFAULT_NODE_WIDTH;
        const sH = source.height || DEFAULT_NODE_HEIGHT;
        const tW = target.width || DEFAULT_NODE_WIDTH;
        const tH = target.height || DEFAULT_NODE_HEIGHT;

        const left = Math.min(source.x, target.x);
        const right = Math.max(source.x + sW, target.x + tW);
        const top = Math.min(source.y, target.y);
        const bottom = Math.max(source.y + sH, target.y + tH);

        return (
          left < renderRect.right &&
          right > renderRect.left &&
          top < renderRect.bottom &&
          bottom > renderRect.top
        );
      });

      return {
        visibleNodes: visible,
        bufferedNodes: [], // Deprecated in favor of Quadtree direct query
        visibleEdges: visEdges,
        lodLevel: currentLod,
        nodeMap,
      };
    }, [nodes, edges, viewTransform, containerSize, quadtree]);

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

      const wasInteracting = draggingId || resizingId;
      const interactingId = draggingId || resizingId;

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
          const isShift = (e as MouseEvent).shiftKey;

          // If we clicked a selected node without shift, we deferred the clear-others logic. Do it now.
          if (!isShift && selectedNodeIds.has(draggingId)) {
            onNodeSelect(draggingId, false);
          }
        }
      }

      setDraggingId(null);
      setResizingId(null);
      setResizeDirection(null);
      dragStartRef.current = null;
      // Final settle
      if (wasInteracting && interactingId) {
        const activeIds = getSubgraphIds(interactingId, edges);
        resolveCollisions(interactingId, activeIds);
      }
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
        const currentDragState = dragStartRef.current; // Capture current value
        if (!currentDragState) {
          console.error("dragStartRef.current is null during dragging.");
          return; // Exit early if null
        }

        setNodes((prev) => {
          const nodeMap = new Map(prev.map((n) => [n.id, n]));
          const deltas = new Map<string, { dx: number; dy: number }>();
          const processed = new Set<string>();
          const roots = new Set(currentDragState.initialPositions.keys());

          // Initialize Physics State if needed
          if (!currentDragState.velocities) {
            currentDragState.velocities = new Map();
            currentDragState.childrenMasses = new Map();
          }
          const velocities = currentDragState.velocities;
          const masses = currentDragState.childrenMasses;

          if (!velocities || !masses) {
            console.error("Physics state not initialized correctly.");
            return prev;
          }

          // 1. Calculate deltas for dragged nodes (roots of movement)
          roots.forEach((id) => {
            const init = currentDragState.initialPositions.get(id);
            const current = nodeMap.get(id);
            if (init && current) {
              const targetX = init.x + dx;
              const targetY = init.y + dy;
              // Parent moves directly (infinite mass/force)
              deltas.set(id, {
                dx: targetX - current.x,
                dy: targetY - current.y,
              });
              processed.add(id);
            }
          });

          const queue = Array.from(roots);

          while (queue.length > 0) {
            const parentId = queue.shift();
            if (!parentId || processed.has(parentId)) continue;

            processed.add(parentId);
            // Add force to children, proportional to mass
            edges.forEach((edge) => {
              if (edge.source === parentId) {
                const childId = edge.target;
                const childNode = nodeMap.get(childId);
                if (
                  childNode &&
                  !processed.has(childId) &&
                  !roots.has(childId) // Don't move if it's a root of another drag
                ) {
                  const parentDelta = deltas.get(parentId);
                  if (parentDelta) {
                    // Apply force/velocity rather than direct position change
                    const currentVelocity = velocities.get(childId) || {
                      vx: 0,
                      vy: 0,
                    };
                    velocities.set(childId, {
                      vx: currentVelocity.vx + parentDelta.dx * 0.1,
                      vy: currentVelocity.vy + parentDelta.dy * 0.1,
                    });
                    // Propagate to children
                    queue.push(childId);
                  }
                }
              }
            });
          }

          const newNodes = prev.map((node) => {
            // Apply velocities
            const velocity = velocities.get(node.id);
            if (velocity) {
              nodeMap.set(node.id, {
                ...node,
                x: node.x + velocity.vx,
                y: node.y + velocity.vy,
              });
              // Dampen velocity
              velocities.set(node.id, {
                vx: velocity.vx * 0.9,
                vy: velocity.vy * 0.9,
              });
            }
            const delta = deltas.get(node.id);
            if (delta) {
              return {
                ...node,
                x: node.x + delta.dx,
                y: node.y + delta.dy,
              };
            }
            return node;
          });

          return newNodes;
        });
      } else if (resizingId && nodeWidth && nodeHeight) {
        setNodes((prev) =>
          prev.map((node) => {
            if (node.id === resizingId) {
              let newWidth = nodeWidth;
              let newHeight = nodeHeight;

              switch (resizeDirection) {
                case "e": // Changed from "right"
                  newWidth = Math.max(50, nodeWidth + dx * viewTransform.k);
                  break;
                case "s": // Changed from "bottom"
                  newHeight = Math.max(50, nodeHeight + dy * viewTransform.k);
                  break;
                case "se": // Changed from "bottom-right"
                  newWidth = Math.max(50, nodeWidth + dx * viewTransform.k);
                  newHeight = Math.max(50, nodeHeight + dy * viewTransform.k);
                  break;
                default:
                  break;
              }

              return {
                ...node,
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

      if (isShift) {
        // Toggle selection
        onNodeSelect(id, true);
        // If we are deselecting (was selected, now toggled off), do not start drag
        if (isSelected) return;
      } else {
        // No Shift
        if (!isSelected) {
          // New selection: select this one, clear others
          onNodeSelect(id, false);
        }
        // If ALREADY selected: Do NOT call onNodeSelect(id, false) yet.
        // We defer this to MouseUp to allow dragging the whole group.
        // See handleEnd logic.
      }

      // Calculate the effective selection for dragging purposes
      const effectiveSelectedIds = new Set(selectedNodeIds);
      if (isShift) {
        if (!isSelected) effectiveSelectedIds.add(id);
      } else {
        if (!isSelected) {
          effectiveSelectedIds.clear();
          effectiveSelectedIds.add(id);
        }
        // If isSelected, effectiveSelectedIds is just selectedNodeIds (whole group)
      }

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
    [nodes, connectingNodeId, onConnectEnd, onNodeSelect, selectedNodeIds]
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
        onNodeSelect(null);
        onSelectionTooltipChange?.(null);
      }
    },
    [
      connectingNodeId,
      onCancelConnect,
      onNodeSelect,
      contextMenu,
      onSelectionTooltipChange,
    ]
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

      // Two-finger tap: open context menu at midpoint
      if (e.touches.length === 2) {
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const clientX = (t1.clientX + t2.clientX) / 2;
        const clientY = (t1.clientY + t2.clientY) / 2;
        longPressContextMenuOpenedRef.current = true;
        cancelLongPressContextMenu();
        openContextMenuAtClientPoint(clientX, clientY);
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
      // Long-press menu opened: consume end so we don't also trigger double-tap logic
      cancelLongPressContextMenu();
      if (longPressContextMenuOpenedRef.current) {
        longPressContextMenuOpenedRef.current = false;
        return;
      }

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

  const applyLayout = (type: LayoutType) => {
    if (nodes.length === 0) return;

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
        case "force":
          laidOutNodes = applyForceLayout(effectiveNodes, edges);
          break;
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
      parentId: currentScopeId || undefined,
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
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="4" y1="18" x2="20" y2="18" />
            </svg>
          </button>
          <button
            onClick={() => addNewNode(NodeType.NOTE)}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-all"
            title="Add Note"
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
            >
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>
          <button
            onClick={() => addNewNode(NodeType.CHAT)}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-all"
            title="Add Chat"
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
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </button>
          {onOpenStorage && (
            <button
              onClick={onOpenStorage}
              className={`p-2 rounded-lg transition-all ${
                storageConnected
                  ? "text-green-400"
                  : "text-slate-400 hover:text-white"
              }`}
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
              >
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
            </button>
          )}
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
        />

        {/* Content Container with Margins (for side panel avoidance) */}
        <div
          className="absolute inset-0 overflow-visible pointer-events-none"
          style={{
            ...canvasStyle,
            transition: isResizing ? "none" : "margin 0.3s ease-out",
          }}
        >
          {/* Mobile Hamburger - Fixed Top Left (stays in layout) */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleMenu && onToggleMenu();
            }}
            className="md:hidden absolute top-4 left-4 z-50 w-10 h-10 rounded-full bg-slate-900/80 backdrop-blur border border-slate-700 text-white flex items-center justify-center shadow-lg pointer-events-auto"
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
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="4" y1="18" x2="20" y2="18" />
            </svg>
          </button>

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
              transform={`translate(${viewTransform.x},${viewTransform.y}) scale(${viewTransform.k})`}
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
                  sourceIsSelected={selectedNodeId === edge.source}
                  targetIsSelected={selectedNodeId === edge.target}
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
              transform: `translate(${viewTransform.x}px, ${viewTransform.y}px) scale(${viewTransform.k})`,
            }}
          >
            {bufferedNodes.map((node) => (
              <NodeSkeleton
                key={`skeleton-${node.id}`}
                x={node.x}
                y={node.y}
                width={node.width || DEFAULT_NODE_WIDTH}
                height={node.height || DEFAULT_NODE_HEIGHT}
                color={node.color}
              />
            ))}

            {visibleNodes.map((node) => (
              <div key={`wrapper-${node.id}`} className="pointer-events-auto">
                <GraphNodeComponent
                  key={node.id}
                  node={node}
                  allNodes={allNodes}
                  isSelected={
                    selectedNodeId === node.id || connectingNodeId === node.id
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
                />
              </div>
            ))}
          </div>

          <div className="absolute bottom-20 md:bottom-6 left-6 pointer-events-none opacity-50 text-xs text-slate-500 font-mono">
            ZOOM: {Math.round(viewTransform.k * 100)}% | NODES:{" "}
            {visibleNodes.length}/{nodes.length} | EDGES: {visibleEdges.length}/
            {edges.length}
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
  );
};
