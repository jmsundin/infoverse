import React, {
  useState,
  useRef,
  useEffect,
  memo,
  useMemo,
  useCallback,
  useContext,
} from "react";
import ReactMarkdown from "react-markdown";
import {
  GraphNode,
  NodeType,
  ChatMessage,
  NodeColor,
  ResizeDirection,
  LODLevel,
} from "../types";
import { sendChatMessage, generateTitle } from "../services/geminiService";
import { NODE_HEADER_HEIGHT, NODE_COLORS } from "../constants";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { SidePanelContext } from "./SidePanel";
import { fetchWikipediaUrl } from "../services/wikidataService";

interface GraphNodeProps {
  node: GraphNode;
  isSelected?: boolean;
  isDragging?: boolean;
  viewMode?: "canvas" | "sidebar";
  lodLevel?: LODLevel;
  isClusterParent?: boolean;
  styleOverride?: React.CSSProperties;
  onMouseDown?: (e: React.MouseEvent | React.TouchEvent, id: string) => void;
  onUpdate: (id: string, updates: Partial<GraphNode>) => void;
  onExpand: (id: string, topic: string) => void;
  onExpandFromWikidata?: (id: string, topic: string) => void;
  onDelete: (id: string) => void;
  onResizeStart?: (
    e: React.MouseEvent | React.TouchEvent,
    id: string,
    direction: ResizeDirection
  ) => void;
  onToggleMaximize?: (id: string) => void;
  onOpenLink?: (url: string) => void;
  onConnectStart?: (id: string) => void;
  onViewSubgraph?: (id: string) => void;
  autoGraphEnabled?: boolean;
  onSetAutoGraphEnabled?: (enabled: boolean) => void;
  scale?: number;
}

export const GraphNodeComponent: React.FC<GraphNodeProps> = memo(
  ({
    node,
    isSelected = false,
    isDragging = false,
    viewMode = "canvas",
    lodLevel = "DETAIL",
    isClusterParent = false,
    styleOverride,
    onMouseDown,
    onUpdate,
    onExpand,
    onExpandFromWikidata,
    onDelete,
    onResizeStart,
    onToggleMaximize,
    onOpenLink,
    onConnectStart,
    onViewSubgraph,
    autoGraphEnabled,
    onSetAutoGraphEnabled,
    scale = 1,
  }) => {
    const [input, setInput] = useState("");
    const [isChatting, setIsChatting] = useState(false);
    const [streamingContent, setStreamingContent] = useState<string | null>(
      null
    );
    const [showSettings, setShowSettings] = useState(false);
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [titleEditValue, setTitleEditValue] = useState("");
    const [isEditingNote, setIsEditingNote] = useState(false);
    const chatContainerRef = useRef<HTMLDivElement>(null);
    const settingsRef = useRef<HTMLDivElement>(null);

    // Timer ref for auto-formatting notes on pause
    const previewTimerRef = useRef<any>(null);

    // Long Press Refs
    const longPressTimerRef = useRef<any>(null);
    const isLongPressRef = useRef(false);
    const LONG_PRESS_DURATION = 500; // ms

    const colorTheme = NODE_COLORS[node.color || "slate"];
    const isSidebar = viewMode === "sidebar";

    const sidePanelContext = useContext(SidePanelContext);
    const dragListeners = isSidebar && sidePanelContext ? sidePanelContext.dragListeners : {};

    // Semantic Zoom Modes
    const isClusterMode = lodLevel === "CLUSTER" && !isSelected && !isSidebar && !isClusterParent;
    const isClusterParentMode = lodLevel === "CLUSTER" && !isSelected && !isSidebar && isClusterParent;
    const isTitleOnly = lodLevel === "TITLE" && !isSelected && !isSidebar;
    const isCompact =
      !isSidebar && !isSelected;

    const titleText =
      node.type === NodeType.CHAT ? node.content : node.summary || node.content;

    // --- Long Press & Double Click Handlers ---

    const handleTouchStart = useCallback(
      (e: React.TouchEvent) => {
        if (!isSidebar && onMouseDown) onMouseDown(e, node.id);

        isLongPressRef.current = false;
        longPressTimerRef.current = setTimeout(() => {
          isLongPressRef.current = true;
          onDelete(node.id); // Triggers the delete confirmation in parent
        }, LONG_PRESS_DURATION);
      },
      [isSidebar, onMouseDown, node.id, onDelete]
    );

    const handleTouchEnd = useCallback((e: React.TouchEvent) => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    }, []);

    const handleTouchMove = useCallback((e: React.TouchEvent) => {
      // If moved significantly, cancel long press
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    }, []);

    const handleDoubleClick = useCallback((e: React.MouseEvent) => {
      e.stopPropagation();
      // onDelete(node.id); // Disabled delete on double click
    }, []);

    // Scroll to bottom of chat
    useEffect(() => {
      if (
        node.type === NodeType.CHAT &&
        !isClusterMode &&
        !isTitleOnly &&
        !isCompact &&
        chatContainerRef.current
      ) {
        chatContainerRef.current.scrollTop =
          chatContainerRef.current.scrollHeight;
      }
    }, [
      node.messages,
      isChatting,
      streamingContent,
      viewMode,
      isTitleOnly,
      isCompact,
      isClusterMode,
    ]);

    useEffect(() => {
      const handleClickOutside = (event: MouseEvent | TouchEvent) => {
        if (
          showSettings &&
          settingsRef.current &&
          !settingsRef.current.contains(event.target as Node)
        ) {
          setShowSettings(false);
        }
      };

      if (showSettings) {
        document.addEventListener("mousedown", handleClickOutside, true);
        document.addEventListener("touchstart", handleClickOutside, true);
      }
      return () => {
        document.removeEventListener("mousedown", handleClickOutside, true);
        document.removeEventListener("touchstart", handleClickOutside, true);
      };
    }, [showSettings]);

    // Clean up timer on unmount
    useEffect(() => {
      return () => {
        if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
      };
    }, []);

    // Check for Wikipedia article on selection
    useEffect(() => {
      if (
        isSelected &&
        node.content &&
        (!node.link || node.link.includes("wikidata.org"))
      ) {
        const checkWiki = async () => {
          const url = await fetchWikipediaUrl(node.content);
          if (url && url !== node.link) {
            onUpdate(node.id, { link: url });
          }
        };
        checkWiki();
      }
    }, [isSelected, node.content, node.link, node.id, onUpdate]);

    const handleSendMessage = async () => {
      if (!input.trim()) return;

      const userMsg: ChatMessage = {
        role: "user",
        text: input,
        timestamp: Date.now(),
      };
      const updatedMessages = [...(node.messages || []), userMsg];
      const currentInput = input;

      onUpdate(node.id, { messages: updatedMessages });
      setInput("");
      setIsChatting(true);
      setStreamingContent("");

      const result = await sendChatMessage(
        updatedMessages,
        userMsg.text,
        (chunk) => {
          setStreamingContent((prev) => (prev || "") + chunk);
        }
      );

      const modelTextToDisplay = result.text;
      const isLongAnswer =
        result.text.length > 400 || result.text.split("\n\n").length > 1;

      if (autoGraphEnabled && node.type === NodeType.CHAT && isLongAnswer) {
        onExpand(node.id, result.text);
      }

      const modelMsg: ChatMessage = {
        role: "model",
        text: modelTextToDisplay,
        timestamp: Date.now(),
      };

      onUpdate(node.id, { messages: [...updatedMessages, modelMsg] });
      setIsChatting(false);
      setStreamingContent(null);

      if (
        node.type === NodeType.CHAT &&
        (node.content === "New Chat" || node.content === "Chat")
      ) {
        const newTitle = await generateTitle(currentInput, result.text);
        onUpdate(node.id, { content: newTitle });
      }
    };

    const handleTitleSubmit = () => {
      if (titleEditValue.trim() !== "") {
        onUpdate(node.id, { content: titleEditValue });
      }
      setIsEditingTitle(false);
    };

    // Hybrid Editing Logic for Notes
    const handleNoteContentChange = (
      e: React.ChangeEvent<HTMLTextAreaElement>
    ) => {
      const newVal = e.target.value;
      onUpdate(node.id, { content: newVal });

      // Debounce the switch back to preview mode
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
      previewTimerRef.current = setTimeout(() => {
        setIsEditingNote(false);
      }, 2000); // 2 seconds of pause -> auto format
    };

    const handleNoteBlur = () => {
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
      setIsEditingNote(false);
    };

    const openNodeInSidePaneForMobileInput = useCallback(() => {
      if (isSidebar) return;
      if (!onToggleMaximize) return;
      if (!window.matchMedia("(max-width: 768px)").matches) return;
      onToggleMaximize(node.id);
    }, [isSidebar, onToggleMaximize, node.id]);

    const handleNoteFocus = (e: React.MouseEvent) => {
      e.stopPropagation();
      openNodeInSidePaneForMobileInput();
      setIsEditingNote(true);
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    };

    const handleLinkClick = (e: React.MouseEvent, url: string) => {
      e.preventDefault();
      e.stopPropagation();
      if (onOpenLink) {
        onOpenLink(url);
      } else {
        window.open(url, "_blank");
      }
    };

    const markdownComponents = useMemo(
      () => ({
        ul: ({ node, ...props }: any) => (
          <ul className="list-disc pl-4 my-1 space-y-1" {...props} />
        ),
        ol: ({ node, ...props }: any) => (
          <ol className="list-decimal pl-4 my-1 space-y-1" {...props} />
        ),
        h1: ({ node, ...props }: any) => (
          <h1
            className="text-xl font-bold my-2 border-b border-white/20 pb-1"
            {...props}
          />
        ),
        h2: ({ node, ...props }: any) => (
          <h2 className="text-lg font-bold my-2" {...props} />
        ),
        h3: ({ node, ...props }: any) => (
          <h3 className="text-base font-bold my-1" {...props} />
        ),
        a: ({ node, href, ...props }: any) => (
          <a
            href={href}
            onClick={(e) => {
              e.stopPropagation();
              handleLinkClick(e, href || "");
            }}
            className="text-sky-300 hover:underline cursor-pointer relative z-10"
            {...props}
          />
        ),
        p: ({ node, ...props }: any) => (
          <p
            className="mb-2 last:mb-0 leading-relaxed whitespace-pre-wrap"
            {...props}
          />
        ),
        blockquote: ({ node, ...props }: any) => (
          <blockquote
            className="border-l-4 border-white/30 pl-3 italic my-2 opacity-80"
            {...props}
          />
        ),
        img: ({ node, ...props }: any) => (
          <img className="max-w-full h-auto rounded my-2" {...props} />
        ),
        code(props: any) {
          const { children, className, node, ...rest } = props;
          const match = /language-(\w+)/.exec(className || "");
          return match ? (
            <SyntaxHighlighter
              {...rest}
              children={String(children).replace(/\n$/, "")}
              style={vscDarkPlus}
              language={match[1]}
              PreTag="div"
              className="rounded-lg my-2 text-xs !bg-[#1e1e1e] border border-slate-700 overflow-x-auto shadow-sm"
              wrapLongLines={true}
            />
          ) : (
            <code
              {...rest}
              className={`${className} bg-black/30 px-1 py-0.5 rounded font-mono text-[10px]`}
            >
              {children}
            </code>
          );
        },
        pre: (props: any) => <div className="not-prose" {...props} />,
      }),
      []
    );

    const transitionStyle = isDragging
        ? "none"
        : "box-shadow 0.2s, transform 0.2s, left 0.5s cubic-bezier(0.25, 1, 0.5, 1), top 0.5s cubic-bezier(0.25, 1, 0.5, 1)"; // Removed height transition to prevent 'retracting' animation

    const computedStyle: React.CSSProperties = isSidebar
      ? {
          width: "100%",
          height: "100%",
          position: "relative",
        }
      : styleOverride || {
          left: node.x,
          top: node.y,
          width: node.width || 300,
          height: isCompact ? NODE_HEADER_HEIGHT : node.height || 200,
          transition: transitionStyle,
          overflow: "visible",
          zIndex: isSelected ? 50 : isDragging ? 50 : 10,
        };

    const resizeHandleClass =
      "absolute z-50 hover:bg-sky-400/20 transition-colors touch-none";
    const displayMessages = node.messages || [];

    if (isClusterParentMode) {
      const scaleFactor = Math.min(Math.max((1 / scale) * 0.2, 1), 8);
      
      return (
        <div
          data-node-id={node.id}
          data-selected={isSelected}
          className={`absolute graph-node flex items-center justify-center transition-all duration-300 pointer-events-none`}
          style={{
            left: node.x,
            top: node.y,
            width: node.width || 300,
            height: node.height || 200,
            zIndex: 40,
          }}
        >
          <div
            className={`
                font-bold text-slate-100 drop-shadow-md 
                px-4 py-2 pointer-events-auto
                hover:text-sky-400 cursor-pointer text-center
            `}
            style={{
                transform: `scale(${scaleFactor})`,
                fontSize: '3.5rem',
                minWidth: '200px',
                textShadow: '0 2px 4px rgba(0,0,0,0.8)'
            }}
            onMouseDown={(e) =>
                !isSidebar && onMouseDown && onMouseDown(e, node.id)
            }
            onTouchStart={(e) =>
                !isSidebar && onMouseDown && onMouseDown(e, node.id)
            }
          >
             {titleText.length > 50 ? titleText.substring(0, 50) + "..." : titleText}
          </div>
        </div>
      );
    }

    if (isClusterMode) {
      return (
        <div
          data-node-id={node.id}
          data-selected={isSelected}
          className={`absolute graph-node flex items-center justify-center`}
          style={{
            left: node.x,
            top: node.y,
            width: 48,
            height: 48,
            pointerEvents: "none",
          }}
        >
          <div
            className={`w-6 h-6 rounded-full ${colorTheme.indicator} shadow-[0_0_8px_rgba(0,0,0,0.8)] ring-2 ring-slate-900 pointer-events-auto cursor-pointer hover:scale-150 transition-transform`}
            onMouseDown={(e) =>
              !isSidebar && onMouseDown && onMouseDown(e, node.id)
            }
            onTouchStart={(e) =>
              !isSidebar && onMouseDown && onMouseDown(e, node.id)
            }
            title={node.content}
          />
        </div>
      );
    }

    if (isTitleOnly) {
      return (
        <div
          data-node-id={node.id}
          data-selected={isSelected}
          className={`absolute graph-node flex items-center justify-center p-4 text-center animate-in fade-in zoom-in duration-300`}
          style={{
            left: node.x,
            top: node.y,
            width: node.width || 300,
            height: node.height || 200,
          }}
          onMouseDown={(e) =>
            !isSidebar && onMouseDown && onMouseDown(e, node.id)
          }
          onTouchStart={(e) =>
            !isSidebar && onMouseDown && onMouseDown(e, node.id)
          }
        >
          <div
            className={`
                text-2xl font-bold text-slate-100 drop-shadow-md bg-slate-900/60 backdrop-blur-sm 
                px-4 py-2 rounded-xl border border-white/10 ${
                  isSelected ? "ring-2 ring-sky-400" : ""
                }
                hover:bg-slate-800/80 cursor-pointer
            `}
          >
            {titleText}
          </div>
        </div>
      );
    }

    return (
      <div
        data-node-id={node.id}
        data-selected={isSelected}
        className={`${
          isSidebar
            ? "flex flex-col h-full w-full"
            : "absolute flex flex-col graph-node animate-in fade-in zoom-in duration-300"
        } group outline-none`}
        style={computedStyle}
        onMouseDown={(e) =>
          !isSidebar && onMouseDown && onMouseDown(e, node.id)
        }
        onTouchStart={(e) =>
          !isSidebar && onMouseDown && onMouseDown(e, node.id)
        }
      >
        {!isSidebar && !isCompact && (
          <div
            className="absolute top-[-60px] md:top-[-52px] left-0 right-0 h-10 md:h-8 flex items-center justify-end gap-2 md:gap-1 px-2 md:px-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-[60]"
            style={{ opacity: isSelected || showSettings ? 1 : undefined }}
          >
            <div className="flex gap-2 md:gap-1 bg-slate-800/90 backdrop-blur-sm border border-slate-700 rounded-lg p-2 md:p-1 pointer-events-auto shadow-md">
              {onExpandFromWikidata && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onExpandFromWikidata(node.id, node.content);
                  }}
                  className="min-w-[44px] min-h-[44px] p-2 md:min-w-0 md:min-h-0 md:p-1.5 text-slate-400 hover:text-amber-300 hover:bg-slate-700/50 rounded transition-colors flex items-center justify-center"
                  title="Expand from Wikidata (subtopics)"
                  onMouseDown={(e) => e.stopPropagation()}
                  onTouchStart={(e) => e.stopPropagation()}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="w-[18px] h-[18px] md:w-[14px] md:h-[14px]"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 3v18" />
                    <path d="M3 12h18" />
                    <path d="M8 6l4-3 4 3" />
                    <path d="M8 18l4 3 4-3" />
                    <path d="M6 8l-3 4 3 4" />
                    <path d="M18 8l3 4-3 4" />
                  </svg>
                </button>
              )}

              {node.link && (
                <button
                  onClick={(e) => handleLinkClick(e, node.link!)}
                  className={`min-w-[44px] min-h-[44px] p-2 md:min-w-0 md:min-h-0 md:p-1.5 rounded transition-colors flex items-center justify-center ${
                    node.link.includes("wikipedia.org")
                      ? "text-slate-400 hover:text-white hover:bg-slate-700/50"
                      : "text-slate-400 hover:text-blue-400 hover:bg-slate-700/50"
                  }`}
                  title={
                    node.link.includes("wikipedia.org")
                      ? "Open Wikipedia Article"
                      : "Open Wiki Link"
                  }
                  onMouseDown={(e) => e.stopPropagation()}
                  onTouchStart={(e) => e.stopPropagation()}
                >
                  {node.link.includes("wikipedia.org") ? (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="w-[18px] h-[18px] md:w-[14px] md:h-[14px]"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M3 5l5 14l4-10l4 10l5-14" />
                    </svg>
                  ) : (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="w-[18px] h-[18px] md:w-[14px] md:h-[14px]"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  )}
                </button>
              )}

              {onExpand && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onExpand(node.id, node.content);
                  }}
                  className="min-w-[44px] min-h-[44px] p-2 md:min-w-0 md:min-h-0 md:p-1.5 text-slate-400 hover:text-purple-400 hover:bg-slate-700/50 transition-colors rounded flex items-center justify-center"
                  title="Expand Subgraph (AI)"
                  onMouseDown={(e) => e.stopPropagation()}
                  onTouchStart={(e) => e.stopPropagation()}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="w-[18px] h-[18px] md:w-[14px] md:h-[14px]"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="5" r="2" />
                    <circle cx="5" cy="19" r="2" />
                    <circle cx="19" cy="19" r="2" />
                    <path d="M12 7v5" />
                    <path d="M5 17l7-5" />
                    <path d="M19 17l-7-5" />
                  </svg>
                </button>
              )}

              {onConnectStart && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onConnectStart(node.id);
                  }}
                  className="min-w-[44px] min-h-[44px] p-2 md:min-w-0 md:min-h-0 md:p-1.5 text-slate-400 hover:text-green-400 hover:bg-slate-700/50 transition-colors rounded flex items-center justify-center"
                  title="Connect to another node"
                  onMouseDown={(e) => e.stopPropagation()}
                  onTouchStart={(e) => e.stopPropagation()}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="w-[18px] h-[18px] md:w-[14px] md:h-[14px]"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                  </svg>
                </button>
              )}

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowSettings(!showSettings);
                }}
                className={`min-w-[44px] min-h-[44px] p-2 md:min-w-0 md:min-h-0 md:p-1.5 rounded hover:bg-slate-700/50 transition-colors flex items-center justify-center ${
                  showSettings
                    ? "text-sky-400 bg-slate-700/50"
                    : "text-slate-400 hover:text-sky-400"
                }`}
                title="Settings"
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-[18px] h-[18px] md:w-[14px] md:h-[14px]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </button>

              {onToggleMaximize && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleMaximize(node.id);
                  }}
                  className="min-w-[44px] min-h-[44px] p-2 md:min-w-0 md:min-h-0 md:p-1.5 rounded hover:bg-slate-700/50 transition-colors text-slate-400 hover:text-sky-400 flex items-center justify-center"
                  title="Maximize Side Pane"
                  onMouseDown={(e) => e.stopPropagation()}
                  onTouchStart={(e) => e.stopPropagation()}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="w-[18px] h-[18px] md:w-[14px] md:h-[14px]"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M15 3h6v6" />
                    <path d="M9 21H3v-6" />
                    <path d="M21 3l-7 7" />
                    <path d="M3 21l7-7" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        )}

        {showSettings && (
          <div
            ref={settingsRef}
            className={`absolute z-[60] bg-slate-800 border border-slate-700 rounded-lg shadow-xl flex flex-col gap-2 min-w-[140px] px-3 py-2 
                ${
                  isSidebar
                    ? "top-12 right-4 mt-2"
                    : "top-0 right-0 -translate-y-full mt-[-40px] mr-1"
                }`}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
          >
            <div className="flex gap-1.5 justify-center">
              {(Object.keys(NODE_COLORS) as NodeColor[]).map((c) => (
                <button
                  key={c}
                  className={`w-4 h-4 rounded-full ${
                    NODE_COLORS[c].indicator
                  } ${
                    node.color === c ? "ring-2 ring-white" : "hover:scale-110"
                  } transition-all`}
                  onClick={() => onUpdate(node.id, { color: c })}
                />
              ))}
            </div>

            {node.type === NodeType.CHAT && (
              <div className="flex flex-col gap-2 pt-2 border-t border-slate-700 mt-1">
                <button
                  onClick={async () => {
                    if (node.messages && node.messages.length > 0) {
                      const msgs = node.messages;
                      const lastUserMsg =
                        [...msgs].reverse().find((m) => m.role === "user")
                          ?.text || "";
                      const lastModelMsg =
                        [...msgs].reverse().find((m) => m.role === "model")
                          ?.text || "";
                      if (lastUserMsg) {
                        const newTitle = await generateTitle(
                          lastUserMsg,
                          lastModelMsg
                        );
                        onUpdate(node.id, { content: newTitle });
                      }
                    }
                    setShowSettings(false);
                  }}
                  className="text-[10px] uppercase font-bold text-slate-400 hover:text-sky-400 whitespace-nowrap text-left flex items-center gap-2"
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
                    <path d="M7 11a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
                    <path d="M5.05 19A5 5 0 0 1 2 15v-1a5 5 0 0 1 5-5h.1" />
                    <path d="M19.9 19a5 5 0 0 0 3-4v-1a5 5 0 0 0-5-5h-.1" />
                  </svg>
                  Regenerate Title
                </button>

                {onSetAutoGraphEnabled && (
                  <label className="flex items-center justify-between text-[10px] uppercase font-bold text-slate-400 hover:text-sky-400 cursor-pointer">
                    <span className="flex items-center gap-2">
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
                        <rect
                          x="3"
                          y="3"
                          width="18"
                          height="18"
                          rx="2"
                          ry="2"
                        />
                        <line x1="3" y1="9" x2="21" y2="9" />
                        <line x1="9" y1="21" x2="9" y2="9" />
                      </svg>
                      Auto-Graph
                    </span>
                    <input
                      type="checkbox"
                      checked={!!autoGraphEnabled}
                      onChange={(e) => onSetAutoGraphEnabled(e.target.checked)}
                      className="accent-sky-500 w-3 h-3 rounded-sm"
                    />
                  </label>
                )}

                <div className="flex items-center justify-between text-[10px] uppercase font-bold text-slate-400 mt-2 pt-2 border-t border-slate-700">
                  <span>Graph Levels</span>
                  <input
                    type="number"
                    min="1"
                    max="3"
                    value={node.autoExpandDepth || 1}
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      if (val >= 1 && val <= 3) {
                        onUpdate(node.id, { autoExpandDepth: val });
                      }
                    }}
                    className="w-8 bg-black/30 border border-slate-600 rounded px-1 text-center text-white focus:outline-none focus:border-sky-500"
                  />
                </div>
              </div>
            )}

            <div className="flex flex-col gap-1 mt-2 pt-2 border-t border-slate-700">
              <span className="text-[10px] uppercase font-bold text-slate-400">
                Aliases
              </span>
              <div className="flex flex-wrap gap-1 mb-1">
                {node.aliases?.map((alias) => (
                  <span
                    key={alias}
                    className="text-[10px] bg-slate-700 px-1.5 py-0.5 rounded flex items-center gap-1 group/alias"
                  >
                    {alias}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onUpdate(node.id, {
                          aliases: node.aliases?.filter((a) => a !== alias),
                        });
                      }}
                      className="hover:text-red-400 opacity-50 group-hover/alias:opacity-100"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <input
                type="text"
                placeholder="Add alias + Enter"
                className="text-xs bg-black/20 border border-slate-600 rounded px-1.5 py-1 w-full focus:outline-none focus:border-sky-500 placeholder-slate-600"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.stopPropagation();
                    const val = e.currentTarget.value.trim();
                    if (val) {
                      const newAliases = [...(node.aliases || [])];
                      if (!newAliases.includes(val)) {
                        newAliases.push(val);
                        onUpdate(node.id, { aliases: newAliases });
                      }
                      e.currentTarget.value = "";
                    }
                  }
                }}
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
              />
            </div>
          </div>
        )}

        {/* Visual Container for Clipping */}
        <div
          className={`flex flex-col w-full h-full overflow-hidden 
          ${isSidebar ? "" : "rounded-xl transition-shadow duration-200"}
          ${
            !isSidebar && isSelected
              ? "ring-4 ring-sky-400 shadow-[0_0_20px_rgba(56,189,248,0.4)]"
              : ""
          } 
          ${
            !isSidebar && isDragging
              ? "shadow-2xl scale-[1.01]"
              : !isSidebar
              ? "shadow-lg hover:shadow-xl"
              : ""
          } 
          ${colorTheme.bg} ${!isSidebar ? `${colorTheme.border} border` : ""}
      `}
        >
          <div
            className={`flex items-center justify-between ${"px-3 py-2"} ${
              colorTheme.header
            } 
            ${!isSidebar ? "border-b " + colorTheme.border : ""} 
            ${
              !isSidebar || dragListeners.onMouseDown ? (isDragging || dragListeners.onMouseDown ? "cursor-grabbing" : "cursor-grab") : ""
            } select-none relative touch-none shrink-0`}
            style={{ height: NODE_HEADER_HEIGHT }}
            onDoubleClick={handleDoubleClick}
            onTouchStart={(e) => {
               if (dragListeners.onTouchStart) dragListeners.onTouchStart(e);
               handleTouchStart(e);
            }}
            onTouchEnd={handleTouchEnd}
            onTouchMove={handleTouchMove}
            onMouseDown={(e) => {
               if (dragListeners.onMouseDown) {
                 dragListeners.onMouseDown(e);
               } else if (!isSidebar && onMouseDown) {
                 onMouseDown(e, node.id);
               }
            }}
          >
            <div className={`flex items-center gap-2 overflow-hidden flex-1`}>
              <span className={isSidebar ? "text-xl" : "text-lg"}>
                {node.type === NodeType.CHAT ? "💬" : "📝"}
              </span>

              {isEditingTitle ? (
                <input
                  type="text"
                  autoFocus
                  className={`bg-black/30 text-white px-1 py-0.5 rounded border border-slate-500 w-full focus:outline-none focus:border-sky-400 ${
                    isSidebar ? "text-lg" : "text-xs"
                  }`}
                  value={titleEditValue}
                  onChange={(e) => setTitleEditValue(e.target.value)}
                  onBlur={handleTitleSubmit}
                  onKeyDown={(e) => e.key === "Enter" && handleTitleSubmit()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onTouchStart={(e) => e.stopPropagation()}
                />
              ) : (
                <>
                  <span
                    className={`font-bold ${
                      colorTheme.text
                    } uppercase tracking-wider truncate cursor-text hover:underline decoration-slate-500/50 underline-offset-2 ${
                      isSidebar ? "text-lg" : "text-xs"
                    }`}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setTitleEditValue(node.content);
                      setIsEditingTitle(true);
                    }}
                    title={"Double click to rename"}
                  >
                    {node.type === NodeType.NOTE && !node.content
                      ? "Empty Note"
                      : node.type === NodeType.NOTE
                      ? node.content.split("\n")[0].substring(0, 25) +
                        (node.content.length > 25 ? "..." : "")
                      : node.content}
                  </span>
                </>
              )}

              {!isSidebar && node.parentId && (
                <span className="text-[10px] bg-sky-900/50 text-sky-300 px-1 rounded ml-1 border border-sky-800">
                  SUB
                </span>
              )}
            </div>

            {isSidebar && (
              <div className="flex items-center gap-2">
                {dragListeners.onMouseDown && (
                   <div 
                      className="cursor-grab active:cursor-grabbing p-1 text-slate-400 hover:text-white mr-1"
                      {...dragListeners}
                      onClick={(e) => e.stopPropagation()}
                   >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <circle cx="8" cy="7" r="1" />
                        <circle cx="8" cy="12" r="1" />
                        <circle cx="8" cy="17" r="1" />
                        <circle cx="16" cy="7" r="1" />
                        <circle cx="16" cy="12" r="1" />
                        <circle cx="16" cy="17" r="1" />
                      </svg>
                   </div>
                )}
                <div className="flex gap-1.5 mr-2">
                  {(Object.keys(NODE_COLORS) as NodeColor[]).map((c) => (
                    <button
                      key={c}
                      className={`w-3 h-3 rounded-full ${
                        NODE_COLORS[c].indicator
                      } ${
                        node.color === c
                          ? "ring-2 ring-white"
                          : "hover:scale-110"
                      } transition-all`}
                      onClick={() => onUpdate(node.id, { color: c })}
                    />
                  ))}
                </div>
                {node.link && (
                  <button
                    onClick={(e) => handleLinkClick(e, node.link!)}
                    className={`p-1 rounded hover:bg-slate-700/50 ${
                      node.link.includes("wikipedia.org")
                        ? "text-slate-400 hover:text-white"
                        : "text-slate-400 hover:text-sky-400"
                    }`}
                    title={
                      node.link.includes("wikipedia.org")
                        ? "Open Wikipedia Article"
                        : "Open Wiki Link"
                    }
                  >
                    {node.link.includes("wikipedia.org") ? (
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
                        <path d="M3 5l5 14l4-10l4 10l5-14" />
                      </svg>
                    ) : (
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
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                    )}
                  </button>
                )}

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowSettings(!showSettings);
                  }}
                  className={`p-1 rounded hover:bg-slate-700/50 transition-colors ${
                    showSettings
                      ? "text-sky-400 bg-slate-700/50"
                      : "text-slate-400 hover:text-white"
                  }`}
                  title="Settings"
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
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                </button>

                {onToggleMaximize && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleMaximize(node.id);
                    }}
                    className="p-1 text-slate-400 hover:text-white hover:bg-slate-700/50 rounded"
                    title="Close Sidebar"
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
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                )}
              </div>
            )}
          </div>

          {!isCompact && (
            <div
              className={`flex-1 overflow-hidden flex flex-col relative ${colorTheme.bg}`}
            >
              {node.type === NodeType.NOTE ? (
                isEditingNote || (!node.content && isSelected) ? (
                  <textarea
                    autoFocus
                    className={`w-full h-full bg-transparent ${
                      colorTheme.text
                    } resize-none focus:outline-none font-mono placeholder-slate-500 ${
                      isSidebar
                        ? "text-base p-6 leading-relaxed"
                        : "text-sm p-3"
                    } pointer-events-auto`}
                    value={node.content}
                    onChange={handleNoteContentChange}
                    onBlur={handleNoteBlur}
                    onFocus={openNodeInSidePaneForMobileInput}
                    placeholder="Write a note (Markdown supported)..."
                    onMouseDown={(e) => e.stopPropagation()}
                    onTouchStart={(e) => {
                      e.stopPropagation();
                      openNodeInSidePaneForMobileInput();
                    }}
                  />
                ) : (
                  <div
                    className={`w-full h-full overflow-y-auto overflow-x-hidden ${
                      colorTheme.text
                    } ${
                      isSidebar
                        ? "text-base p-6 leading-relaxed"
                        : "text-sm p-3"
                    } ${
                      isSelected || isSidebar
                        ? "pointer-events-auto cursor-text"
                        : "pointer-events-none"
                    }`}
                    onClick={handleNoteFocus}
                    onMouseDown={(e) => e.stopPropagation()}
                    onTouchStart={(e) => e.stopPropagation()}
                  >
                    {!node.content ? (
                      <span className="text-slate-500 italic opacity-60">
                        Empty note...
                      </span>
                    ) : (
                      <ReactMarkdown
                        className="prose prose-invert prose-sm max-w-none"
                        components={markdownComponents}
                      >
                        {node.content}
                      </ReactMarkdown>
                    )}
                  </div>
                )
              ) : (
                <>
                  <div
                    ref={chatContainerRef}
                    className={`flex-1 overflow-y-auto space-y-4 no-scrollbar nodrag-scroll-container ${
                      isSidebar ? "p-6" : "p-3"
                    } ${
                      isSelected || isSidebar
                        ? "pointer-events-auto"
                        : "pointer-events-none"
                    }`}
                    onMouseDown={(e) => e.stopPropagation()}
                    onTouchStart={(e) => e.stopPropagation()}
                  >
                    {displayMessages.length === 0 && (
                      <div
                        className={`text-slate-500 text-center italic mt-4 ${
                          isSidebar ? "text-base" : "text-xs"
                        }`}
                      >
                        Ask Gemini about "{node.content}"...
                      </div>
                    )}
                    {displayMessages.map((msg, idx) => (
                      <div
                        key={idx}
                        className={`flex flex-col ${
                          msg.role === "user" ? "items-end" : "items-start"
                        }`}
                      >
                        <div
                          className={`max-w-[95%] flex items-start gap-2 group`}
                        >
                          <div
                            className={`rounded-lg leading-relaxed shadow-sm ${
                              isSidebar
                                ? "px-5 py-4 text-base"
                                : "px-3 py-2 text-xs"
                            } ${
                              msg.role === "user"
                                ? "bg-sky-600 text-white rounded-tr-none"
                                : `${colorTheme.header} ${
                                    colorTheme.text
                                  } rounded-tl-none border ${
                                    colorTheme.border
                                  } ${
                                    msg.text.startsWith("_")
                                      ? "italic opacity-70"
                                      : ""
                                  }`
                            }`}
                          >
                            <ReactMarkdown components={markdownComponents}>
                              {msg.text}
                            </ReactMarkdown>
                          </div>
                        </div>
                      </div>
                    ))}

                    {streamingContent && (
                      <div className={`flex flex-col items-start`}>
                        <div
                          className={`max-w-[95%] flex items-start gap-2 group`}
                        >
                          <div
                            className={`rounded-lg leading-relaxed shadow-sm ${
                              isSidebar
                                ? "px-5 py-4 text-base"
                                : "px-3 py-2 text-xs"
                            } ${colorTheme.header} ${
                              colorTheme.text
                            } rounded-tl-none border ${colorTheme.border}`}
                          >
                            <ReactMarkdown components={markdownComponents}>
                              {streamingContent + " ▍"}
                            </ReactMarkdown>
                          </div>
                        </div>
                      </div>
                    )}

                    {isChatting && !streamingContent && (
                      <div className="flex items-start">
                        <div
                          className={`${colorTheme.header} ${
                            colorTheme.text
                          } border ${
                            colorTheme.border
                          } rounded-lg rounded-tl-none px-3 py-2 animate-pulse ${
                            isSidebar ? "text-base" : "text-xs"
                          }`}
                        >
                          Thinking...
                        </div>
                      </div>
                    )}
                  </div>

                  <div
                    className={`p-2 bg-black/10 border-t ${colorTheme.border} flex gap-2`}
                  >
                    <input
                      type="text"
                      className={`flex-1 bg-black/20 border ${
                        colorTheme.border
                      } rounded ${
                        colorTheme.text
                      } focus:outline-none focus:border-sky-400 placeholder-slate-500 ${
                        isSidebar ? "text-base px-4 py-3" : "text-xs px-2 py-1"
                      }`}
                      placeholder="Ask Gemini..."
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) =>
                        e.key === "Enter" && handleSendMessage()
                      }
                      onFocus={openNodeInSidePaneForMobileInput}
                      onMouseDown={(e) => e.stopPropagation()}
                      onTouchStart={(e) => {
                        e.stopPropagation();
                        openNodeInSidePaneForMobileInput();
                      }}
                    />
                    <button
                      onClick={handleSendMessage}
                      disabled={isChatting}
                      className={`bg-sky-600 hover:bg-sky-500 text-white rounded disabled:opacity-50 ${
                        isSidebar ? "px-6 py-2 text-base" : "px-2 py-1 text-xs"
                      }`}
                    >
                      Send
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {!isSidebar && !isCompact && onResizeStart && (
          <>
            <div
              className={`${resizeHandleClass} cursor-n-resize top-0 left-4 right-4 h-4 -mt-2`}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onResizeStart(e, node.id, "n");
              }}
              onTouchStart={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onResizeStart(e, node.id, "n");
              }}
            />
            <div
              className={`${resizeHandleClass} cursor-s-resize bottom-0 left-4 right-4 h-4 -mb-2`}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onResizeStart(e, node.id, "s");
              }}
              onTouchStart={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onResizeStart(e, node.id, "s");
              }}
            />
            <div
              className={`${resizeHandleClass} cursor-w-resize left-0 top-4 bottom-4 w-4 -ml-2`}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onResizeStart(e, node.id, "w");
              }}
              onTouchStart={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onResizeStart(e, node.id, "w");
              }}
            />
            <div
              className={`${resizeHandleClass} cursor-e-resize right-0 top-4 bottom-4 w-4 -mr-2`}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onResizeStart(e, node.id, "e");
              }}
              onTouchStart={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onResizeStart(e, node.id, "e");
              }}
            />
            <div
              className={`${resizeHandleClass} cursor-nw-resize top-0 left-0 w-5 h-5 -mt-2 -ml-2 rounded-tl`}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onResizeStart(e, node.id, "nw");
              }}
              onTouchStart={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onResizeStart(e, node.id, "nw");
              }}
            />
            <div
              className={`${resizeHandleClass} cursor-ne-resize top-0 right-0 w-5 h-5 -mt-2 -mr-2 rounded-tr`}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onResizeStart(e, node.id, "ne");
              }}
              onTouchStart={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onResizeStart(e, node.id, "ne");
              }}
            />
            <div
              className={`${resizeHandleClass} cursor-sw-resize bottom-0 left-0 w-5 h-5 -mb-2 -ml-2 rounded-bl`}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onResizeStart(e, node.id, "sw");
              }}
              onTouchStart={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onResizeStart(e, node.id, "sw");
              }}
            />
            <div
              className={`${resizeHandleClass} cursor-se-resize bottom-0 right-0 w-5 h-5 -mb-2 -mr-2 rounded-br`}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onResizeStart(e, node.id, "se");
              }}
              onTouchStart={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onResizeStart(e, node.id, "se");
              }}
            />
          </>
        )}
      </div>
    );
  }
);
