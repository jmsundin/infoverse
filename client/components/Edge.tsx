import React from 'react';
import { GraphEdge, GraphNode, LODLevel, NodeType, EdgeStyle } from '../types';
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
  highlightToChildren?: boolean;
  isDragging?: boolean;
  edgeStyle?: EdgeStyle;
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

/**
 * Get connection points for Sankey LR layout.
 * Source: Right edge center, Target: Left edge center
 */
const getSankeyConnectionPoints = (
  sourceCenter: { x: number; y: number },
  sourceW: number,
  sourceH: number,
  targetCenter: { x: number; y: number },
  targetW: number,
  targetH: number
): { start: { x: number; y: number }; end: { x: number; y: number } } => {
  return {
    start: { x: sourceCenter.x + sourceW / 2, y: sourceCenter.y },
    end: { x: targetCenter.x - targetW / 2, y: targetCenter.y }
  };
};

/**
 * Generate a Sankey-style S-curve path for horizontal (LR) layout.
 * Uses cubic bezier with horizontal tangents at both endpoints.
 */
const getSankeyPathLR = (
  start: { x: number; y: number },
  end: { x: number; y: number }
): string => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;

  // Handle degenerate case
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
    return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
  }

  // Control point offset (50% of horizontal distance, min 50px)
  const controlOffset = Math.max(Math.abs(dx) * 0.5, 50);

  // Control points create horizontal tangents
  const cp1x = start.x + controlOffset;
  const cp1y = start.y;
  const cp2x = end.x - controlOffset;
  const cp2y = end.y;

  return `M ${start.x} ${start.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${end.x} ${end.y}`;
};

export const Edge: React.FC<EdgeProps> = React.memo(({
    edge,
    sourceNode,
    targetNode,
    lodLevel = 'DETAIL',
    sourceIsParent = false,
    targetIsParent = false,
    sourceIsSelected = false,
    targetIsSelected = false,
    highlightToChildren = false,
    isDragging = false,
    edgeStyle = 'default'
}) => {
  if (!sourceNode || !targetNode) return null;

  // Determine effective width/height based on LOD and Node Role
  // CLUSTER mode: < 0.25 zoom. Nodes are Dots or Text-only Hubs.
  // TITLE mode: 0.25 - 0.5 zoom. Nodes are Header Boxes.
  // DETAIL mode: > 0.5 zoom. Nodes are Full Content.
  const isCluster = lodLevel === 'CLUSTER';
  const isTitle = lodLevel === 'TITLE';
  
  // Dot Size (diameter 24px) for Leaf Nodes in Cluster Mode
  const dotSize = 24; 
  // Hub Nodes in Cluster Mode are text only, effectively 0 size for connection purposes (point to center)
  // or small area. Let's treat them as point connections or small circle.
  const hubSize = 10; 
  // TITLE-mode nodes render a centered title badge; use a smaller effective box so edges touch the badge,
  // not the full (invisible) node container bounds.
  const titleBadgeHeight = 64;
  const titleBadgeMaxWidth = 320;

  let sH = sourceNode.height || 200;
  let tH = targetNode.height || 200;
  let sW = sourceNode.width || 300;
  let tW = targetNode.width || 300;
  
  // Center Positions (Default is center of logical node box)
  let sCx = sourceNode.x + sW / 2;
  let sCy = sourceNode.y + sH / 2;
  let tCx = targetNode.x + tW / 2;
  let tCy = targetNode.y + tH / 2;

  // Handle center-positioned nodes (Clusters and Title-only nodes)
  const sourceIsCentered = sourceNode.type === NodeType.CLUSTER || isTitle || isCluster;
  const targetIsCentered = targetNode.type === NodeType.CLUSTER || isTitle || isCluster;

  if (sourceIsCentered) {
    sCx = sourceNode.x;
    sCy = sourceNode.y;
  }
  if (targetIsCentered) {
    tCx = targetNode.x;
    tCy = targetNode.y;
  }

  // --- Adjust for Cluster Mode ---
  if (isCluster) {
      // Source
      if (sourceIsParent) {
          sW = hubSize;
          sH = hubSize;
      } else {
          sW = dotSize;
          sH = dotSize;
      }

      // Target
      if (targetIsParent) {
          tW = hubSize;
          tH = hubSize;
      } else {
          tW = dotSize;
          tH = dotSize;
      }
  } 
  // --- Adjust for Title Mode ---
  else if (isTitle) {
      // Non-selected nodes in TITLE mode render a centered title badge; use that size for intersection.
      // Selected nodes can still be expanded, so keep full bounds for selected.
      if (!sourceIsSelected) {
          sW = Math.min(sW, titleBadgeMaxWidth);
          sH = titleBadgeHeight;
      }
      if (!targetIsSelected) {
          tW = Math.min(tW, titleBadgeMaxWidth);
          tH = titleBadgeHeight;
      }
  }
  // --- Adjust for Detail Mode (Compact vs Full) ---
  else {
      // Compact check (collapsed)
      // GraphNode: isCompact = !isSidebar && lodLevel === "DETAIL" && !isClusterParent && !isSelected;
      // If compact, height is HEADER_HEIGHT.
      // Note: Edge component doesn't know if GraphNode decided to be compact.
      // We replicate logic:
      const sourceCompact = !sourceIsSelected;
      const targetCompact = !targetIsSelected;

      if (sourceCompact) {
          sH = NODE_HEADER_HEIGHT;
          sCy = sourceNode.y + sH / 2;
      }
      if (targetCompact) {
          tH = NODE_HEADER_HEIGHT;
          tCy = targetNode.y + tH / 2;
      }
  }

  // Calculate connection points and path based on edge style
  let start: { x: number; y: number };
  let end: { x: number; y: number };
  let pathD: string;
  let labelX: number;
  let labelY: number;

  if (edgeStyle === 'sankey-lr') {
    // Sankey style: connect at horizontal sides with S-curve
    const points = getSankeyConnectionPoints(
      { x: sCx, y: sCy }, sW, sH,
      { x: tCx, y: tCy }, tW, tH
    );
    start = points.start;
    end = points.end;
    pathD = getSankeyPathLR(start, end);

    // Label position: cubic bezier midpoint at t=0.5
    const dx = end.x - start.x;
    const controlOffset = Math.max(Math.abs(dx) * 0.5, 50);
    const cp1 = { x: start.x + controlOffset, y: start.y };
    const cp2 = { x: end.x - controlOffset, y: end.y };
    labelX = 0.125 * start.x + 0.375 * cp1.x + 0.375 * cp2.x + 0.125 * end.x;
    labelY = 0.125 * start.y + 0.375 * cp1.y + 0.375 * cp2.y + 0.125 * end.y;
  } else {
    // Default style: box intersection with quadratic bezier
    start = getBoxIntersection({ x: sCx, y: sCy }, sW, sH, { x: tCx, y: tCy });
    end = getBoxIntersection({ x: tCx, y: tCy }, tW, tH, { x: sCx, y: sCy });

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

    pathD = curvature === 0
      ? `M ${start.x} ${start.y} L ${end.x} ${end.y}`
      : `M ${start.x} ${start.y} Q ${cpX} ${cpY} ${end.x} ${end.y}`;

    labelX = curvature === 0
      ? midX
      : 0.25 * start.x + 0.5 * cpX + 0.25 * end.x;

    labelY = curvature === 0
      ? midY
      : 0.25 * start.y + 0.5 * cpY + 0.25 * end.y;
  }

  // Safety check for invalid coordinates (for sankey path too)
  if (!start || !end || isNaN(start.x) || isNaN(start.y) || isNaN(end.x) || isNaN(end.y)) {
    return null;
  }

  const isHighlighted = highlightToChildren;
  const isMediumHighlight = sourceIsSelected && !targetIsSelected && !highlightToChildren;
  
  const strokeColor = isHighlighted 
    ? COLORS.activeEdgeStroke 
    : isMediumHighlight 
      ? COLORS.activeEdgeStroke // Or a lighter shade if available in COLORS, but usually opacity handles 'medium' feel or width
      : COLORS.edgeStroke;
      
  const strokeWidth = isHighlighted ? 3 : isMediumHighlight ? 2.5 : 2;
  const opacity = isMediumHighlight ? 0.6 : 1;
  const markerId = isHighlighted || isMediumHighlight ? "arrowhead-active" : "arrowhead";

  return (
    <g
      className={`group pointer-events-auto ${isDragging ? '' : 'transition-opacity duration-200'}`}
      style={{ opacity }}
    >
      <path
        d={pathD}
        fill="none"
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        vectorEffect="non-scaling-stroke"
        markerEnd={`url(#${markerId})`}
        className={`edge-path ${isDragging ? '' : 'transition-colors duration-300'} group-hover:stroke-sky-400 group-hover:stroke-[3px]`}
      />
      
      {/* Relationship Label Badge - Hide when zoom is low/title only to reduce clutter */}
      {edge.label && !isTitle && (
        <foreignObject x={labelX - 50} y={labelY - 12} width={100} height={24} className="overflow-visible pointer-events-none">
          <div className="flex items-center justify-center">
            <span
              className="bg-slate-900 text-slate-300 text-[10px] px-1.5 py-0.5 rounded border border-slate-700 shadow-sm whitespace-nowrap group-hover:border-sky-400 group-hover:text-sky-400 transition-colors pointer-events-auto"
              style={
                isHighlighted
                  ? {
                      borderColor: COLORS.activeEdgeStroke,
                      color: COLORS.activeEdgeStroke,
                    }
                  : undefined
              }
            >
              {edge.label}
            </span>
          </div>
        </foreignObject>
      )}
    </g>
  );
}, (prevProps, nextProps) => {
  // Custom comparison - only re-render if positions or relevant states change
  return (
    prevProps.sourceNode.x === nextProps.sourceNode.x &&
    prevProps.sourceNode.y === nextProps.sourceNode.y &&
    prevProps.sourceNode.width === nextProps.sourceNode.width &&
    prevProps.sourceNode.height === nextProps.sourceNode.height &&
    prevProps.targetNode.x === nextProps.targetNode.x &&
    prevProps.targetNode.y === nextProps.targetNode.y &&
    prevProps.targetNode.width === nextProps.targetNode.width &&
    prevProps.targetNode.height === nextProps.targetNode.height &&
    prevProps.sourceIsSelected === nextProps.sourceIsSelected &&
    prevProps.targetIsSelected === nextProps.targetIsSelected &&
    prevProps.sourceIsParent === nextProps.sourceIsParent &&
    prevProps.targetIsParent === nextProps.targetIsParent &&
    prevProps.lodLevel === nextProps.lodLevel &&
    prevProps.isDragging === nextProps.isDragging &&
    prevProps.highlightToChildren === nextProps.highlightToChildren &&
    prevProps.edge.label === nextProps.edge.label &&
    prevProps.edgeStyle === nextProps.edgeStyle
  );
});