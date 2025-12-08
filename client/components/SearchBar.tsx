import React, { useState, useEffect, useRef } from "react";

interface SearchResult {
  title: string;
  description?: string;
  thumbnail?: { url: string };
}

interface SearchBarProps {
  onSelect: (topic: string, expand: boolean, isWiki?: boolean) => void;
}

export const SearchBar: React.FC<SearchBarProps> = ({ onSelect }) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  // Mobile UI States
  const [isMobile, setIsMobile] = useState(false);
  const [mobileExpanded, setMobileExpanded] = useState(false);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
        // On mobile, if clicking outside, we might want to collapse the bar if empty
        if (isMobile && !query) {
          setMobileExpanded(false);
        }
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isMobile, query]);

  useEffect(() => {
    if (mobileExpanded && inputRef.current) {
      inputRef.current.focus();
    }
  }, [mobileExpanded]);

  useEffect(() => {
    const fetchResults = async () => {
      if (!query.trim()) {
        setResults([]);
        return;
      }

      setLoading(true);
      try {
        // Using Wikimedia Core REST API for title search
        const response = await fetch(
          `https://api.wikimedia.org/core/v1/wikipedia/en/search/title?q=${encodeURIComponent(
            query
          )}&limit=6`
        );
        const data = await response.json();

        if (data.pages && data.pages.length > 0) {
          setResults(
            data.pages.map((p: any) => ({
              title: p.title,
              description: p.description,
              thumbnail: p.thumbnail,
            }))
          );
        } else {
          setResults([]);
        }
        setIsOpen(true);
      } catch (error) {
        console.error("Wiki search error:", error);
        setResults([]);
        setIsOpen(true);
      } finally {
        setLoading(false);
      }
    };

    const timeoutId = setTimeout(fetchResults, 300);
    return () => clearTimeout(timeoutId);
  }, [query]);

  // Collapsed Mobile View (Magnifying Glass Icon)
  if (isMobile && !mobileExpanded) {
    return (
      <button
        className="absolute z-50 top-4 right-16 w-10 h-10 flex items-center justify-center bg-slate-800 border border-slate-700 rounded-full shadow-xl text-slate-200 hover:text-white hover:bg-slate-700 transition-all"
        onClick={() => setMobileExpanded(true)}
        title="Search Wikipedia"
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
    );
  }

  // Expanded View (Desktop or Mobile Expanded)
  return (
    <div
      ref={wrapperRef}
      className={`absolute z-50 transition-all duration-200
         ${
           isMobile
             ? "top-16 left-4 right-4" // Mobile Expanded Position
             : "top-4 left-1/2 -translate-x-1/2 w-96" // Desktop Position
         }
      `}
    >
      <div className="relative group font-sans">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          {loading ? (
            <div className="h-4 w-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin"></div>
          ) : (
            <svg
              className="h-4 w-4 text-slate-400"
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
          )}
        </div>
        <input
          ref={inputRef}
          type="text"
          className="block w-full rounded-xl border border-slate-600 bg-slate-800/90 backdrop-blur-md py-2.5 pl-10 pr-10 text-sm text-slate-100 placeholder-slate-400 focus:border-sky-500 focus:bg-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500 shadow-lg transition-all"
          placeholder="Search Wikipedia..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query && setIsOpen(true)}
        />

        {/* Close Button for Mobile */}
        {isMobile && (
          <button
            className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-500 hover:text-slate-300"
            onClick={() => {
              setQuery("");
              setMobileExpanded(false);
            }}
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
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}

        {isOpen && query && (
          <ul className="absolute mt-2 w-full bg-slate-800 border border-slate-700 rounded-xl shadow-2xl overflow-hidden max-h-96 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-600">
            {results.length > 0 ? (
              results.map((result) => (
                <li
                  key={result.title}
                  className="flex border-b border-slate-700/50 last:border-0 hover:bg-slate-700/30 transition-colors group/item"
                >
                  {/* Main Click: Add Single Node */}
                  <button
                    className="flex-1 text-left px-4 py-3 flex items-center gap-3 min-w-0 focus:outline-none focus:bg-slate-700/50"
                    onClick={() => {
                      onSelect(result.title, false, true);
                      setQuery("");
                      setIsOpen(false);
                      if (isMobile) setMobileExpanded(false);
                    }}
                    title="Add as single node"
                  >
                    {result.thumbnail?.url ? (
                      <img
                        src={result.thumbnail.url}
                        alt=""
                        className="w-10 h-10 rounded-md object-cover bg-slate-700 shrink-0"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-md bg-slate-700 flex items-center justify-center text-slate-500 shrink-0">
                        <span className="text-xs font-bold">W</span>
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-200 truncate">
                        {result.title}
                      </div>
                      {result.description && (
                        <div className="text-xs text-slate-400 truncate">
                          {result.description}
                        </div>
                      )}
                    </div>
                  </button>

                  {/* Secondary Action: Add & Expand Subgraph */}
                  <div className="flex items-stretch border-l border-slate-700/50">
                    <button
                      className="px-4 text-slate-500 hover:text-sky-400 hover:bg-slate-700/80 transition-all flex items-center justify-center"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(result.title, true, true);
                        setQuery("");
                        setIsOpen(false);
                        if (isMobile) setMobileExpanded(false);
                      }}
                      title="Add node and generate subgraph"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="18"
                        height="18"
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
                    </button>
                  </div>
                </li>
              ))
            ) : (
              <li className="p-2">
                <button
                  className="w-full text-left px-4 py-3 rounded-lg hover:bg-slate-700/50 flex items-center gap-3 transition-colors text-slate-300 group"
                  onClick={() => {
                    onSelect(query, false, false);
                    setQuery("");
                    setIsOpen(false);
                    if (isMobile) setMobileExpanded(false);
                  }}
                >
                  <div className="w-10 h-10 rounded-md bg-emerald-900/30 flex items-center justify-center text-emerald-400 shrink-0 border border-emerald-700/30 group-hover:bg-emerald-900/50 group-hover:border-emerald-500/50 transition-colors">
                    <span className="text-lg">✨</span>
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium text-emerald-400 group-hover:text-emerald-300 transition-colors">
                      Chat with AI about "{query}"
                    </div>
                    <div className="text-xs text-slate-500">
                      Topic not found on Wikipedia
                    </div>
                  </div>
                </button>
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
};
