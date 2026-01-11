import React, { useState, useCallback } from "react";
import { GraphNode } from "../types";
import { useOutlineTree, TreeNodeData } from "../hooks/useOutlineTree";
import { OutlineNode } from "./OutlineNode";

interface OutlineTreePanelProps {
  isOpen: boolean;
  onClose: () => void;
  nodes: GraphNode[];
  selectedNodeIds: Set<string>;
  currentScopeId: string | null;
  onFocusNode: (nodeId: string) => void;
}

export const OutlineTreePanel: React.FC<OutlineTreePanelProps> = ({
  isOpen,
  onClose,
  nodes,
  selectedNodeIds,
  currentScopeId,
  onFocusNode,
}) => {
  const [panelWidth, setPanelWidth] = useState(280);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const { tree } = useOutlineTree(
    nodes,
    selectedNodeIds,
    currentScopeId
  );

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

    return (
      <div key={node.id}>
        <OutlineNode
          node={node}
          depth={depth}
          hasChildren={hasChildren}
          isExpanded={isExpanded}
          isSelected={isSelected}
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
