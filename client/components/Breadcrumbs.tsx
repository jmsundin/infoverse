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
  onCloseFolder: () => void;
  dirName: string | null;
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({
  breadcrumbs,
  selectedNodeIds,
  onNavigate,
  onCloseFolder,
  dirName,
}) => {
  return (
    <div className="absolute top-16 left-4 md:left-20 z-40 flex items-center gap-2 text-sm pointer-events-none flex-wrap">
      {breadcrumbs.map((crumb, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="text-slate-600 font-bold">&gt;</span>}
          <div className="flex items-center gap-1 pointer-events-auto">
            <button
              onClick={() => onNavigate(crumb.id, crumb.type)}
              className={`transition-colors ${
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
            >
              {crumb.name}
            </button>
            {crumb.type === "root" && dirName && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseFolder();
                }}
                className="ml-1 p-0.5 text-slate-500 hover:text-red-400 rounded-full hover:bg-slate-800 transition-colors"
                title="Close Folder"
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
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
        </React.Fragment>
      ))}
    </div>
  );
};

