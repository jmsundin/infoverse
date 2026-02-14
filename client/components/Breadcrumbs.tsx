import React from "react";
import { GraphNode } from "../types";

type Breadcrumb = {
  id: string | null;
  name: string;
  type: "root" | "scope" | "node";
};

interface BreadcrumbsProps {
  breadcrumbs: Breadcrumb[];
  selectedNodeIds: Set<string>;
  onNavigate: (id: string | null, type: "root" | "scope" | "node") => void;
  isOutlinePanelOpen?: boolean;
  outlinePanelWidth?: number;
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({
  breadcrumbs,
  selectedNodeIds,
  onNavigate,
  isOutlinePanelOpen = false,
  outlinePanelWidth = 280,
}) => {
  // Calculate left position: sidebar (64px) + outline panel width (when open) + padding (16px)
  const leftPosition = isOutlinePanelOpen ? 64 + outlinePanelWidth + 16 : 80;

  return (
    <div
      className="absolute top-16 z-40 flex items-center gap-2 text-sm pointer-events-none flex-wrap transition-all duration-200"
      style={{ left: `${leftPosition}px` }}
    >
      {breadcrumbs.map((crumb, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="text-slate-600 font-bold">&gt;</span>}
          <div className="flex items-center gap-1 pointer-events-auto">
            <button
              onClick={() => onNavigate(crumb.id, crumb.type)}
              className={`transition-colors max-w-[150px] truncate ${
                crumb.id &&
                selectedNodeIds.has(crumb.id) &&
                selectedNodeIds.size === 1
                  ? "text-sky-400 font-bold cursor-default"
                  : "text-slate-400 hover:text-white"
              }`}
              disabled={
                !!(
                  crumb.id &&
                  selectedNodeIds.has(crumb.id) &&
                  selectedNodeIds.size === 1
                )
              }
              title={crumb.name}
            >
              {crumb.name}
            </button>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
};
