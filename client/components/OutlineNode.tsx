import React from "react";
import { GraphNode, NodeColor } from "../types";
import { getNodeTitleForBreadcrumb } from "../utils/graphUtils";
import { NODE_COLORS } from "../constants";

interface OutlineNodeProps {
  node: GraphNode;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
  isSelected?: boolean;
  isMatch?: boolean;
  isInViewport?: boolean;
  onClick: () => void;
  onToggleExpand: () => void;
}

export const OutlineNode: React.FC<OutlineNodeProps> = ({
  node,
  depth,
  hasChildren,
  isExpanded,
  isSelected = false,
  isMatch = false,
  isInViewport = false,
  onClick,
  onToggleExpand,
}) => {
  const title = getNodeTitleForBreadcrumb(node);
  const colorTheme = NODE_COLORS[(node.color as NodeColor) || "slate"];

  // Calculate left padding based on depth (base padding + depth indent)
  const paddingLeft = 8 + depth * 16;

  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleExpand();
  };

  return (
    <div
      onClick={onClick}
      className={`
        w-full py-2 pr-3 rounded-lg text-left flex items-center gap-1
        ${isSelected ? "bg-sky-600/40" : isMatch ? "bg-amber-600/20" : "hover:bg-slate-800/50"}
        transition-all duration-150 cursor-pointer
      `}
      style={{ paddingLeft: isInViewport && !isSelected ? paddingLeft - 2 : paddingLeft }}
    >
      {/* Chevron for expand/collapse */}
      <button
        onClick={handleChevronClick}
        className={`
          w-5 h-5 flex items-center justify-center flex-shrink-0
          text-slate-400 hover:text-slate-200 transition-colors
          ${!hasChildren ? "invisible" : ""}
        `}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>

      {/* Node title */}
      <span className={`text-sm font-medium truncate ${colorTheme.text}`}>
        {title}
      </span>
    </div>
  );
};
