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
} from "../types";
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
} from "../constants";
import {
  sendChatMessage,
  getTopicSummaryPrompt,
} from "../services/geminiService";

interface CanvasProps {
  nodes: GraphNode[];
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
  onMaximizeNode: (id: string) => void;
  onExpandNode: (id: string, topic: string) => void;
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
  selectedNodeId: string | null;
  onNodeSelect: (id: string | null) => void;
}

// Semantic Zoom Thresholds
// < 0.1: Cluster/Dot Mode (Infinite Canvas Optimization)
// 0.1 - 0.5: Title Mode (Headers)
// > 0.5: Detail Mode (Full Content)
const LOD_THRESHOLD_CLUSTER = 0.1;
const LOD_THRESHOLD_TITLE = 0.5;
const LOD_THRESHOLD_SEMANTIC_SHIFT = 0.05; // Trigger scope up very far out

export const Canvas: React.FC<CanvasProps> = ({
  nodes,
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
  onMaximizeNode,
  onExpandNode,
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
  selectedNodeId,
  onNodeSelect,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [containerSize, setContainerSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [resizingId, setResizingId] = useState<string | null>(null);
  const [resizeDirection, setResizeDirection] =
    useState<ResizeDirection | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  const [selectionTooltip, setSelectionTooltip] = useState<{
    x: number;
    y: number;
    bottom?: number;
    text: string;
    sourceId?: string;
  } | null>(null);

  const dragStartRef = useRef<{
    mouseX: number;
    mouseY: number;
    nodeX: number;
    nodeY: number;
    nodeWidth: number;
    nodeHeight: number;
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

      if (currentLod !== "CLUSTER") {
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
      }

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
        if (event.type === "wheel" && event.ctrlKey) return true;
        if (event.type === "wheel" && !event.ctrlKey) return false;
        const nodeElement = target.closest(".graph-node") as HTMLElement;
        if (nodeElement) {
          if (event.type === "mousedown" || event.type === "touchstart")
            return false;
        }
        if (target.closest(".selection-tooltip")) return false;
        return !event.button;
      });

    selection.call(zoom).on("dblclick.zoom", null);
    zoomBehaviorRef.current = zoom;

    selection.on("wheel.pan", (event) => {
      if (event.ctrlKey) return;
      if (draggingIdRef.current || resizingIdRef.current) return;
      const target = event.target as HTMLElement;
      const nodeElement = target.closest(".graph-node") as HTMLElement;
      if (nodeElement && nodeElement.dataset.selected === "true") return;

      event.preventDefault();
      const currentK = d3.zoomTransform(selection.node()!).k;
      zoom.translateBy(
        selection,
        -event.deltaX / currentK,
        -event.deltaY / currentK
      );
    });

    return () => {
      selection.on(".zoom", null);
      selection.on(".pan", null);
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
    (fixedNodeId?: string) => {
      setNodes((currentNodes) => {
        const simNodes = currentNodes.map((n) => ({
          ...n,
          fx: n.id === fixedNodeId ? n.x : undefined,
          fy: n.id === fixedNodeId ? n.y : undefined,
          effectiveW: n.width || DEFAULT_NODE_WIDTH,
          effectiveH: n.height || DEFAULT_NODE_HEIGHT,
        }));

        // Filter edges to only those where both source and target exist in the simulation
        const nodeIds = new Set(simNodes.map((n) => n.id));
        const validEdges = edges.filter(
          (e) => nodeIds.has(e.source) && nodeIds.has(e.target)
        );

        const simulation = d3
          .forceSimulation(simNodes as any)
          .force("charge", d3.forceManyBody().strength(-2000))
          .force(
            "link",
            d3
              .forceLink(validEdges.map((e) => ({ ...e })))
              .id((d: any) => d.id)
              .distance(500)
          )
          .force(
            "collide",
            d3
              .forceCollide()
              .radius((d: any) => {
                const w = d.effectiveW;
                const h = d.effectiveH;
                const radius = Math.sqrt(w * w + h * h) / 2;
                return radius + 5;
              })
              .iterations(8)
              .strength(1)
          )
          .stop();

        for (let i = 0; i < 150; ++i) simulation.tick();

        return currentNodes.map((n, i) => ({
          ...n,
          x: (simNodes[i] as any).x,
          y: (simNodes[i] as any).y,
        }));
      });
    },
    [setNodes, edges]
  );

  const prevNodesLength = useRef(nodes.length);
  useEffect(() => {
    if (nodes.length > prevNodesLength.current) {
      setTimeout(() => resolveCollisions(), 50);
    }
    prevNodesLength.current = nodes.length;
  }, [nodes.length, resolveCollisions]);

  const handleCreateFromSelection = useCallback(
    async (type: NodeType) => {
      if (!selectionTooltip) return;
      let newNodeX = 0,
        newNodeY = 0;
      const sourceNode = nodes.find((n) => n.id === selectionTooltip.sourceId);
      if (sourceNode) {
        newNodeX = sourceNode.x + (sourceNode.width || DEFAULT_NODE_WIDTH) + 50; // Reduced offset from 100 to 50
        newNodeY = sourceNode.y;
      } else {
        const canvasX =
          (selectionTooltip.x - viewTransform.x) / viewTransform.k;
        const canvasY =
          (selectionTooltip.y - viewTransform.y) / viewTransform.k;
        newNodeX = canvasX + 100;
        newNodeY = canvasY + 50;
      }

      const promptTemplate = getTopicSummaryPrompt(selectionTooltip.text);
      const initialMessages: ChatMessage[] =
        type === NodeType.CHAT
          ? [
              {
                role: "user",
                text: selectionTooltip.text,
                timestamp: Date.now(),
              },
            ]
          : [];
      const initialModelMsg: ChatMessage | undefined =
        type === NodeType.CHAT
          ? { role: "model", text: "", timestamp: Date.now() }
          : undefined;
      const startMessages =
        type === NodeType.CHAT && initialModelMsg
          ? [...initialMessages, initialModelMsg]
          : initialMessages;

      const newNode: GraphNode = {
        id: crypto.randomUUID(),
        type,
        x: newNodeX,
        y: newNodeY,
        content:
          type === NodeType.NOTE
            ? selectionTooltip.text
            : selectionTooltip.text.length > 30
            ? selectionTooltip.text.substring(0, 30) + "..."
            : selectionTooltip.text,
        messages: startMessages,
        width: DEFAULT_NODE_WIDTH,
        height: DEFAULT_NODE_HEIGHT,
        parentId: currentScopeId || undefined,
      };

      setNodes((prev) => [...prev, newNode]);
      onNodeSelect(newNode.id);

      if (selectionTooltip.sourceId) {
        const labelText =
          selectionTooltip.text.length > 20
            ? selectionTooltip.text.substring(0, 20) + "..."
            : selectionTooltip.text;
        setEdges((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            source: selectionTooltip.sourceId!,
            target: newNode.id,
            label: labelText,
            parentId: currentScopeId || undefined,
          },
        ]);
      }
      setSelectionTooltip(null);
      window.getSelection()?.removeAllRanges();

      if (type === NodeType.CHAT) {
        try {
          let currentText = "";
          const result = await sendChatMessage([], promptTemplate, (chunk) => {
            currentText += chunk;
            setNodes((prev) =>
              prev.map((n) =>
                n.id === newNode.id && n.messages
                  ? {
                      ...n,
                      messages: [
                        ...n.messages.slice(0, -1),
                        {
                          ...n.messages[n.messages.length - 1],
                          text: currentText,
                        },
                      ],
                    }
                  : n
              )
            );
          });
          setNodes((prev) =>
            prev.map((n) =>
              n.id === newNode.id && n.messages
                ? {
                    ...n,
                    messages: [
                      ...n.messages.slice(0, -1),
                      {
                        ...n.messages[n.messages.length - 1],
                        text: result.text,
                      },
                    ],
                  }
                : n
            )
          );
        } catch (e) {
          console.error("Failed to generate initial response", e);
        }
      }
    },
    [
      selectionTooltip,
      nodes,
      viewTransform,
      setNodes,
      setEdges,
      currentScopeId,
      onNodeSelect,
    ]
  );

  // Selection Listeners
  useEffect(() => {
    const handleSelectionChange = () => {
      const sel = window.getSelection();
      if (
        (!sel || sel.isCollapsed) &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        setSelectionTooltip(null);
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
        setSelectionTooltip({
          x: rect.left + rect.width / 2,
          y: rect.top,
          bottom: rect.bottom,
          text: text.trim(),
          sourceId,
        });
      } else {
        setSelectionTooltip(null);
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
  }, [draggingId, resizingId, connectingNodeId]);

  // Drag Logic
  useEffect(() => {
    const handleEnd = () => {
      const wasInteracting = draggingId || resizingId;
      const interactingId = draggingId || resizingId;
      setDraggingId(null);
      setResizingId(null);
      setResizeDirection(null);
      dragStartRef.current = null;
      if (wasInteracting && interactingId) resolveCollisions(interactingId);
    };

    const handleMove = (e: MouseEvent | TouchEvent) => {
      let clientX =
        "touches" in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
      let clientY =
        "touches" in e ? e.touches[0].clientY : (e as MouseEvent).clientY;

      setMousePos({ x: clientX, y: clientY });

      if (!dragStartRef.current) return;
      if (e.type === "touchmove" && (draggingId || resizingId))
        e.preventDefault();

      const { mouseX, mouseY, nodeX, nodeY, nodeWidth, nodeHeight } =
        dragStartRef.current;
      const dx = (clientX - mouseX) / viewTransform.k;
      const dy = (clientY - mouseY) / viewTransform.k;

      if (draggingId) {
        setNodes((prev) =>
          prev.map((n) =>
            n.id === draggingId ? { ...n, x: nodeX + dx, y: nodeY + dy } : n
          )
        );
      } else if (resizingId && resizeDirection) {
        setNodes((prev) =>
          prev.map((n) => {
            if (n.id === resizingId) {
              let newX = nodeX,
                newY = nodeY,
                newW = nodeWidth,
                newH = nodeHeight;
              if (resizeDirection.includes("e"))
                newW = Math.max(MIN_NODE_WIDTH, nodeWidth + dx);
              else if (resizeDirection.includes("w")) {
                const effectiveDx = Math.min(dx, nodeWidth - MIN_NODE_WIDTH);
                newW = nodeWidth - effectiveDx;
                newX = nodeX + effectiveDx;
              }
              if (resizeDirection.includes("s"))
                newH = Math.max(MIN_NODE_HEIGHT, nodeHeight + dy);
              else if (resizeDirection.includes("n")) {
                const effectiveDy = Math.min(dy, nodeHeight - MIN_NODE_HEIGHT);
                newH = nodeHeight - effectiveDy;
                newY = nodeY + effectiveDy;
              }
              return { ...n, x: newX, y: newY, width: newW, height: newH };
            }
            return n;
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
    viewTransform.k,
    setNodes,
    resolveCollisions,
  ]);

  const handleNodeMouseDown = useCallback(
    (e: React.MouseEvent | React.TouchEvent, id: string) => {
      e.stopPropagation();
      if (connectingNodeId) {
        if (id !== connectingNodeId) onConnectEnd(connectingNodeId, id);
        return;
      }
      const node = nodes.find((n) => n.id === id);
      if (!node) return;
      onNodeSelect(id);

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
      dragStartRef.current = {
        mouseX: clientX,
        mouseY: clientY,
        nodeX: node.x,
        nodeY: node.y,
        nodeWidth: node.width || DEFAULT_NODE_WIDTH,
        nodeHeight: node.height || DEFAULT_NODE_HEIGHT,
      };
    },
    [nodes, connectingNodeId, onConnectEnd, onNodeSelect]
  );

  const handleBackgroundClick = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
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
        setSelectionTooltip(null);
      }
    },
    [connectingNodeId, onCancelConnect, onNodeSelect]
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
      dragStartRef.current = {
        mouseX: clientX,
        mouseY: clientY,
        nodeX: node.x,
        nodeY: node.y,
        nodeWidth: node.width || DEFAULT_NODE_WIDTH,
        nodeHeight: node.height || DEFAULT_NODE_HEIGHT,
      };
    },
    [nodes]
  );

  const applyLayout = (type: "force" | "tree-tb" | "tree-lr") => {
    if (nodes.length === 0) return;
    const simNodes = nodes.map((n) => ({ ...n }));
    const simEdges = edges.map((e) => ({ ...e }));
    if (type === "force") {
      d3.forceSimulation(simNodes as any)
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
        .stop()
        .tick(300);
      setNodes((prev) =>
        prev.map((n, i) => ({
          ...n,
          x: (simNodes[i] as any).x,
          y: (simNodes[i] as any).y,
        }))
      );
    } else {
      const rootId = nodes[0].id;
      const stratify = d3
        .stratify<GraphNode>()
        .id((d) => d.id)
        .parentId((d) => {
          const edge = edges.find((e) => e.target === d.id);
          return edge ? edge.source : d.id === rootId ? null : rootId;
        });
      try {
        const root = stratify(nodes);
        // Tighter tree layout: [320, 220] for TB, [320, 250] for LR
        const treeLayout = d3
          .tree<GraphNode>()
          .nodeSize(type === "tree-tb" ? [320, 220] : [320, 250]);
        treeLayout(root);
        const descendants = root.descendants();
        setNodes((prev) =>
          prev.map((n) => {
            const d = descendants.find((dn) => dn.id === n.id);
            return d
              ? {
                  ...n,
                  x: type === "tree-tb" ? d.x : d.y,
                  y: type === "tree-tb" ? d.y : d.x,
                }
              : n;
          })
        );
      } catch (e) {
        console.warn(e);
        applyLayout("force");
      }
    }
  };

  const addNewNode = (type: NodeType) => {
    const cx =
      (containerSize.width / 2 - viewTransform.x) / viewTransform.k -
      DEFAULT_NODE_WIDTH / 2;
    const cy =
      (containerSize.height / 2 - viewTransform.y) / viewTransform.k -
      DEFAULT_NODE_HEIGHT / 2;
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
            onClick={() => applyLayout("tree-tb")}
            className="p-2 text-slate-500 hover:text-sky-400 hover:bg-slate-800 rounded-lg"
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
              <circle cx="12" cy="5" r="2" />
              <circle cx="5" cy="19" r="2" />
              <circle cx="19" cy="19" r="2" />
              <line x1="12" y1="7" x2="5" y2="17" />
              <line x1="12" y1="7" x2="19" y2="17" />
            </svg>
          </button>
          <button
            onClick={() => applyLayout("tree-lr")}
            className="p-2 text-slate-500 hover:text-sky-400 hover:bg-slate-800 rounded-lg"
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
              <circle cx="5" cy="12" r="2" />
              <circle cx="19" cy="5" r="2" />
              <circle cx="19" cy="19" r="2" />
              <line x1="7" y1="12" x2="17" y2="5" />
              <line x1="7" y1="12" x2="17" y2="19" />
            </svg>
          </button>
          <button
            onClick={() => applyLayout("force")}
            className="p-2 text-slate-500 hover:text-sky-400 hover:bg-slate-800 rounded-lg"
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
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        className={`flex-1 relative overflow-hidden cursor-default canvas-background min-w-0 ${
          connectingNodeId ? "cursor-crosshair" : ""
        }`}
        style={{
          backgroundImage: "radial-gradient(#334155 1px, transparent 1px)",
          backgroundSize: `${bgSize}px ${bgSize}px`,
          backgroundPosition: `${bgX}px ${bgY}px`,
          backgroundRepeat: "repeat",
        }}
        onClick={handleBackgroundClick}
      >
        {/* Mobile Hamburger - Fixed Top Left */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleMenu && onToggleMenu();
          }}
          className="md:hidden absolute top-4 left-4 z-50 w-10 h-10 rounded-full bg-slate-900/80 backdrop-blur border border-slate-700 text-white flex items-center justify-center shadow-lg"
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
                onDelete={onDeleteNode}
                onResizeStart={handleResizeStart}
                onToggleMaximize={onMaximizeNode}
                onOpenLink={onOpenLink}
                onConnectStart={onConnectStart}
                onViewSubgraph={(id) => {
                  const n = nodes.find((node) => node.id === id);
                  if (n) onExpandNode(id, n.content);
                }}
                autoGraphEnabled={autoGraphEnabled}
                onSetAutoGraphEnabled={onSetAutoGraphEnabled}
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

        {selectionTooltip && !connectingNodeId && (
          <div
            className="selection-tooltip fixed z-[9999] bg-slate-800 text-white rounded-lg shadow-xl border border-slate-700 flex items-center gap-1 p-1 animate-in fade-in zoom-in duration-200"
            style={{
              left: selectionTooltip.x,
              top: isMobile
                ? selectionTooltip.bottom ?? selectionTooltip.y
                : selectionTooltip.y,
              transform: isMobile
                ? "translate(-50%, 10px)"
                : "translate(-50%, -120%)",
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onTouchStart={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <button
              className="p-2 hover:bg-slate-700 rounded text-sky-300 flex flex-col items-center gap-1"
              onClick={(e) => {
                e.stopPropagation();
                handleCreateFromSelection(NodeType.NOTE);
              }}
              title={
                selectionTooltip.sourceId
                  ? "Create Connected Note"
                  : "Create Note"
              }
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
              >
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              <span className="text-[8px] font-bold">NOTE</span>
            </button>
            <div className="w-px h-8 bg-slate-700 mx-1"></div>
            <button
              className="p-2 hover:bg-slate-700 rounded text-emerald-300 flex flex-col items-center gap-1"
              onClick={(e) => {
                e.stopPropagation();
                handleCreateFromSelection(NodeType.CHAT);
              }}
              title={
                selectionTooltip.sourceId
                  ? "Create Connected Chat"
                  : "Create Chat"
              }
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
              >
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <span className="text-[8px] font-bold">CHAT</span>
            </button>
            {selectionTooltip.sourceId && (
              <>
                <div className="w-px h-8 bg-slate-700 mx-1"></div>
                <button
                  className="p-2 hover:bg-slate-700 rounded text-purple-300 flex flex-col items-center gap-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    onExpandNode(
                      selectionTooltip.sourceId!,
                      selectionTooltip.text
                    );
                    setSelectionTooltip(null);
                    window.getSelection()?.removeAllRanges();
                  }}
                  title="Expand Graph from selection"
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
                  >
                    <circle cx="12" cy="12" r="3" />
                    <circle cx="6" cy="6" r="2" />
                    <circle cx="18" cy="6" r="2" />
                    <line x1="10" y1="10" x2="7.5" y2="7.5" />
                    <line x1="14" y1="10" x2="16.5" y2="7.5" />
                  </svg>
                  <span className="text-[8px] font-bold">GRAPH</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
