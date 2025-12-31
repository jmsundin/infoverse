import React from "react";
import { GraphNode } from "../types";

interface ScopeIndicatorProps {
  currentScopeId: string | null;
  nodes: GraphNode[];
}

export const ScopeIndicator: React.FC<ScopeIndicatorProps> = ({
  currentScopeId,
  nodes,
}) => {
  if (!currentScopeId) return null;

  const scopeNode = nodes.find((n) => n.id === currentScopeId);
  if (!scopeNode) return null;

  return (
    <div className="absolute inset-0 border-[20px] border-slate-800/50 pointer-events-none z-30 flex items-center justify-center">
      <div className="absolute bottom-4 text-slate-700 font-bold text-4xl uppercase opacity-20 pointer-events-none select-none">
        {scopeNode.content}
      </div>
    </div>
  );
};

