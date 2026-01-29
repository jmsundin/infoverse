import React, { useState, useRef, useEffect } from "react";
import { NodeType } from "../../types";

interface ChatModeSidebarProps {
  user: any;
  isOutlinePanelOpen: boolean;
  onToggleOutlinePanel: () => void;
  onShowProfile: () => void;
  onCreateNode: (type: NodeType) => void;
}

export const ChatModeSidebar: React.FC<ChatModeSidebarProps> = ({
  user,
  isOutlinePanelOpen,
  onToggleOutlinePanel,
  onShowProfile,
  onCreateNode,
}) => {
  const [isCreateMenuOpen, setIsCreateMenuOpen] = useState(false);
  const createMenuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (createMenuRef.current && !createMenuRef.current.contains(e.target as Node)) {
        setIsCreateMenuOpen(false);
      }
    };
    if (isCreateMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isCreateMenuOpen]);

  return (
    <div className="z-40 bg-slate-900 md:border-r border-slate-800 shadow-xl hidden md:flex md:w-16 md:h-full md:flex-col items-center justify-between md:py-4 shrink-0">
      {/* Top icons */}
      <div className="flex flex-col items-center gap-4">
        <button
          onClick={onToggleOutlinePanel}
          className={`flex w-10 h-10 rounded-full bg-slate-800/80 backdrop-blur border items-center justify-center shadow-lg hover:brightness-110 transition-all group ${
            isOutlinePanelOpen ? 'border-sky-500 ring-2 ring-sky-400/50' : 'border-slate-700'
          }`}
          title="Toggle Outline View"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="w-5 h-5 group-hover:scale-110 transition-transform"
            viewBox="0 0 24 24"
            fill="none"
            stroke={isOutlinePanelOpen ? '#38bdf8' : 'white'}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {/* Outline/tree icon */}
            <circle cx="5" cy="6" r="1.5" />
            <line x1="10" y1="6" x2="20" y2="6" />
            <circle cx="8" cy="12" r="1.5" />
            <line x1="13" y1="12" x2="20" y2="12" />
            <circle cx="8" cy="18" r="1.5" />
            <line x1="13" y1="18" x2="20" y2="18" />
          </svg>
        </button>
        {/* Create Node Button */}
        <div ref={createMenuRef} className="relative">
          <button
            onClick={() => setIsCreateMenuOpen((prev) => !prev)}
            className={`flex w-10 h-10 rounded-full bg-slate-800/80 backdrop-blur border items-center justify-center shadow-lg hover:brightness-110 transition-all group ${
              isCreateMenuOpen ? 'border-sky-500 ring-2 ring-sky-400/50' : 'border-slate-700'
            }`}
            title="Create Node"
            aria-haspopup="menu"
            aria-expanded={isCreateMenuOpen}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className={`w-5 h-5 group-hover:scale-110 transition-transform ${isCreateMenuOpen ? "rotate-45" : ""}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke={isCreateMenuOpen ? '#38bdf8' : 'white'}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          {isCreateMenuOpen && (
            <div className="absolute z-50 w-48 bg-slate-950 border border-slate-800 rounded-2xl shadow-2xl p-2 animate-in fade-in left-full ml-3 top-0 origin-left slide-in-from-left-2">
              <button
                onClick={() => {
                  onCreateNode(NodeType.NOTE);
                  setIsCreateMenuOpen(false);
                }}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-colors hover:bg-slate-900/80"
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
                  className="text-slate-400"
                >
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                <span className="text-sm font-medium text-white">Create Note</span>
              </button>
              <button
                onClick={() => {
                  onCreateNode(NodeType.CHAT);
                  setIsCreateMenuOpen(false);
                }}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-colors hover:bg-slate-900/80"
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
                  className="text-slate-400"
                >
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                <span className="text-sm font-medium text-white">Create AI Chat</span>
              </button>
            </div>
          )}
        </div>
      </div>
      {/* Bottom icons */}
      <div className="flex flex-col items-center gap-4">
        {user && (
          <button
            onClick={onShowProfile}
            className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
            title="Profile"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
};
