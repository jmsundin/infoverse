import React, { useState, useEffect, useRef } from "react";
import { GraphNode } from "../types";

interface SearchResult {
  title: string;
  description?: string;
  thumbnail?: { url: string };
}

interface SearchBarProps {
  nodes: GraphNode[];
  onSelect: (topic: string, expand: boolean, isWiki?: boolean) => void;
  onNavigate: (id: string) => void;
  onClose: () => void;
  onPreview?: (url: string) => void;
  isCloud?: boolean;
}

export const SearchBar: React.FC<SearchBarProps> = ({
  nodes,
  onSelect,
  onNavigate,
  onClose,
  onPreview,
  isCloud = false,
}) => {
  const [query, setQuery] = useState("");
  const [wikiResults, setWikiResults] = useState<SearchResult[]>([]);
  const [localResults, setLocalResults] = useState<
    (GraphNode & { similarity?: number })[]
  >([]);
  const [searchMode, setSearchMode] = useState<"keyword" | "semantic">(
    "keyword"
  );
  const [isOpen, setIsOpen] = useState(false); // Controls the dropdown results
  const [loading, setLoading] = useState(false);

  const [isMobile, setIsMobile] = useState(false);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const trigger = document.getElementById("search-trigger-icon");

      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(target) &&
        (!trigger || !trigger.contains(target))
      ) {
        onClose();
      }
    };
    // Use capture phase to detect clicks even if stopPropagation is used (e.g. on Nodes)
    document.addEventListener("mousedown", handleClickOutside, true);
    return () =>
      document.removeEventListener("mousedown", handleClickOutside, true);
  }, [onClose]);

  useEffect(() => {
    const fetchResults = async () => {
      if (!query.trim()) {
        if (nodes.length > 0) {
          // Suggestion Mode: Pick a random node
          const randomNode = nodes[Math.floor(Math.random() * nodes.length)];
          setLocalResults([randomNode]);

          // Fetch related from Wiki
          try {
            setLoading(true);
            const response = await fetch(
              `https://api.wikimedia.org/core/v1/wikipedia/en/search/title?q=${encodeURIComponent(
                randomNode.content
              )}&limit=6`
            );
            const data = await response.json();

            if (data.pages && data.pages.length > 0) {
              const suggestions = data.pages
                .map((p: any) => ({
                  title: p.title,
                  description: p.description,
                  thumbnail: p.thumbnail,
                }))
                .filter(
                  (p: SearchResult) =>
                    p.title.toLowerCase() !==
                      randomNode.content.toLowerCase() &&
                    !nodes.some(
                      (n) => n.content.toLowerCase() === p.title.toLowerCase()
                    )
                );

              setWikiResults(suggestions.slice(0, 3));
            } else {
              setWikiResults([]);
            }
            setIsOpen(true);
          } catch (e) {
            console.error("Suggestion fetch error", e);
            setWikiResults([]);
          } finally {
            setLoading(false);
          }
        } else {
          setWikiResults([]);
          setLocalResults([]);
        }
        return;
      }

      setLoading(true);

      // 1. Local Search
      if (searchMode === "semantic" && isCloud) {
        try {
          const apiBase = (import.meta as any).env.VITE_API_URL || "";
          const res = await fetch(
            `${apiBase}/api/search/semantic?q=${encodeURIComponent(query)}`
          );
          const data = await res.json();

          if (data.results && Array.isArray(data.results)) {
            // Map back to full node objects if possible, or use returned data
            // The API returns id, content, summary, similarity
            // We want to preserve the client-side node state (color, etc) if available
            const mapped = data.results
              .map((r: any) => {
                const existing = nodes.find((n) => n.id === r.id);
                return existing
                  ? { ...existing, similarity: r.similarity }
                  : null;
              })
              .filter(Boolean);

            setLocalResults(mapped);
          } else {
            setLocalResults([]);
          }
        } catch (e) {
          console.error("Semantic search error", e);
          setLocalResults([]);
        }
      } else {
        // Keyword Search (Case insensitive)
        const normalizedQuery = query.toLowerCase();
        const matchingNodes = nodes.filter((node) => {
          const titleMatch = node.content
            .toLowerCase()
            .includes(normalizedQuery);
          const aliasMatch = node.aliases?.some((alias) =>
            alias.toLowerCase().includes(normalizedQuery)
          );
          return titleMatch || aliasMatch;
        });
        setLocalResults(matchingNodes);
      }

      // 2. Wikipedia Search
      try {
        // Using Wikimedia Core REST API for title search
        const response = await fetch(
          `https://api.wikimedia.org/core/v1/wikipedia/en/search/title?q=${encodeURIComponent(
            query
          )}&limit=6`
        );
        const data = await response.json();

        if (data.pages && data.pages.length > 0) {
          // Filter out Wiki results that exactly match existing node titles to avoid duplicates
          const filteredWiki = data.pages
            .map((p: any) => ({
              title: p.title,
              description: p.description,
              thumbnail: p.thumbnail,
            }))
            .filter(
              (p: SearchResult) =>
                !nodes.some(
                  (n) =>
                    n.content.toLowerCase() === p.title.toLowerCase() ||
                    n.aliases?.some(
                      (a) => a.toLowerCase() === p.title.toLowerCase()
                    )
                )
            );

          setWikiResults(filteredWiki);
        } else {
          setWikiResults([]);
        }
        setIsOpen(true);
      } catch (error) {
        console.error("Wiki search error:", error);
        setWikiResults([]);
        setIsOpen(true);
      } finally {
        setLoading(false);
      }
    };

    const timeoutId = setTimeout(fetchResults, 300);
    return () => clearTimeout(timeoutId);
  }, [query, nodes, searchMode, isCloud]);

  return (
    <div
      ref={wrapperRef}
      className={`absolute z-[90] transition-all duration-200 pointer-events-none
         ${
           isMobile
             ? "top-16 left-4 right-4" // Mobile Expanded Position
             : "top-4 left-1/2 -translate-x-1/2 w-96" // Desktop Position
         }
      `}
    >
      <div className="relative group font-sans pointer-events-auto">
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
          className="block w-full rounded-xl border border-slate-600 bg-slate-800/90 backdrop-blur-md py-2.5 pl-10 pr-24 text-sm text-slate-100 placeholder-slate-400 focus:border-sky-500 focus:bg-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500 shadow-lg transition-all"
          placeholder={
            searchMode === "semantic"
              ? "Ask a question..."
              : "Search for a topic..."
          }
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setIsOpen(true)}
        />

        {/* Toggle Switch */}
        {isCloud && (
          <div className="absolute inset-y-0 right-8 flex items-center pr-2">
            <button
              onClick={() =>
                setSearchMode((prev) =>
                  prev === "keyword" ? "semantic" : "keyword"
                )
              }
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold uppercase transition-colors border ${
                searchMode === "semantic"
                  ? "bg-sky-900/50 text-sky-400 border-sky-700 hover:bg-sky-900"
                  : "bg-slate-700/50 text-slate-400 border-slate-600 hover:bg-slate-700"
              }`}
              title="Toggle Semantic Search"
            >
              {searchMode === "semantic" ? (
                <>
                  <span className="text-xs">🧠</span>
                  <span>AI</span>
                </>
              ) : (
                <>
                  <span className="text-xs">🔍</span>
                  <span>Key</span>
                </>
              )}
            </button>
          </div>
        )}

        {/* Close Button */}
        <button
          className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-500 hover:text-slate-300"
          onClick={() => {
            setQuery("");
            onClose();
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

        {isOpen && (
          <ul className="absolute mt-2 w-full bg-slate-800 border border-slate-700 rounded-xl shadow-2xl overflow-hidden max-h-96 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-600">
            {/* 1. Existing Nodes Section */}
            {localResults.length > 0 && (
              <>
                <li className="px-4 py-2 bg-slate-700/50 text-xs font-bold text-slate-400 uppercase tracking-wider">
                  {query ? "Existing Nodes" : "Suggested from your Canvas"}
                </li>
                {localResults.map((node) => (
                  <li
                    key={node.id}
                    className="flex border-b border-slate-700/50 last:border-0 hover:bg-slate-700/30 transition-colors group/item"
                  >
                    <button
                      className="flex-1 text-left px-4 py-3 flex items-center gap-3 min-w-0 focus:outline-none focus:bg-slate-700/50"
                      onClick={() => {
                        onNavigate(node.id);
                        setQuery("");
                        setIsOpen(false);
                        onClose();
                      }}
                    >
                      <div className="w-10 h-10 rounded-md bg-emerald-900/30 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
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
                          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                        </svg>
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-emerald-300 truncate">
                          {node.content}
                        </div>
                        <div className="text-xs text-slate-500 truncate flex gap-2">
                          <span>Jump to existing node</span>
                          {node.similarity !== undefined && (
                            <span className="text-sky-400 font-bold">
                              {Math.round(node.similarity * 100)}% match
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </>
            )}

            {/* 2. Wikipedia / Search Results */}
            {localResults.length > 0 && wikiResults.length > 0 && (
              <li className="px-4 py-2 bg-slate-700/50 text-xs font-bold text-slate-400 uppercase tracking-wider border-t border-slate-700/50">
                {query ? "New from Wikipedia" : "Related Topics"}
              </li>
            )}

            {wikiResults.map((result) => (
              <li
                key={result.title}
                className="flex border-b border-slate-700/50 last:border-0 hover:bg-slate-700/30 transition-colors group/item"
              >
                {/* Main Click: Preview / Open in SidePanel */}
                <button
                  className="flex-1 text-left px-4 py-3 flex items-center gap-3 min-w-0 focus:outline-none focus:bg-slate-700/50"
                  onClick={() => {
                    if (onPreview) {
                      const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(
                        result.title.replace(/ /g, "_")
                      )}`;
                      onPreview(url);
                    } else {
                      onSelect(result.title, false, true);
                    }
                    setQuery("");
                    setIsOpen(false);
                    onClose();
                  }}
                  title="Open in Side Panel"
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
                      onClose();
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
            ))}

            {/* 3. Create New Option - ONLY if no local results */}
            {query && localResults.length === 0 && (
              <li className="p-2 border-t border-slate-700/50">
                <button
                  className="w-full text-left px-4 py-3 rounded-lg hover:bg-slate-700/50 flex items-center gap-3 transition-colors text-slate-300 group"
                  onClick={() => {
                    onSelect(query, false, false);
                    setQuery("");
                    setIsOpen(false);
                    onClose();
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
                      Topic not found? Create a new node.
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
