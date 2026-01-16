import React, { useState, useCallback, useRef, useEffect } from "react";
import { GraphNode } from "../types";
import { useOutlineTree, TreeNodeData } from "../hooks/useOutlineTree";
import { OutlineNode } from "./OutlineNode";

interface OutlineTreePanelProps {
  isOpen: boolean;
  onClose: () => void;
  nodes: GraphNode[];
  selectedNodeIds: Set<string>;
  lastSelectedNodeId: string | null;
  currentScopeId: string | null;
  onFocusNode: (nodeId: string) => void;
}

export const OutlineTreePanel: React.FC<OutlineTreePanelProps> = ({
  isOpen,
  onClose,
  nodes,
  selectedNodeIds,
  lastSelectedNodeId,
  currentScopeId,
  onFocusNode,
}) => {
  const [panelWidth, setPanelWidth] = useState(280);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const nodeRefs = useRef<Map<string, HTMLDivElement>>(new Map());

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
    nodes,
    selectedNodeIds,
    currentScopeId,
    searchTerm
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

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = panelWidth;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const delta = moveEvent.clientX - startX;
        setPanelWidth(Math.max(200, Math.min(500, startWidth + delta)));
      };

      const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [panelWidth]
  );

  // Recursive function to render tree nodes
  const renderTreeNode = (treeNode: TreeNodeData): React.ReactNode => {
    const { node, depth, hasChildren, children } = treeNode;
    const isExpanded = expandedIds.has(node.id);
    const isSelected = selectedNodeIds.has(node.id);
    const isMatch = searchTerm.trim() ? matchingNodeIds.has(node.id) : false;

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

  if (!isOpen) return null;

  const totalCount = countNodes(tree);

  return (
    <div
      className="fixed top-0 left-16 h-full bg-slate-900 border-r border-slate-700 z-50 flex flex-col shadow-2xl animate-in slide-in-from-left duration-200"
      style={{ width: panelWidth }}
    >
      {/* Header */}
      <div className="p-4 border-b border-slate-800 flex items-center justify-between shrink-0">
        <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
          Outline
          <span className="text-xs font-normal text-slate-500 bg-slate-800 px-2 py-0.5 rounded-full">
            {totalCount}
          </span>
        </h2>
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

      {/* Search Input */}
      <div className="px-4 pb-3 pt-2 border-b border-slate-800 shrink-0">
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
            placeholder="Filter nodes..."
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
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-2 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
        {tree.length === 0 ? (
          <div className="text-slate-500 text-center p-8 flex flex-col items-center gap-2">
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
          </div>
        ) : (
          <div>{tree.map(renderTreeNode)}</div>
        )}
      </div>

      {/* Resize handle */}
      <div
        className="absolute right-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-sky-500/50 transition-colors"
        onMouseDown={handleResizeMouseDown}
      />
    </div>
  );
};
