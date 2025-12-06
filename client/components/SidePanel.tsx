
import React, { useEffect, useState, useRef } from 'react';

interface SidePanelProps {
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
  initialWidthPercent?: number;
}

export const SidePanel: React.FC<SidePanelProps> = ({ onClose, children, title, initialWidthPercent = 50 }) => {
  // dimension represents Width % on Desktop, Height % on Mobile
  const [dimension, setDimension] = useState(initialWidthPercent);
  const [isMobile, setIsMobile] = useState(false);
  const isResizingRef = useRef(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    const handleMove = (e: MouseEvent | TouchEvent) => {
      if (!isResizingRef.current) return;
      
      const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : (e as MouseEvent).clientY;

      if (isMobile) {
        // Mobile: Resize Height (Top Edge)
        // Height is distance from bottom. clientY is distance from top.
        // New Height = Window Height - Mouse Y
        const newHeightPercent = ((window.innerHeight - clientY) / window.innerHeight) * 100;
        setDimension(Math.max(30, Math.min(90, newHeightPercent)));
      } else {
        // Desktop: Resize Width (Left Edge)
        // Width is distance from right. clientX is distance from left.
        // New Width = Window Width - Mouse X
        const newWidthPercent = ((window.innerWidth - clientX) / window.innerWidth) * 100;
        setDimension(Math.max(20, Math.min(80, newWidthPercent)));
      }
    };

    const handleEnd = () => {
      isResizingRef.current = false;
      document.body.style.cursor = '';
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('touchmove', handleMove, { passive: false });
    document.addEventListener('mouseup', handleEnd);
    document.addEventListener('touchend', handleEnd);
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('touchmove', handleMove);
      document.removeEventListener('mouseup', handleEnd);
      document.removeEventListener('touchend', handleEnd);
    };
  }, [isMobile]);

  const panelStyle: React.CSSProperties = isMobile ? {
      height: `${dimension}%`,
      width: '100%',
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      borderTopWidth: '1px',
      borderLeftWidth: '0px'
  } : {
      width: `${dimension}%`,
      height: '100%',
      minWidth: '320px',
      borderLeftWidth: '1px',
      borderTopWidth: '0px'
  };

  return (
    <div 
      className="bg-slate-900 border-slate-700 flex flex-col shadow-2xl z-50 relative"
      style={panelStyle}
    >
      {/* Resizer Handle */}
      <div 
        className={`absolute z-50 group hover:bg-sky-500/50 transition-colors
            ${isMobile 
                ? 'top-0 left-0 right-0 h-2 cursor-ns-resize' 
                : 'left-0 top-0 bottom-0 w-1 cursor-ew-resize'
            }`}
        onMouseDown={(e) => {
           e.preventDefault();
           isResizingRef.current = true;
           document.body.style.cursor = isMobile ? 'ns-resize' : 'ew-resize';
        }}
        onTouchStart={(e) => {
            // Prevent default to stop scrolling while resizing
            isResizingRef.current = true;
        }}
      >
          {/* Visual Indicator */}
          <div className={`absolute bg-slate-600/50 group-hover:bg-sky-400 opacity-0 group-hover:opacity-100 transition-all rounded-full
              ${isMobile 
                ? 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-1' 
                : 'left-0 top-1/2 -translate-y-1/2 -ml-1 w-2 h-12'
              }`} 
          />
      </div>

      {children}
    </div>
  );
};

// Web Content Component for reuse inside the panel
export const WebContent: React.FC<{ url: string; onClose: () => void }> = ({ url, onClose }) => {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const isWikipedia = url.includes('wikipedia.org/wiki/');

  useEffect(() => {
    if (isWikipedia) {
      const fetchWiki = async () => {
        setLoading(true);
        setError(false);
        try {
          const title = url.split('/wiki/')[1]?.split('?')[0]?.split('#')[0];
          if (!title) throw new Error("Invalid Wikipedia URL");

          const api = `https://en.wikipedia.org/w/api.php?action=parse&page=${title}&format=json&origin=*&prop=text&mobileformat=1`;
          const res = await fetch(api);
          const data = await res.json();
          if (data.error) throw new Error(data.error.info);
          
          let html = data.parse?.text?.['*'] || '';
          html = html.replace(/href="\/wiki\//g, 'target="_blank" href="https://en.wikipedia.org/wiki/');
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
                  {isWikipedia ? 'Wikipedia Article' : 'External Web'}
                </span>
                <span className="text-slate-500 text-xs font-mono truncate border-l border-slate-700 pl-2 ml-2">
                  {url}
                </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
                <a href={url} target="_blank" rel="noopener noreferrer" className="p-2 text-slate-400 hover:text-sky-400 hover:bg-slate-700 rounded transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                </a>
                <button onClick={onClose} className="p-2 text-slate-400 hover:text-red-400 hover:bg-slate-700 rounded transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>
         </div>
         <div className="flex-1 overflow-hidden bg-white relative">
            {isWikipedia ? (
                loading ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-slate-50">
                        <div className="flex flex-col items-center gap-3">
                           <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sky-600"></div>
                           <span className="text-slate-500 text-sm">Loading Article...</span>
                        </div>
                    </div>
                ) : error ? (
                     <div className="p-12 text-center text-slate-500 flex flex-col items-center">
                        <p>Preview Unavailable</p>
                        <a href={url} target="_blank" rel="noreferrer" className="mt-4 px-4 py-2 bg-sky-600 text-white rounded">Open in New Tab</a>
                     </div>
                ) : (
                    <div className="w-full h-full overflow-y-auto bg-white p-6">
                        <div className="wiki-content" dangerouslySetInnerHTML={{ __html: content || '' }} />
                    </div>
                )
            ) : (
                <iframe src={url} className="w-full h-full border-0 bg-white" title="External Content" sandbox="allow-scripts allow-same-origin allow-popups allow-forms" />
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
