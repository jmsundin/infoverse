import { useMemo } from "react";
import { GraphNode } from "../types";

export interface TreeNodeData {
  node: GraphNode;
  children: TreeNodeData[];
  depth: number;
  hasChildren: boolean;
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
      // Use parentId for tree hierarchy, fall back to null for roots
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

      const childNodes = childrenByParent.get(nodeId) || [];
      return {
        node,
        depth,
        hasChildren: childNodes.length > 0,
        children: childNodes
          .map((c) => buildSubtree(c.id, depth + 1, new Set(visited)))
          .filter(Boolean) as TreeNodeData[],
      };
    };

    // Get ancestors (up to 2 levels) using parentId
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

    // Get ancestors if there's a selected node
    const ancestors = selectedNode ? getAncestors(selectedNode.id) : [];

    // Always build full tree from root nodes in current scope
    const rootNodes = childrenByParent.get(currentScopeId ?? null) || [];
    const tree: TreeNodeData[] = rootNodes
      .map((n) => buildSubtree(n.id, 0))
      .filter(Boolean) as TreeNodeData[];

    return { ancestors, tree, selectedNode };
  }, [nodes, selectedNodeIds, currentScopeId]);
};
