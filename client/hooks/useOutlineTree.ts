import { useMemo } from "react";
import { GraphNode } from "../types";

export interface TreeNodeData {
  node: GraphNode;
  children: TreeNodeData[];
  depth: number;
}

export interface OutlineTreeResult {
  ancestors: GraphNode[];
  tree: TreeNodeData[];
  selectedNode: GraphNode | null;
}

export const useOutlineTree = (
  nodes: GraphNode[],
  selectedNodeIds: Set<string>,
  currentScopeId: string | null
): OutlineTreeResult => {
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

    // Recursive function to build subtree
    const buildSubtree = (
      nodeId: string,
      depth: number,
      visited: Set<string> = new Set()
    ): TreeNodeData | null => {
      // Guard against circular references
      if (visited.has(nodeId)) return null;
      visited.add(nodeId);

      const node = nodeMap.get(nodeId);
      if (!node) return null;

      const children = childrenByParent.get(nodeId) || [];
      return {
        node,
        depth,
        children: children
          .map((c) => buildSubtree(c.id, depth + 1, new Set(visited)))
          .filter(Boolean) as TreeNodeData[],
      };
    };

    // Get ancestors (up to 2 levels)
    const getAncestors = (nodeId: string): GraphNode[] => {
      const ancestors: GraphNode[] = [];
      const visited = new Set<string>();
      let current = nodeMap.get(nodeId);

      while (current?.parentId && ancestors.length < 2) {
        // Guard against circular references
        if (visited.has(current.parentId)) break;
        visited.add(current.parentId);

        const parent = nodeMap.get(current.parentId);
        if (parent) ancestors.unshift(parent);
        current = parent;
      }
      return ancestors;
    };

    // Get the first selected node (if any)
    const selectedId =
      selectedNodeIds.size > 0 ? Array.from(selectedNodeIds)[0] : null;
    const selectedNode = selectedId ? nodeMap.get(selectedId) ?? null : null;

    if (selectedNode) {
      // MODE: Node selected
      // Get ancestors (up to 2 levels)
      const ancestors = getAncestors(selectedNode.id);

      // Get siblings (nodes with same parentId as selected)
      const siblingParentId = selectedNode.parentId ?? null;
      const siblings = childrenByParent.get(siblingParentId) || [];

      // Build tree: siblings at root, with selected node's subtree expanded
      const tree: TreeNodeData[] = siblings
        .map((sibling) => {
          if (sibling.id === selectedNode.id) {
            // Full subtree for selected node
            return buildSubtree(sibling.id, 0);
          } else {
            // Just the sibling node (children can be expanded by user)
            return buildSubtree(sibling.id, 0);
          }
        })
        .filter(Boolean) as TreeNodeData[];

      return { ancestors, tree, selectedNode };
    } else {
      // MODE: No selection - show all in current scope
      const rootNodes = childrenByParent.get(currentScopeId ?? null) || [];
      const tree: TreeNodeData[] = rootNodes
        .map((n) => buildSubtree(n.id, 0))
        .filter(Boolean) as TreeNodeData[];
      return { ancestors: [], tree, selectedNode: null };
    }
  }, [nodes, selectedNodeIds, currentScopeId]);
};
