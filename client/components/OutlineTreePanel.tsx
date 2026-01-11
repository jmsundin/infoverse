import React, { useState, useRef, useReducer, useCallback } from "react";
import { GraphNode } from "../types";
import { useOutlineTree, TreeNodeData } from "../hooks/useOutlineTree";
import { getNodeTitleForBreadcrumb } from "../utils/graphUtils";

interface OutlineTreePanelProps {
  isOpen: boolean;
  onClose: () => void;
  nodes: GraphNode[];
  selectedNodeIds: Set<string>;
  currentScopeId: string | null;
  onFocusNode: (nodeId: string) => void;
}

interface TreeNodeProps {
  data: TreeNodeData;
  collapsedIds: Set<string>;
  onToggleCollapse: (id: string) => void;
  onNodeClick: (id: string) => void;
  selectedNodeId: string | null;
}

const TreeNode: React.FC<TreeNodeProps> = ({
  data,
  collapsedIds,
  onToggleCollapse,
  onNodeClick,
  selectedNodeId,
}) => {
  const { node, children, depth } = data;
  const hasChildren = children.length > 0;
  const isCollapsed = collapsedIds.has(node.id);
  const isSelected = node.id === selectedNodeId;

  const title = getNodeTitleForBreadcrumb(node);

  return (
    <div>
      <div
        className={`flex items-center gap-1 py-1.5 px-2 cursor-pointer rounded transition-colors ${
          isSelected
            ? "bg-slate-700 text-sky-400"
            : "text-slate-300 hover:bg-slate-800"
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => onNodeClick(node.id)}
      >
        {/* Collapse/expand toggle */}
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse(node.id);
            }}
            className="w-4 h-4 flex items-center justify-center text-slate-500 hover:text-white shrink-0"
          >
            {isCollapsed ? ">" : "\u2304"}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}

        {/* Node title */}
        <span className="truncate text-sm">{title}</span>
      </div>

      {/* Render children if not collapsed */}
      {hasChildren && !isCollapsed && (
        <div>
          {children.map((child) => (
            <TreeNode
              key={child.node.id}
              data={child}
              collapsedIds={collapsedIds}
              onToggleCollapse={onToggleCollapse}
              onNodeClick={onNodeClick}
              selectedNodeId={selectedNodeId}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const OutlineTreePanel: React.FC<OutlineTreePanelProps> = ({
  isOpen,
  onClose,
  nodes,
  selectedNodeIds,
  currentScopeId,
  onFocusNode,
}) => {
  const [panelWidth, setPanelWidth] = useState(280);
  // Use useRef to persist collapse state across re-renders without causing updates
  const collapsedIdsRef = useRef<Set<string>>(new Set());
  const [, forceUpdate] = useReducer((x) => x + 1, 0);

  const { ancestors, tree, selectedNode } = useOutlineTree(
    nodes,
    selectedNodeIds,
    currentScopeId
  );

  const toggleCollapse = useCallback((nodeId: string) => {
    const set = collapsedIdsRef.current;
    if (set.has(nodeId)) {
      set.delete(nodeId);
    } else {
      set.add(nodeId);
    }
    forceUpdate();
  }, []);

  const handleNodeClick = useCallback(
    (nodeId: string) => {
      onFocusNode(nodeId);
    },
    [onFocusNode]
  );

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

  if (!isOpen) return null;

  const selectedNodeId = selectedNode?.id ?? null;

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
            {tree.length}
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

      {/* Ancestor breadcrumbs */}
      {ancestors.length > 0 && selectedNode && (
        <div className="px-3 py-2 border-b border-slate-800 flex items-center gap-1 text-xs text-slate-500 overflow-x-auto shrink-0">
          {ancestors.map((ancestor, i) => (
            <React.Fragment key={ancestor.id}>
              <button
                onClick={() => onFocusNode(ancestor.id)}
                className="hover:text-sky-400 truncate max-w-[100px] shrink-0"
                title={getNodeTitleForBreadcrumb(ancestor)}
              >
                {getNodeTitleForBreadcrumb(ancestor)}
              </button>
              <span className="shrink-0">&gt;</span>
            </React.Fragment>
          ))}
          <span className="text-slate-400 truncate">
            {getNodeTitleForBreadcrumb(selectedNode)}
          </span>
        </div>
      )}

      {/* Tree container */}
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
          <div>
            {tree.map((treeNode) => (
              <TreeNode
                key={treeNode.node.id}
                data={treeNode}
                collapsedIds={collapsedIdsRef.current}
                onToggleCollapse={toggleCollapse}
                onNodeClick={handleNodeClick}
                selectedNodeId={selectedNodeId}
              />
            ))}
          </div>
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
