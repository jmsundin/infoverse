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
  searchTerm: string = "",
  viewportNodeIds?: Set<string>,
  filterToViewport: boolean = false
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

    // Viewport filtering: find ancestors of viewport nodes to preserve tree structure
    const viewportAncestorIds = new Set<string>();
    const isViewportFiltering = filterToViewport && viewportNodeIds && viewportNodeIds.size > 0;

    if (isViewportFiltering) {
      viewportNodeIds.forEach((nodeId) => {
        let current = nodeMap.get(nodeId);
        while (current?.parentId) {
          viewportAncestorIds.add(current.parentId);
          current = nodeMap.get(current.parentId);
        }
      });
    }

    if (isFiltering) {
      const lowerTerm = searchTerm.toLowerCase();
      const terms = lowerTerm.split(/\s+/).filter((t) => t.length > 0);

      // Find all matching nodes
      nodes.forEach((node) => {
        const content = (node.content || "").toLowerCase();
        const summary = (node.summary || "").toLowerCase();
        const title = (node.title || "").toLowerCase();
        const aliases = (node.aliases || []).join(" ").toLowerCase();
        const messages = (node.messages || []).map(m => m.text).join(" ").toLowerCase();
        const searchableText = `${content} ${summary} ${title} ${aliases} ${messages}`;

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

      // When search filtering, skip nodes that don't match and aren't ancestors of matches
      if (
        isFiltering &&
        !matchingNodeIds.has(nodeId) &&
        !ancestorIdsToInclude.has(nodeId)
      ) {
        return null;
      }

      // When viewport filtering, skip nodes not in viewport and not ancestors of viewport nodes
      if (
        isViewportFiltering &&
        !viewportNodeIds!.has(nodeId) &&
        !viewportAncestorIds.has(nodeId)
      ) {
        return null;
      }

      let childNodes = childrenByParent.get(nodeId) || [];

      // When search filtering, only include children that are matches or ancestors of matches
      if (isFiltering) {
        childNodes = childNodes.filter(
          (c) => matchingNodeIds.has(c.id) || ancestorIdsToInclude.has(c.id)
        );
      }

      // When viewport filtering, only include children that are in viewport or ancestors
      if (isViewportFiltering) {
        childNodes = childNodes.filter(
          (c) => viewportNodeIds!.has(c.id) || viewportAncestorIds.has(c.id)
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

    // Get nodes in current scope
    let rootNodes = childrenByParent.get(currentScopeId ?? null) || [];

    // Fall back to global index (all root-level nodes) if current scope is empty
    if (rootNodes.length === 0 && currentScopeId !== null) {
      rootNodes = childrenByParent.get(null) || [];
    }

    // Apply search filtering to root nodes
    let filteredRootNodes = isFiltering
      ? rootNodes.filter(
          (n) => matchingNodeIds.has(n.id) || ancestorIdsToInclude.has(n.id)
        )
      : rootNodes;

    // Apply viewport filtering to root nodes
    if (isViewportFiltering) {
      filteredRootNodes = filteredRootNodes.filter(
        (n) => viewportNodeIds!.has(n.id) || viewportAncestorIds.has(n.id)
      );
    }

    const tree: TreeNodeData[] = filteredRootNodes
      .map((n) => buildSubtree(n.id, 0))
      .filter(Boolean) as TreeNodeData[];

    return { ancestors, tree, selectedNode, matchingNodeIds };
  }, [nodes, selectedNodeIds, currentScopeId, searchTerm, viewportNodeIds, filterToViewport]);
};
