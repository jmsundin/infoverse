
import React from 'react';
import { NODE_COLORS } from '../constants';
import { NodeColor } from '../types';

interface SkeletonGraphProps {
  x: number;
  y: number;
  width?: number;
  height?: number;
}

export const SkeletonGraph: React.FC<SkeletonGraphProps> = ({ x, y, width = 300, height = 200 }) => {
  const cx = x + width / 2;
  const cy = y + height / 2;
  
  // Generate a small tree structure relative to center with tighter distances (max ~80-100px)
  const nodes = [
      { id: 1, dx: 60, dy: -30, r: 35, delay: 0 },
      { id: 2, dx: 70, dy: 15, r: 40, delay: 0.2 },
      { id: 3, dx: 90, dy: -10, r: 30, delay: 0.4 },
      // Sub-nodes
      { id: 4, parent: 2, dx: 110, dy: 25, r: 25, delay: 0.6 },
  ];

  return (
    <g className="pointer-events-none">
      <style>
        {`
          @keyframes growLine {
            from { stroke-dasharray: 0, 1000; }
            to { stroke-dasharray: 1000, 0; }
          }
          @keyframes popNode {
            0% { opacity: 0; transform: scale(0); }
            60% { opacity: 1; transform: scale(1.1); }
            100% { opacity: 1; transform: scale(1); }
          }
        `}
      </style>

      {/* Central Pulse */}
      <circle cx={cx} cy={cy} r={50} className="fill-sky-500/10 animate-ping" />
      <circle cx={cx} cy={cy} r={45} className="stroke-sky-400 stroke-1 fill-none opacity-50" />

      {/* Edges */}
      {nodes.map((n, i) => {
          // Determine parent coords (either center or another node)
          const px = n.parent ? cx + nodes[n.parent-1].dx : cx;
          const py = n.parent ? cy + nodes[n.parent-1].dy : cy;
          const tx = cx + n.dx;
          const ty = cy + n.dy;
          const dist = Math.sqrt(Math.pow(tx-px, 2) + Math.pow(ty-py, 2));

          return (
            <line 
                key={`line-${i}`}
                x1={px} 
                y1={py} 
                x2={tx} 
                y2={ty} 
                stroke="#475569" 
                strokeWidth="2" 
                strokeDasharray={dist}
                strokeDashoffset={dist}
                style={{ 
                    animation: `growLine 0.8s ease-out forwards`, 
                    animationDelay: `${n.delay}s`
                }}
            />
          );
      })}
      
      {/* Nodes */}
      {nodes.map((n, i) => (
        <g key={`node-${i}`} style={{ transformBox: 'fill-box', transformOrigin: 'center', animation: `popNode 0.5s cubic-bezier(0.17, 0.67, 0.83, 0.67) forwards`, animationDelay: `${n.delay + 0.3}s`, opacity: 0 }}>
          <rect 
            x={cx + n.dx - n.r} 
            y={cy + n.dy - n.r * 0.6} 
            width={n.r * 2} 
            height={n.r * 1.2} 
            rx="6" 
            className="fill-slate-800 stroke-slate-600 stroke-1"
          />
          <rect x={cx + n.dx - n.r + 10} y={cy + n.dy - 5} width={n.r * 1.2} height={4} rx="2" className="fill-slate-600/50" />
          <rect x={cx + n.dx - n.r + 10} y={cy + n.dy + 5} width={n.r * 0.8} height={4} rx="2" className="fill-slate-600/50" />
        </g>
      ))}
    </g>
  );
};

export const NodeSkeleton: React.FC<{ 
  x: number; 
  y: number; 
  width: number; 
  height: number; 
  color?: string;
  className?: string;
}> = ({ x, y, width, height, color = 'slate', className = '' }) => {
  const colorTheme = NODE_COLORS[color as NodeColor] || NODE_COLORS['slate'];
  
  return (
    <div
      className={`absolute rounded-xl border flex flex-col overflow-hidden pointer-events-none ${colorTheme.bg} ${colorTheme.border} ${className} shadow-sm opacity-60`}
      style={{
        left: `${x}px`,
        top: `${y}px`,
        width: `${width}px`,
        height: `${height}px`,
      }}
    >
      {/* Header Skeleton */}
      <div className={`h-10 border-b ${colorTheme.border} ${colorTheme.header} flex items-center px-3 gap-2`}>
         <div className="w-6 h-6 rounded bg-black/20 animate-pulse" />
         <div className="h-4 w-2/3 bg-black/20 rounded animate-pulse" />
      </div>
      
      {/* Body Skeleton */}
      <div className="flex-1 p-3 space-y-3">
         <div className="h-3 w-full bg-black/10 rounded animate-pulse delay-75" />
         <div className="h-3 w-5/6 bg-black/10 rounded animate-pulse delay-100" />
         <div className="h-3 w-4/6 bg-black/10 rounded animate-pulse delay-150" />
         <div className="h-20 w-full bg-black/5 rounded mt-4" />
      </div>
    </div>
  );
};
