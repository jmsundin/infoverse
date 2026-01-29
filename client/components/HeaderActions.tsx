import React from "react";

interface HeaderActionsProps {
  user: any;
  onLogin: () => void;
  onSignup: () => void;
  onShowProfile: () => void;
  activeSidePanesCount: number;
  // Mobile search icon
  searchExpanded?: boolean;
  onSearchExpandedChange?: (expanded: boolean) => void;
}

export const HeaderActions: React.FC<HeaderActionsProps> = ({
  user,
  onLogin,
  onSignup,
  onShowProfile,
  activeSidePanesCount,
  searchExpanded,
  onSearchExpandedChange,
}) => {
  return (
    <div
      className={`absolute top-4 right-14 z-[60] flex gap-3 items-center pointer-events-none transition-all duration-200 ${
        activeSidePanesCount > 0 ? "opacity-0 invisible" : "opacity-100 visible"
      }`}
    >
      {/* Mobile Search Icon - shown left of other buttons */}
      {onSearchExpandedChange && !searchExpanded && (
        <button
          onClick={() => onSearchExpandedChange(true)}
          className="p-2 rounded-lg border bg-slate-800/80 backdrop-blur text-slate-400 hover:text-white border-slate-700 transition-all shadow-lg pointer-events-auto md:hidden"
          title="Search"
        >
          <svg
            className="h-5 w-5"
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
        </button>
      )}

      {!user ? (
        <>
          <button
            onClick={onLogin}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-sky-400 text-sm font-bold rounded-lg border border-slate-700 shadow-lg transition-all pointer-events-auto"
          >
            Log In
          </button>
          <button
            onClick={onSignup}
            className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white text-sm font-bold rounded-lg shadow-lg transition-all pointer-events-auto"
          >
            Sign Up
          </button>
        </>
      ) : (
        <button
          onClick={onShowProfile}
          className="w-10 h-10 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-400 hover:text-white hover:border-slate-500 transition-all shadow-lg pointer-events-auto overflow-hidden"
          title={user.username}
        >
          <div className="text-sm font-bold">
            {user.username.substring(0, 2).toUpperCase()}
          </div>
        </button>
      )}

    </div>
  );
};

