import React from "react";
import { SelectionTooltipState } from "../types";

interface SelectionTooltipProps {
  tooltip: SelectionTooltipState;
  onClose: () => void;
  onCreateNote: () => void;
  onCreateChat: () => void;
  onExpandGraph: () => void;
  isMobile?: boolean;
}

export const SelectionTooltip: React.FC<SelectionTooltipProps> = ({
  tooltip,
  onClose,
  onCreateNote,
  onCreateChat,
  onExpandGraph,
  isMobile = false,
}) => {
  return (
    <div
      className="selection-tooltip fixed z-[9999] bg-slate-800 text-white rounded-lg shadow-xl border border-slate-700 flex items-center gap-1 p-1 animate-in fade-in zoom-in duration-200"
      style={{
        left: tooltip.x,
        top: isMobile ? tooltip.bottom ?? tooltip.y : tooltip.y,
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
          onCreateNote();
        }}
        title={
          tooltip.sourceId ? "Create Connected Note" : "Create Note"
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
          onCreateChat();
        }}
        title={
          tooltip.sourceId ? "Create Connected Chat" : "Create Chat"
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
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <span className="text-[8px] font-bold">CHAT</span>
      </button>
      {tooltip.sourceId && (
        <>
          <div className="w-px h-8 bg-slate-700 mx-1"></div>
          <button
            className="p-2 hover:bg-slate-700 rounded text-purple-300 flex flex-col items-center gap-1"
            onClick={(e) => {
              e.stopPropagation();
              onExpandGraph();
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
  );
};

