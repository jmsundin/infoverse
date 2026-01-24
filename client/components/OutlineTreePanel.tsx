import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { GraphNode, NodeType } from "../types";
import { useOutlineTree, TreeNodeData } from "../hooks/useOutlineTree";
import { OutlineNode } from "./OutlineNode";

type MobilePosition = "bottom" | "top" | "left" | "right";

interface OutlineTreePanelProps {
  isOpen: boolean;
  onClose: () => void;
  nodes: GraphNode[];
  viewportNodeIds?: Set<string>;
  hasViewportNodes?: boolean;
  selectedNodeIds: Set<string>;
  lastSelectedNodeId: string | null;
  currentScopeId: string | null;
  onFocusNode: (nodeId: string) => void;
}

export const OutlineTreePanel: React.FC<OutlineTreePanelProps> = ({
  isOpen,
  onClose,
  nodes,
  viewportNodeIds,
  hasViewportNodes = false,
  selectedNodeIds,
  lastSelectedNodeId,
  currentScopeId,
  onFocusNode,
}) => {
  // Desktop panel width
  const [panelWidth, setPanelWidth] = useState(280);
  // Mobile portrait panel height
  const [panelHeight, setPanelHeight] = useState(() =>
    typeof window !== "undefined" ? window.innerHeight / 2 : 300
  );
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const nodeRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Refs for smooth resize (direct DOM manipulation to avoid re-renders)
  const panelRef = useRef<HTMLDivElement>(null);
  const isResizingRef = useRef(false);
  const startDataRef = useRef<{
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
    edge: "top" | "bottom" | "left" | "right";
  } | null>(null);

  // Device and orientation detection
  const [isMobile, setIsMobile] = useState(false);
  const [isLandscape, setIsLandscape] = useState(false);

  // Mobile position state
  const [mobilePosition, setMobilePosition] = useState<MobilePosition>("bottom");

  // Type filter state (from NodeListDrawer)
  const [typeFilter, setTypeFilter] = useState<"ALL" | NodeType>("ALL");

  // Viewport mode: show only nodes in viewport, or all nodes
  const [viewportMode, setViewportMode] = useState<"viewport" | "all">("viewport");

  const filterOptions = useMemo<{ label: string; value: "ALL" | NodeType }[]>(() => [
    { label: "All", value: "ALL" },
    { label: "Chat", value: NodeType.CHAT },
    { label: "Note", value: NodeType.NOTE },
  ], []);

  const filterCounts = useMemo<Record<"ALL" | NodeType, number>>(() => {
    const chatCount = nodes.filter(node => node.type === NodeType.CHAT).length;
    const noteCount = nodes.filter(node => node.type === NodeType.NOTE).length;
    return {
      ALL: nodes.length,
      [NodeType.CHAT]: chatCount,
      [NodeType.NOTE]: noteCount,
    };
  }, [nodes]);

  // Filter nodes by type before passing to useOutlineTree
  const filteredByType = useMemo(() => {
    return typeFilter === "ALL"
      ? nodes
      : nodes.filter(node => node.type === typeFilter);
  }, [nodes, typeFilter]);

  // Determine effective viewport mode (fallback to "all" if no viewport nodes)
  const effectiveViewportMode = useMemo(() => {
    if (viewportMode === "viewport" && !hasViewportNodes) {
      return "all";
    }
    return viewportMode;
  }, [viewportMode, hasViewportNodes]);

  // Device/orientation detection
  useEffect(() => {
    const checkDevice = () => {
      const mobile = window.innerWidth < 768;
      const landscape = window.innerWidth > window.innerHeight;
      setIsMobile(mobile);
      setIsLandscape(landscape);

      // Reset position appropriately when orientation changes on mobile
      if (mobile) {
        if (landscape) {
          // Landscape: should be left or right
          setMobilePosition(prev =>
            prev === "top" || prev === "bottom" ? "left" : prev
          );
          // Set initial width to 50% in landscape
          setPanelWidth(window.innerWidth / 2);
        } else {
          // Portrait: should be top or bottom
          setMobilePosition(prev =>
            prev === "left" || prev === "right" ? "bottom" : prev
          );
          // Reset height to 50%
          setPanelHeight(window.innerHeight / 2);
        }
      }
    };

    checkDevice();
    window.addEventListener("resize", checkDevice);
    return () => window.removeEventListener("resize", checkDevice);
  }, []);

  // Helper to get all ancestor IDs for a given node
  const getAncestorIds = useCallback((nodeId: string): string[] => {
    const ancestors: string[] = [];
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    let current = nodeMap.get(nodeId);
    while (current?.parentId) {
      ancestors.push(current.parentId);
      current = nodeMap.get(current.parentId);
    }
    return ancestors;
  }, [nodes]);

  const { tree, matchingNodeIds } = useOutlineTree(
    filteredByType,
    selectedNodeIds,
    currentScopeId,
    searchTerm,
    viewportNodeIds,
    effectiveViewportMode === "viewport"
  );

  // Auto-expand ancestors when selection changes and scroll into view
  useEffect(() => {
    if (!lastSelectedNodeId || !isOpen) return;

    const ancestorIds = getAncestorIds(lastSelectedNodeId);

    // Expand all ancestors
    if (ancestorIds.length > 0) {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        ancestorIds.forEach((id) => next.add(id));
        return next;
      });
    }

    // Scroll selected node into view after DOM update
    requestAnimationFrame(() => {
      const nodeRef = nodeRefs.current.get(lastSelectedNodeId);
      if (nodeRef) {
        nodeRef.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
  }, [lastSelectedNodeId, getAncestorIds, isOpen]);

  // Auto-expand ancestors of matching nodes when searching
  useEffect(() => {
    if (searchTerm.trim() && matchingNodeIds.size > 0) {
      const toExpand = new Set<string>();
      matchingNodeIds.forEach((matchId) => {
        const ancestors = getAncestorIds(matchId);
        ancestors.forEach((id) => toExpand.add(id));
      });
      setExpandedIds((prev) => new Set([...prev, ...toExpand]));
    }
  }, [searchTerm, matchingNodeIds, getAncestorIds]);

  const handleNodeClick = useCallback(
    (nodeId: string) => {
      onFocusNode(nodeId);
      // Panel stays open - no close on node selection
    },
    [onFocusNode]
  );

  const handleToggleExpand = useCallback((nodeId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  // Determine which edge to resize from
  const getResizeEdge = useCallback((): "top" | "bottom" | "left" | "right" => {
    if (!isMobile) return "right"; // Desktop always right

    if (!isLandscape) {
      // Portrait: top panel resizes from bottom, bottom panel from top
      return mobilePosition === "top" ? "bottom" : "top";
    }

    // Landscape: left panel resizes from right, right panel from left
    return mobilePosition === "right" ? "left" : "right";
  }, [isMobile, isLandscape, mobilePosition]);

  // Persistent event listeners for resize (direct DOM manipulation for performance)
  useEffect(() => {
    const handleMove = (e: MouseEvent | TouchEvent) => {
      if (!isResizingRef.current || !panelRef.current || !startDataRef.current) return;
      e.preventDefault();

      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
      const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
      const { startX, startY, startWidth, startHeight, edge } = startDataRef.current;

      // Direct DOM manipulation - no React re-render during drag
      if (edge === "right") {
        const delta = clientX - startX;
        const newWidth = Math.max(200, Math.min(window.innerWidth * 0.8, startWidth + delta));
        panelRef.current.style.width = `${newWidth}px`;
      } else if (edge === "left") {
        const delta = startX - clientX;
        const newWidth = Math.max(200, Math.min(window.innerWidth * 0.8, startWidth + delta));
        panelRef.current.style.width = `${newWidth}px`;
      } else if (edge === "top") {
        const delta = startY - clientY;
        const newHeight = Math.max(150, Math.min(window.innerHeight * 0.8, startHeight + delta));
        panelRef.current.style.height = `${newHeight}px`;
      } else if (edge === "bottom") {
        const delta = clientY - startY;
        const newHeight = Math.max(150, Math.min(window.innerHeight * 0.8, startHeight + delta));
        panelRef.current.style.height = `${newHeight}px`;
      }
    };

    const handleEnd = () => {
      if (!isResizingRef.current || !panelRef.current) return;
      isResizingRef.current = false;

      // Sync React state with final DOM value (single state update at end)
      const { edge } = startDataRef.current || {};
      if (edge === "left" || edge === "right") {
        setPanelWidth(panelRef.current.offsetWidth);
      } else {
        setPanelHeight(panelRef.current.offsetHeight);
      }
      startDataRef.current = null;
    };

    document.addEventListener("mousemove", handleMove);
    document.addEventListener("touchmove", handleMove, { passive: false });
    document.addEventListener("mouseup", handleEnd);
    document.addEventListener("touchend", handleEnd);

    return () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("touchmove", handleMove);
      document.removeEventListener("mouseup", handleEnd);
      document.removeEventListener("touchend", handleEnd);
    };
  }, []); // Empty deps - handlers use refs

  // Start resize - just sets up refs, no event listener attachment
  const handleResizeStart = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (!("touches" in e)) {
        e.preventDefault();
      }
      const isTouch = "touches" in e;
      const startX = isTouch ? e.touches[0].clientX : e.clientX;
      const startY = isTouch ? e.touches[0].clientY : e.clientY;

      isResizingRef.current = true;
      startDataRef.current = {
        startX,
        startY,
        startWidth: panelWidth,
        startHeight: panelHeight,
        edge: getResizeEdge(),
      };
    },
    [panelWidth, panelHeight, getResizeEdge]
  );

  // Toggle position (for drag handle)
  const handleTogglePosition = useCallback(() => {
    if (!isMobile) return;

    if (!isLandscape) {
      // Portrait: toggle between top and bottom
      setMobilePosition(prev => prev === "bottom" ? "top" : "bottom");
    } else {
      // Landscape: toggle between left and right
      setMobilePosition(prev => prev === "left" ? "right" : "left");
    }
  }, [isMobile, isLandscape]);

  // Recursive function to render tree nodes
  const renderTreeNode = (treeNode: TreeNodeData): React.ReactNode => {
    const { node, depth, hasChildren, children } = treeNode;
    const isExpanded = expandedIds.has(node.id);
    const isSelected = selectedNodeIds.has(node.id);
    const isMatch = searchTerm.trim() ? matchingNodeIds.has(node.id) : false;
    const isInViewport = viewportNodeIds?.has(node.id) ?? false;

    return (
      <div
        key={node.id}
        ref={(el) => {
          if (el) {
            nodeRefs.current.set(node.id, el);
          } else {
            nodeRefs.current.delete(node.id);
          }
        }}
      >
        <OutlineNode
          node={node}
          depth={depth}
          hasChildren={hasChildren}
          isExpanded={isExpanded}
          isSelected={isSelected}
          isMatch={isMatch}
          isInViewport={isInViewport}
          onClick={() => handleNodeClick(node.id)}
          onToggleExpand={() => handleToggleExpand(node.id)}
        />
        {isExpanded && children.length > 0 && (
          <div>{children.map(renderTreeNode)}</div>
        )}
      </div>
    );
  };

  // Count total nodes in tree recursively
  const countNodes = (treeNodes: TreeNodeData[]): number => {
    return treeNodes.reduce((acc, node) => {
      return acc + 1 + countNodes(node.children);
    }, 0);
  };

  // Compute panel styles based on device/orientation/position
  const panelStyles = useMemo((): React.CSSProperties => {
    // Desktop: left side panel
    if (!isMobile) {
      return {
        position: "fixed",
        top: 0,
        left: 64, // After toolbar (16*4 = 64px)
        height: "100%",
        width: panelWidth,
      };
    }

    // Mobile Portrait
    if (!isLandscape) {
      if (mobilePosition === "bottom") {
        return {
          position: "fixed",
          bottom: 64, // Above bottom toolbar
          left: 0,
          right: 0,
          height: panelHeight,
        };
      } else {
        // top - offset to leave space for the toolbar toggle button
        return {
          position: "fixed",
          top: 64, // Below toolbar toggle button area
          left: 0,
          right: 0,
          height: panelHeight,
        };
      }
    }

    // Mobile Landscape
    if (mobilePosition === "left" || mobilePosition === "bottom") {
      return {
        position: "fixed",
        top: 0,
        left: 0,
        bottom: 0,
        width: panelWidth,
      };
    } else {
      // right
      return {
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: panelWidth,
      };
    }
  }, [isMobile, isLandscape, mobilePosition, panelWidth, panelHeight]);

  // Compute animation class based on position
  const getAnimationClass = (): string => {
    if (!isMobile) return "animate-in slide-in-from-left duration-200";

    if (!isLandscape) {
      return mobilePosition === "bottom"
        ? "animate-in slide-in-from-bottom duration-200"
        : "animate-in slide-in-from-top duration-200";
    }

    return mobilePosition === "right"
      ? "animate-in slide-in-from-right duration-200"
      : "animate-in slide-in-from-left duration-200";
  };

  // Get border classes based on position
  const getBorderClass = (): string => {
    if (!isMobile) return "border-r border-slate-700";

    if (!isLandscape) {
      return mobilePosition === "bottom"
        ? "border-t border-slate-700"
        : "border-b border-slate-700";
    }

    return mobilePosition === "right"
      ? "border-l border-slate-700"
      : "border-r border-slate-700";
  };

  // Render resize handle based on edge
  const renderResizeHandle = () => {
    const edge = getResizeEdge();
    // Larger touch target on mobile (32px vs 6px on desktop)
    const baseClass = "absolute transition-colors z-10 touch-none";
    const hoverClass = "hover:bg-sky-500/50 active:bg-sky-500/70";

    // Use larger size on mobile for better touch targets
    const sizeClass = isMobile ? {
      horizontal: "h-8", // 32px height for top/bottom edges
      vertical: "w-8",   // 32px width for left/right edges
    } : {
      horizontal: "h-1.5",
      vertical: "w-1.5",
    };

    const edgeConfig: Record<string, string> = {
      right: `${baseClass} ${hoverClass} right-0 top-0 bottom-0 ${sizeClass.vertical} cursor-ew-resize`,
      left: `${baseClass} ${hoverClass} left-0 top-0 bottom-0 ${sizeClass.vertical} cursor-ew-resize`,
      top: `${baseClass} ${hoverClass} top-0 left-0 right-0 ${sizeClass.horizontal} cursor-ns-resize`,
      bottom: `${baseClass} ${hoverClass} bottom-0 left-0 right-0 ${sizeClass.horizontal} cursor-ns-resize`,
    };

    return (
      <div
        className={edgeConfig[edge]}
        onMouseDown={handleResizeStart}
        onTouchStart={handleResizeStart}
      >
        {/* Visual indicator for mobile */}
        {isMobile && (
          <div className={`absolute bg-slate-500/60 rounded-full ${
            edge === "top" || edge === "bottom"
              ? "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-1.5"
              : "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-16"
          }`} />
        )}
      </div>
    );
  };

  if (!isOpen) return null;

  const totalCount = countNodes(tree);

  // Get the position toggle button title and icon direction
  const getPositionToggleInfo = () => {
    if (!isLandscape) {
      // Portrait mode
      return mobilePosition === "bottom"
        ? { title: "Move to top", direction: "up" as const }
        : { title: "Move to bottom", direction: "down" as const };
    } else {
      // Landscape mode
      return mobilePosition === "left" || mobilePosition === "bottom"
        ? { title: "Move to right", direction: "right" as const }
        : { title: "Move to left", direction: "left" as const };
    }
  };

  return (
    <div
      ref={panelRef}
      className={`bg-slate-900 ${getBorderClass()} z-50 flex flex-col shadow-2xl ${getAnimationClass()}`}
      style={panelStyles}
    >
      {/* Header */}
      <div className="p-4 border-b border-slate-800 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold text-slate-100">Outline</h2>
          {/* Viewport mode toggle */}
          <button
            onClick={() => setViewportMode(v => v === "viewport" ? "all" : "viewport")}
            className={`text-[10px] font-medium px-2 py-0.5 rounded-full transition-colors ${
              effectiveViewportMode === "viewport"
                ? "bg-sky-600 text-white"
                : "bg-slate-700 text-slate-300 hover:bg-slate-600"
            }`}
            title={effectiveViewportMode === "viewport" ? "Showing viewport nodes" : "Showing all nodes"}
          >
            {effectiveViewportMode === "viewport" ? (
              <span className="flex items-center gap-1">
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2"/>
                </svg>
                {viewportNodeIds?.size ?? 0}
              </span>
            ) : (
              <span>{totalCount}</span>
            )}
          </button>
        </div>
        <div className="flex items-center gap-1">
          {/* Position toggle button - mobile only */}
          {isMobile && (
            <button
              onClick={handleTogglePosition}
              className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
              title={getPositionToggleInfo().title}
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
                {(() => {
                  const { direction } = getPositionToggleInfo();
                  switch (direction) {
                    case "up":
                      return <><line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" /></>;
                    case "down":
                      return <><line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" /></>;
                    case "left":
                      return <><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></>;
                    case "right":
                      return <><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></>;
                  }
                })()}
              </svg>
            </button>
          )}
          {/* Close button */}
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
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
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Search Input and Type Filters */}
      <div className="px-4 pb-3 pt-2 border-b border-slate-800 shrink-0 space-y-2">
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
            <svg
              className="h-3.5 w-3.5 text-slate-500"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>
          <input
            type="text"
            placeholder="Find a node..."
            className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg py-1.5 pl-8 pr-8 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-all placeholder-slate-500"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm("")}
              className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-slate-500 hover:text-slate-300"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Type Filter Buttons */}
        <div className="grid grid-cols-3 gap-1.5 text-[11px] font-bold uppercase w-full max-w-[180px]">
          {filterOptions.map(option => {
            const isActive = typeFilter === option.value;
            return (
              <button
                key={option.value}
                onClick={() => setTypeFilter(option.value)}
                className={`px-2 py-1 rounded-md border transition-colors flex items-center justify-between gap-1 ${
                  isActive
                    ? "border-sky-500 bg-sky-900/40 text-sky-300"
                    : "border-slate-700 bg-slate-800/80 text-slate-400 hover:border-slate-600"
                }`}
              >
                <span className="text-[10px] font-normal tracking-wide text-slate-500">
                  {filterCounts[option.value]}
                </span>
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-2 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
        {tree.length === 0 ? (
          <div className="text-slate-500 text-center p-8 flex flex-col items-center gap-2">
            {searchTerm ? (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="opacity-50"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <p className="text-sm">No nodes found for "{searchTerm}"</p>
              </>
            ) : typeFilter !== "ALL" ? (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="opacity-50"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                <p className="text-sm">No {typeFilter.toLowerCase()} nodes yet.</p>
              </>
            ) : (
              <>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="opacity-50"
                >
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                <p className="text-sm">No nodes in this scope</p>
              </>
            )}
          </div>
        ) : (
          <div>{tree.map(renderTreeNode)}</div>
        )}
      </div>

      {/* Resize handle */}
      {renderResizeHandle()}
    </div>
  );
};
