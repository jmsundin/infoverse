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
  matchingNodeIds: Set<string>;
}

export const useOutlineTree = (
  nodes: GraphNode[],
  selectedNodeIds: Set<string>,
  currentScopeId: string | null,
  searchTerm: string = ""
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

    // Filter nodes based on search term
    const matchingNodeIds = new Set<string>();
    const ancestorIdsToInclude = new Set<string>();
    const isFiltering = searchTerm.trim().length > 0;

    if (isFiltering) {
      const lowerTerm = searchTerm.toLowerCase();
      const terms = lowerTerm.split(/\s+/).filter((t) => t.length > 0);

      // Find all matching nodes
      nodes.forEach((node) => {
        const content = (node.content || "").toLowerCase();
        const summary = (node.summary || "").toLowerCase();
        const title = (node.title || "").toLowerCase();
        const aliases = (node.aliases || []).join(" ").toLowerCase();
        const searchableText = `${content} ${summary} ${title} ${aliases}`;

        const matches = terms.every((term) => searchableText.includes(term));
        if (matches) {
          matchingNodeIds.add(node.id);

          // Add all ancestors to keep hierarchy visible
          let current: GraphNode | undefined = node;
          while (current?.parentId) {
            ancestorIdsToInclude.add(current.parentId);
            current = nodeMap.get(current.parentId);
          }
        }
      });
    }

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

      // When filtering, skip nodes that don't match and aren't ancestors of matches
      if (
        isFiltering &&
        !matchingNodeIds.has(nodeId) &&
        !ancestorIdsToInclude.has(nodeId)
      ) {
        return null;
      }

      let childNodes = childrenByParent.get(nodeId) || [];

      // When filtering, only include children that are matches or ancestors of matches
      if (isFiltering) {
        childNodes = childNodes.filter(
          (c) => matchingNodeIds.has(c.id) || ancestorIdsToInclude.has(c.id)
        );
      }

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

    // When filtering, also filter root nodes
    const filteredRootNodes = isFiltering
      ? rootNodes.filter(
          (n) => matchingNodeIds.has(n.id) || ancestorIdsToInclude.has(n.id)
        )
      : rootNodes;

    const tree: TreeNodeData[] = filteredRootNodes
      .map((n) => buildSubtree(n.id, 0))
      .filter(Boolean) as TreeNodeData[];

    return { ancestors, tree, selectedNode, matchingNodeIds };
  }, [nodes, selectedNodeIds, currentScopeId, searchTerm]);
};
