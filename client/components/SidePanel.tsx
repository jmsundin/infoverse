import React, {
  useEffect,
  useState,
  useRef,
  createContext,
  useContext,
} from "react";

type SidePanelDockPosition =
  | "left"
  | "right"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

interface SidePanelContextType {
  dragListeners: {
    onMouseDown: (e: React.MouseEvent) => void;
    onTouchStart: (e: React.TouchEvent) => void;
  };
}

export const SidePanelContext = createContext<SidePanelContextType | null>(
  null
);

export const useSidePanel = () => useContext(SidePanelContext);

export interface SidePanelLayout {
  width: number; // percentage
  dockPosition: SidePanelDockPosition;
  isMobile: boolean;
  isResizing: boolean;
}

interface SidePanelProps {
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
  initialWidthPercent?: number;
  hideDefaultDragHandle?: boolean;
  onLayoutChange?: (layout: SidePanelLayout) => void;
}

const SIDEBAR_WIDTH = 64;

const SidePanelBase = ({
  onClose,
  children,
  title,
  initialWidthPercent = 33,
  hideDefaultDragHandle = false,
  onLayoutChange,
}: SidePanelProps) => {
  const [dimension, setDimension] = useState(() => {
    if (typeof window !== "undefined" && window.innerWidth < 768) return 100;
    return initialWidthPercent;
  });
  const [isMobile, setIsMobile] = useState(false);
  const [dockPosition, setDockPosition] =
    useState<SidePanelDockPosition>("right");
  const [isDockDragging, setIsDockDragging] = useState(false);
  const [dockPreview, setDockPreview] = useState<SidePanelDockPosition | null>(
    null
  );
  const isResizingRef = useRef(false);
  const isDockDraggingRef = useRef(false);
  const dockPreviewRef = useRef<SidePanelDockPosition | null>(null);

  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile((prev) => {
        if (prev !== mobile) {
          if (mobile) setDimension(100);
          else setDimension(initialWidthPercent);
        }
        return mobile;
      });
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, [initialWidthPercent]);

  useEffect(() => {
    // Determine effective width/state for layout reporting
    let reportedWidth = dimension;
    if (
      dockPosition === "top-left" ||
      dockPosition === "top-right" ||
      dockPosition === "bottom-left" ||
      dockPosition === "bottom-right"
    ) {
      reportedWidth = 50; // Corner docks are always 50% width
    }

    onLayoutChange?.({
      width: reportedWidth,
      dockPosition,
      isMobile,
      isResizing: isResizingRef.current || isDockDraggingRef.current,
    });
  }, [dimension, dockPosition, isMobile, onLayoutChange, isDockDragging]); // Added isDockDragging dependency to trigger updates during dock drag if needed

  const getDockPositionFromPoint = (
    clientX: number,
    clientY: number
  ): SidePanelDockPosition => {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const edgeThresholdPx = Math.min(140, viewportWidth * 0.18);
    if (clientX <= edgeThresholdPx) return "left";
    if (clientX >= viewportWidth - edgeThresholdPx) return "right";

    const isLeft = clientX < viewportWidth / 2;
    const isTop = clientY < viewportHeight / 2;

    if (isLeft && isTop) return "top-left";
    if (!isLeft && isTop) return "top-right";
    if (isLeft && !isTop) return "bottom-left";
    return "bottom-right";
  };

  const getDockPreviewRectStyle = (
    dock: SidePanelDockPosition
  ): React.CSSProperties => {
    const base: React.CSSProperties = { position: "absolute" };
    const leftOffset = isMobile ? 0 : SIDEBAR_WIDTH;

    switch (dock) {
      case "left":
        return {
          ...base,
          left: leftOffset,
          top: 0,
          width: isMobile ? "50vw" : `calc(50vw - ${leftOffset / 2}px)`,
          height: "100vh",
        };
      case "right":
        return { ...base, right: 0, top: 0, width: "50vw", height: "100vh" };
      case "top-left":
        return {
          ...base,
          left: leftOffset,
          top: 0,
          width: isMobile ? "50vw" : `calc(50vw - ${leftOffset / 2}px)`,
          height: "50vh",
        };
      case "top-right":
        return { ...base, right: 0, top: 0, width: "50vw", height: "50vh" };
      case "bottom-left":
        return {
          ...base,
          left: leftOffset,
          bottom: 0,
          width: isMobile ? "50vw" : `calc(50vw - ${leftOffset / 2}px)`,
          height: "50vh",
        };
      case "bottom-right":
        return {
          ...base,
          right: 0,
          bottom: 0,
          width: "50vw",
          height: "50vh",
        };
      default: {
        const _exhaustive: never = dock;
        return base;
      }
    }
  };

  useEffect(() => {
    const handleMove = (e: MouseEvent | TouchEvent) => {
      if (!isResizingRef.current) return;

      const clientX =
        "touches" in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
      const clientY =
        "touches" in e ? e.touches[0].clientY : (e as MouseEvent).clientY;

      if (isMobile) {
        // Mobile: Resize Height (Top Edge)
        // Height is distance from bottom. clientY is distance from top.
        // New Height = Window Height - Mouse Y
        const newHeightPercent =
          ((window.innerHeight - clientY) / window.innerHeight) * 100;
        setDimension(Math.max(30, Math.min(90, newHeightPercent)));
      } else {
        const isHalfDocked =
          dockPosition === "left" || dockPosition === "right";
        if (!isHalfDocked) return;

        // Desktop:
        // - dock right: width is distance from right edge
        // - dock left: width is distance from left edge (minus sidebar)
        let newWidthPercent;

        if (dockPosition === "right") {
          newWidthPercent =
            ((window.innerWidth - clientX) / window.innerWidth) * 100;
        } else {
          // Left dock
          const effectiveX = Math.max(0, clientX - SIDEBAR_WIDTH);
          newWidthPercent = (effectiveX / window.innerWidth) * 100;
        }

        setDimension(Math.max(20, Math.min(80, newWidthPercent)));
      }
    };

    const handleEnd = () => {
      isResizingRef.current = false;
      document.body.style.cursor = "";
    };

    document.addEventListener("mousemove", handleMove);
    document.addEventListener("touchmove", handleMove, { passive: false });
    document.addEventListener("mouseup", handleEnd);
    document.addEventListener("touchend", handleEnd);
    return () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("touchmove", handleMove);
      document.removeEventListener("mouseup", handleEnd);
      document.removeEventListener("touchend", handleEnd);
    };
  }, [isMobile, dockPosition]);

  useEffect(() => {
    const handleDockMove = (e: MouseEvent | TouchEvent) => {
      if (!isDockDraggingRef.current) return;

      const clientX =
        "touches" in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
      const clientY =
        "touches" in e ? e.touches[0].clientY : (e as MouseEvent).clientY;
      const nextPreview = getDockPositionFromPoint(clientX, clientY);
      dockPreviewRef.current = nextPreview;
      setDockPreview(nextPreview);
    };

    const handleDockEnd = () => {
      if (!isDockDraggingRef.current) return;
      isDockDraggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setIsDockDragging(false);
      setDockPreview(null);

      const nextDock = dockPreviewRef.current;
      dockPreviewRef.current = null;
      if (nextDock) setDockPosition(nextDock);
    };

    document.addEventListener("mousemove", handleDockMove);
    document.addEventListener("touchmove", handleDockMove, {
      passive: false,
    });
    document.addEventListener("mouseup", handleDockEnd);
    document.addEventListener("touchend", handleDockEnd);
    document.addEventListener("touchcancel", handleDockEnd);
    return () => {
      document.removeEventListener("mousemove", handleDockMove);
      document.removeEventListener("touchmove", handleDockMove);
      document.removeEventListener("mouseup", handleDockEnd);
      document.removeEventListener("touchend", handleDockEnd);
      document.removeEventListener("touchcancel", handleDockEnd);
    };
  }, []);

  const panelStyle: React.CSSProperties = isMobile
    ? {
        height: `${dimension}%`,
        width: "100%",
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        borderTopWidth: "1px",
        borderLeftWidth: "0px",
        paddingTop: "60px",
        willChange: "transform",
      }
    : (() => {
        const base: React.CSSProperties = {
          position: "fixed",
          minWidth: "320px",
          borderTopWidth: "0px",
          willChange: "transform",
        };

        const sidebarOffset = `${SIDEBAR_WIDTH}px`;

        switch (dockPosition) {
          case "right":
            return {
              ...base,
              top: 0,
              right: 0,
              bottom: 0,
              width: `${dimension}%`,
              height: "100%",
              borderLeftWidth: "1px",
            };
          case "left":
            return {
              ...base,
              top: 0,
              left: sidebarOffset,
              bottom: 0,
              width: `${dimension}%`,
              height: "100%",
              borderLeftWidth: "0px",
              borderRightWidth: "1px",
            };
          case "top-left":
            return {
              ...base,
              top: 0,
              left: sidebarOffset,
              width: "50%",
              height: "50%",
              borderRightWidth: "1px",
              borderBottomWidth: "1px",
            };
          case "top-right":
            return {
              ...base,
              top: 0,
              right: 0,
              width: "50%",
              height: "50%",
              borderLeftWidth: "1px",
              borderBottomWidth: "1px",
            };
          case "bottom-left":
            return {
              ...base,
              bottom: 0,
              left: sidebarOffset,
              width: "50%",
              height: "50%",
              borderRightWidth: "1px",
              borderTopWidth: "1px",
            };
          case "bottom-right":
            return {
              ...base,
              bottom: 0,
              right: 0,
              width: "50%",
              height: "50%",
              borderLeftWidth: "1px",
              borderTopWidth: "1px",
            };
          default: {
            const _exhaustive: never = dockPosition;
            return base;
          }
        }
      })();

  const panelAnimationClass = isMobile
    ? "animate-in slide-in-from-bottom duration-300 ease-out"
    : dockPosition === "left"
    ? "animate-in slide-in-from-left duration-300 ease-out"
    : "animate-in slide-in-from-right duration-300 ease-out";

  const handleDragStartMouse = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isResizingRef.current) return;
    isDockDraggingRef.current = true;
    setIsDockDragging(true);
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
    const nextPreview = getDockPositionFromPoint(e.clientX, e.clientY);
    dockPreviewRef.current = nextPreview;
    setDockPreview(nextPreview);
  };

  const handleDragStartTouch = (e: React.TouchEvent) => {
    e.stopPropagation();
    if (isResizingRef.current) return;
    isDockDraggingRef.current = true;
    setIsDockDragging(true);
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
    const touch = e.touches[0];
    const nextPreview = getDockPositionFromPoint(touch.clientX, touch.clientY);
    dockPreviewRef.current = nextPreview;
    setDockPreview(nextPreview);
  };

  const dragListeners = {
    onMouseDown: handleDragStartMouse,
    onTouchStart: handleDragStartTouch,
  };

  return (
    <SidePanelContext.Provider value={{ dragListeners }}>
      {!isMobile && isDockDragging && dockPreview && (
        <div className="fixed inset-0 z-[80] pointer-events-none">
          <div className="absolute inset-0 bg-black/20" />
          <div
            className="absolute border-2 border-sky-400 bg-sky-500/15 rounded-lg"
            style={getDockPreviewRectStyle(dockPreview)}
          />
        </div>
      )}

      <div
        className={`bg-slate-900 border-slate-700 flex flex-col shadow-2xl z-50 relative ${panelAnimationClass}`}
        style={panelStyle}
      >
        {/* Dock Drag Handle (Desktop only) */}
        {!isMobile && !hideDefaultDragHandle && (
          <button
            type="button"
            className="absolute top-2 left-2 z-[70] h-8 w-8 rounded bg-slate-800/80 border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-700/80 transition-colors flex items-center justify-center cursor-grab active:cursor-grabbing"
            title="Drag to dock (left/right halves or corners)"
            onMouseDown={handleDragStartMouse}
            onTouchStart={handleDragStartTouch}
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
              aria-hidden="true"
            >
              <circle cx="8" cy="7" r="1" />
              <circle cx="8" cy="12" r="1" />
              <circle cx="8" cy="17" r="1" />
              <circle cx="16" cy="7" r="1" />
              <circle cx="16" cy="12" r="1" />
              <circle cx="16" cy="17" r="1" />
            </svg>
          </button>
        )}

        {/* Resizer Handle */}
        {(isMobile || dockPosition === "left" || dockPosition === "right") && (
          <div
            className={`absolute z-50 group hover:bg-sky-500/50 transition-colors
            ${
              isMobile
                ? "top-0 left-0 right-0 h-2 cursor-ns-resize"
                : dockPosition === "left"
                ? "right-0 top-0 bottom-0 w-1 cursor-ew-resize"
                : "left-0 top-0 bottom-0 w-1 cursor-ew-resize"
            }`}
            onMouseDown={(e) => {
              e.preventDefault();
              if (
                !isMobile &&
                !(dockPosition === "left" || dockPosition === "right")
              )
                return;
              isResizingRef.current = true;
              document.body.style.cursor = isMobile ? "ns-resize" : "ew-resize";
            }}
            onTouchStart={() => {
              if (
                !isMobile &&
                !(dockPosition === "left" || dockPosition === "right")
              )
                return;
              isResizingRef.current = true;
            }}
          >
            {/* Visual Indicator */}
            <div
              className={`absolute bg-slate-600/50 group-hover:bg-sky-400 opacity-0 group-hover:opacity-100 transition-all rounded-full
              ${
                isMobile
                  ? "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-1"
                  : dockPosition === "left"
                  ? "right-0 top-1/2 -translate-y-1/2 -mr-1 w-2 h-12"
                  : "left-0 top-1/2 -translate-y-1/2 -ml-1 w-2 h-12"
              }`}
            />
          </div>
        )}

        {children}
      </div>
    </SidePanelContext.Provider>
  );
};

export const SidePanel = React.memo(SidePanelBase);

// Web Content Component for reuse inside the panel
export const WebContent: React.FC<{ url: string; onClose: () => void }> = ({
  url,
  onClose,
}) => {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const isWikipedia = url.includes("wikipedia.org/wiki/");

  useEffect(() => {
    if (isWikipedia) {
      const fetchWiki = async () => {
        setLoading(true);
        setError(false);
        try {
          const title = url.split("/wiki/")[1]?.split("?")[0]?.split("#")[0];
          if (!title) throw new Error("Invalid Wikipedia URL");

          const api = `https://en.wikipedia.org/w/api.php?action=parse&page=${title}&format=json&origin=*&prop=text&mobileformat=1`;
          const res = await fetch(api);
          const data = await res.json();
          if (data.error) throw new Error(data.error.info);

          let html = data.parse?.text?.["*"] || "";
          html = html.replace(
            /href="\/wiki\//g,
            'target="_blank" href="https://en.wikipedia.org/wiki/'
          );
          html = html.replace(/src="\/\//g, 'src="https://');
          setContent(html);
        } catch (e) {
          console.error("Wiki fetch error:", e);
          setError(true);
        } finally {
          setLoading(false);
        }
      };
      fetchWiki();
    } else {
      setContent(null);
    }
  }, [url, isWikipedia]);

  return (
    <div className="flex flex-col h-full w-full">
      <div className="h-14 bg-slate-800 border-b border-slate-700 flex items-center justify-between px-4 shadow-sm shrink-0">
        <div className="flex items-center gap-2 overflow-hidden flex-1 mr-4">
          <span className="text-slate-200 font-bold whitespace-nowrap">
            {isWikipedia ? "Wikipedia Article" : "External Web"}
          </span>
          <span className="text-slate-500 text-xs font-mono truncate border-l border-slate-700 pl-2 ml-2">
            {url}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 text-slate-400 hover:text-sky-400 hover:bg-slate-700 rounded transition-colors"
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
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </a>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-red-400 hover:bg-slate-700 rounded transition-colors"
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
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-hidden bg-white relative">
        {isWikipedia ? (
          loading ? (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-50">
              <div className="flex flex-col items-center gap-3">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sky-600"></div>
                <span className="text-slate-500 text-sm">
                  Loading Article...
                </span>
              </div>
            </div>
          ) : error ? (
            <div className="p-12 text-center text-slate-500 flex flex-col items-center">
              <p>Preview Unavailable</p>
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="mt-4 px-4 py-2 bg-sky-600 text-white rounded"
              >
                Open in New Tab
              </a>
            </div>
          ) : (
            <div className="w-full h-full overflow-y-auto bg-white p-6">
              <div
                className="wiki-content"
                dangerouslySetInnerHTML={{ __html: content || "" }}
              />
            </div>
          )
        ) : (
          <iframe
            src={url}
            className="w-full h-full border-0 bg-white"
            title="External Content"
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
          />
        )}
      </div>
      <style>{`
            .wiki-content { font-family: sans-serif; color: #334155; line-height: 1.6; }
            .wiki-content h1, .wiki-content h2, .wiki-content h3 { font-weight: 700; color: #1e293b; margin-top: 1.5em; margin-bottom: 0.5em; }
            .wiki-content p { margin-bottom: 1em; }
            .wiki-content a { color: #0369a1; text-decoration: none; }
            .wiki-content img { max-width: 100%; height: auto; }
         `}</style>
    </div>
  );
};
