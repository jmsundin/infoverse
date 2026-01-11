import { useMemo } from "react";
import { GraphNode } from "../types";

export interface OutlineViewResult {
  peers: GraphNode[];
  children: GraphNode[];
  selectedNode: GraphNode | null;
}

export const useOutlineView = (
  nodes: GraphNode[],
  selectedNodeIds: Set<string>,
  currentScopeId: string | null
): OutlineViewResult => {
  return useMemo(() => {
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    // Build children lookup (parentId -> children[])
    const childrenByParent = new Map<string | null, GraphNode[]>();
    nodes.forEach((node) => {
      const parentKey = node.parentId ?? null;
      const children = childrenByParent.get(parentKey) || [];
      children.push(node);
      childrenByParent.set(parentKey, children);
    });

    // Get the first selected node (if any)
    const selectedId =
      selectedNodeIds.size > 0 ? Array.from(selectedNodeIds)[0] : null;
    const selectedNode = selectedId ? nodeMap.get(selectedId) ?? null : null;

    if (selectedNode) {
      // Get peers (nodes with same parentId as selected)
      const siblingParentId = selectedNode.parentId ?? null;
      const peers = childrenByParent.get(siblingParentId) || [];

      // Get children of selected node
      const children = childrenByParent.get(selectedNode.id) || [];

      return { peers, children, selectedNode };
    } else {
      // No selection - show root level nodes in current scope as peers
      const peers = childrenByParent.get(currentScopeId ?? null) || [];
      return { peers, children: [], selectedNode: null };
    }
  }, [nodes, selectedNodeIds, currentScopeId]);
};
