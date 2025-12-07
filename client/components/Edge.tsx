import React from 'react';
import { GraphEdge, GraphNode, LODLevel } from '../types';
import { COLORS, NODE_HEADER_HEIGHT } from '../constants';

interface EdgeProps {
  edge: GraphEdge;
  sourceNode: GraphNode;
  targetNode: GraphNode;
  lodLevel?: LODLevel;
  sourceIsParent?: boolean;
  targetIsParent?: boolean;
  sourceIsSelected?: boolean;
  targetIsSelected?: boolean;
}

// Helper to find intersection of line from center to target with box
const getBoxIntersection = (
  center: { x: number; y: number },
  w: number,
  h: number,
  target: { x: number; y: number }
) => {
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  if (dx === 0 && dy === 0) return center;

  const slope = dy / dx;
  const absSlope = Math.abs(slope);

  // Box dimensions relative to center
  const hw = w / 2;
  const hh = h / 2;

  // Box ratio slope
  const boxSlope = hh / hw;

  let x, y;

  if (absSlope <= boxSlope) {
    // Intersects vertical sides
    x = dx > 0 ? hw : -hw;
    y = x * slope;
  } else {
    // Intersects horizontal sides
    y = dy > 0 ? hh : -hh;
    x = y / slope;
  }

  const padding = 0; 
  return { 
    x: center.x + x + (dx > 0 ? padding : -padding), 
    y: center.y + y + (dy > 0 ? padding : -padding)
  };
};

export const Edge: React.FC<EdgeProps> = ({ 
    edge, 
    sourceNode, 
    targetNode, 
    lodLevel = 'DETAIL',
    sourceIsParent = false,
    targetIsParent = false,
    sourceIsSelected = false,
    targetIsSelected = false
}) => {
  if (!sourceNode || !targetNode) return null;

  // Determine effective width/height based on LOD and Node Role
  const isTitleOnly = lodLevel === 'TITLE';
  
  // Dot Size (approx diameter 24px + border/shadow)
  const dotSize = 24; 

  let sH = sourceNode.height || 200;
  let tH = targetNode.height || 200;

  // Adjust Height for Compact View (Detail level but not parent/selected)
  if (lodLevel === 'DETAIL') {
      if (!sourceIsParent && !sourceIsSelected) sH = NODE_HEADER_HEIGHT;
      if (!targetIsParent && !targetIsSelected) tH = NODE_HEADER_HEIGHT;
  }

  // Calculate widths and adjust heights for TITLE mode (Dots/Labels)
  // If selected, we assume the node expands to full box even in TITLE mode
  const sourceIsDot = isTitleOnly && !sourceIsParent && !sourceIsSelected;
  const targetIsDot = isTitleOnly && !targetIsParent && !targetIsSelected;

  const sW = sourceIsDot ? dotSize : (sourceNode.width || 300);
  if (sourceIsDot) sH = dotSize;
  
  const tW = targetIsDot ? dotSize : (targetNode.width || 300);
  if (targetIsDot) tH = dotSize;

  // Centers need to be adjusted if visual height changes from logical height (node.y is top)
  const sCx = sourceNode.x + (sourceNode.width || 300) / 2;
  const sCy = sourceNode.y + sH / 2;
  
  const tCx = targetNode.x + (targetNode.width || 300) / 2;
  const tCy = targetNode.y + tH / 2;

  // Calculate intersection points on the node boundaries
  const start = getBoxIntersection({ x: sCx, y: sCy }, sW, sH, { x: tCx, y: tCy });
  const end = getBoxIntersection({ x: tCx, y: tCy }, tW, tH, { x: sCx, y: sCy });

  // Safety check for invalid coordinates
  if (!start || !end || isNaN(start.x) || isNaN(start.y) || isNaN(end.x) || isNaN(end.y)) {
    return null;
  }

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  
  // Midpoint
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;
  
  // Curvature Logic
  let curvature = 0;
  const HORIZONTAL_THRESHOLD = 50; 

  if (Math.abs(dy) < HORIZONTAL_THRESHOLD) {
      curvature = 0; 
  } else if (dy > 0) {
      curvature = dx > 0 ? 0.2 : -0.2;
      if (Math.abs(dx) < 10) curvature = 0.2;
  } else {
      curvature = dx > 0 ? -0.2 : 0.2;
      if (Math.abs(dx) < 10) curvature = 0.2;
  }

  const cpX = midX - dy * curvature; 
  const cpY = midY + dx * curvature;

  const pathD = curvature === 0 
    ? `M ${start.x} ${start.y} L ${end.x} ${end.y}`
    : `M ${start.x} ${start.y} Q ${cpX} ${cpY} ${end.x} ${end.y}`;

  const labelX = curvature === 0 
    ? midX 
    : 0.25 * start.x + 0.5 * cpX + 0.25 * end.x;
    
  const labelY = curvature === 0 
    ? midY 
    : 0.25 * start.y + 0.5 * cpY + 0.25 * end.y;

  return (
    <g className="group pointer-events-auto">
      <path
        d={pathD}
        fill="none"
        stroke={COLORS.edgeStroke}
        strokeWidth="2"
        className="edge-path transition-all duration-300 group-hover:stroke-sky-400 group-hover:stroke-[3px]"
      />
      
      {/* Relationship Label Badge - Hide when zoom is low/title only to reduce clutter */}
      {edge.label && !isTitleOnly && (
        <foreignObject x={labelX - 50} y={labelY - 12} width={100} height={24} className="overflow-visible pointer-events-none">
          <div className="flex items-center justify-center">
            <span className="bg-slate-900 text-slate-300 text-[10px] px-1.5 py-0.5 rounded border border-slate-700 shadow-sm whitespace-nowrap group-hover:border-sky-400 group-hover:text-sky-400 transition-colors pointer-events-auto">
              {edge.label}
            </span>
          </div>
        </foreignObject>
      )}
    </g>
  );
};