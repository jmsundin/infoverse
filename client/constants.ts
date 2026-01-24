import { PhysicsConfig } from './types';

export const DEFAULT_NODE_WIDTH = 400;
export const DEFAULT_NODE_HEIGHT = 300;
export const PARENT_NODE_WIDTH = 400;
export const PARENT_NODE_HEIGHT = 300;
export const MIN_NODE_WIDTH = 250;
export const MIN_NODE_HEIGHT = 180;
export const NODE_HEADER_HEIGHT = 40;
export const MOBILE_NODE_WIDTH = 280;
export const MOBILE_NODE_TITLE_PADDING = 48;  // px-4*2 + borders + buffer for dynamic width
export const MOBILE_NODE_MAX_WIDTH = 350;     // Maximum width for mobile nodes

export const GEMINI_MODEL_FAST = "gemini-2.5-flash";

// Node Color Themes (Dark Mode) - Opaque backgrounds to hide canvas dots
export const NODE_COLORS = {
  slate: {
    bg: "bg-slate-800",
    border: "border-slate-600",
    header: "bg-slate-900",
    text: "text-slate-200",
    indicator: "bg-slate-500",
  },
  red: {
    bg: "bg-red-950",
    border: "border-red-800",
    header: "bg-red-900",
    text: "text-red-100",
    indicator: "bg-red-500",
  },
  green: {
    bg: "bg-emerald-950",
    border: "border-emerald-800",
    header: "bg-emerald-900",
    text: "text-emerald-100",
    indicator: "bg-emerald-500",
  },
  blue: {
    bg: "bg-blue-950",
    border: "border-blue-800",
    header: "bg-blue-900",
    text: "text-blue-100",
    indicator: "bg-blue-500",
  },
  amber: {
    bg: "bg-amber-950",
    border: "border-amber-800",
    header: "bg-amber-900",
    text: "text-amber-100",
    indicator: "bg-amber-500",
  },
  purple: {
    bg: "bg-purple-950",
    border: "border-purple-800",
    header: "bg-purple-900",
    text: "text-purple-100",
    indicator: "bg-purple-500",
  },
};

// For Edges
export const COLORS = {
  edgeStroke: "#475569", // Slate 600
  activeEdgeStroke: "#38bdf8", // Sky 400
};

export const WIKIDATA_SUBTOPIC_LIMIT = 12;
export const WIKIDATA_MAX_RECURSIVE_NODES_PER_LEVEL = 5;

// Physics simulation defaults
export const DEFAULT_PHYSICS_CONFIG: PhysicsConfig = {
  physicsEnabled: true,           // Physics simulation enabled by default
  collisionOnly: true,            // Only resolve overlaps, no springs/gravity/repulsion
  springConstant: 0,              // Disabled in collision-only mode
  springLength: 200,              // Ideal edge length in pixels (unused in collision-only)
  springDamping: 0.09,            // Spring force damping (unused in collision-only)
  gravityConstant: 0,             // Disabled in collision-only mode
  subtreeRepulsionConstant: 0,    // Disabled in collision-only mode
  collisionPadding: 20,           // Extra padding for collision detection
  childFollowTightness: 0.3,      // Unused in collision-only mode (rigid subtree instead)
  velocityThreshold: 0.5,         // Stabilization threshold (pixels/tick)
  maxIterations: 300,             // Safety limit on simulation ticks
  dampingFactor: 0.85,            // Velocity decay per tick
};
