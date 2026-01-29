import React from "react";

interface ChatModeSidebarProps {
  user: any;
  isOutlinePanelOpen: boolean;
  onToggleOutlinePanel: () => void;
  onShowProfile: () => void;
}

export const ChatModeSidebar: React.FC<ChatModeSidebarProps> = ({
  user,
  isOutlinePanelOpen,
  onToggleOutlinePanel,
  onShowProfile,
}) => {
  return (
    <div className="z-40 bg-slate-900 md:border-r border-slate-800 shadow-xl hidden md:flex md:w-16 md:h-full md:flex-col items-center justify-between md:py-4 shrink-0">
      {/* Top icons */}
      <div className="flex flex-col items-center gap-4">
        <button
          onClick={onToggleOutlinePanel}
          className={`p-2 rounded-lg hover:bg-slate-800 transition-colors ${isOutlinePanelOpen ? 'text-sky-400' : 'text-slate-400 hover:text-slate-200'}`}
          title="Toggle Outline View"
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
              {/* Outline/tree icon */}
              <circle cx="5" cy="6" r="1.5" />
              <line x1="10" y1="6" x2="20" y2="6" />
              <circle cx="8" cy="12" r="1.5" />
              <line x1="13" y1="12" x2="20" y2="12" />
              <circle cx="8" cy="18" r="1.5" />
              <line x1="13" y1="18" x2="20" y2="18" />
            </svg>
        </button>
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
