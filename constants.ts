export const DEFAULT_NODE_WIDTH = 300;
export const DEFAULT_NODE_HEIGHT = 200;
export const MIN_NODE_WIDTH = 250;
export const MIN_NODE_HEIGHT = 180;
export const NODE_HEADER_HEIGHT = 40;

export const GEMINI_MODEL_FAST = 'gemini-2.5-flash';

// Node Color Themes (Dark Mode) - Opaque backgrounds to hide canvas dots
export const NODE_COLORS = {
  slate: { 
    bg: 'bg-slate-800', 
    border: 'border-slate-600', 
    header: 'bg-slate-900', 
    text: 'text-slate-200',
    indicator: 'bg-slate-500'
  },
  red: { 
    bg: 'bg-red-950', 
    border: 'border-red-800', 
    header: 'bg-red-900', 
    text: 'text-red-100',
    indicator: 'bg-red-500'
  },
  green: { 
    bg: 'bg-emerald-950', 
    border: 'border-emerald-800', 
    header: 'bg-emerald-900', 
    text: 'text-emerald-100',
    indicator: 'bg-emerald-500'
  },
  blue: { 
    bg: 'bg-blue-950', 
    border: 'border-blue-800', 
    header: 'bg-blue-900', 
    text: 'text-blue-100',
    indicator: 'bg-blue-500'
  },
  amber: { 
    bg: 'bg-amber-950', 
    border: 'border-amber-800', 
    header: 'bg-amber-900', 
    text: 'text-amber-100',
    indicator: 'bg-amber-500'
  },
  purple: { 
    bg: 'bg-purple-950', 
    border: 'border-purple-800', 
    header: 'bg-purple-900', 
    text: 'text-purple-100',
    indicator: 'bg-purple-500'
  },
};

// For Edges
export const COLORS = {
  edgeStroke: '#64748b', // Slate 500
  activeEdgeStroke: '#38bdf8', // Sky 400
};