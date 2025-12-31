import { useMemo } from "react";
import { GraphNode, GraphEdge } from "../types";
import { getNodeTitleForBreadcrumb } from "../utils/graphUtils";

export const useBreadcrumbs = (
  nodes: GraphNode[],
  edges: GraphEdge[],
  currentScopeId: string | null,
  selectedNodeIds: Set<string>,
  dirName: string | null
) => {
  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const breadcrumbs = useMemo(() => {
    const rootName = dirName || "Home";
    type Breadcrumb = {
      id: string | null;
      name: string;
      type: "root" | "scope" | "node";
    };
    const crumbs: Breadcrumb[] = [];
    const seenIds = new Set<string | null>();

    const pushCrumb = (crumb: Breadcrumb) => {
      const key = crumb.id ?? null;
      if (seenIds.has(key)) return;
      crumbs.push(crumb);
      seenIds.add(key);
    };

    pushCrumb({ id: null, name: rootName, type: "root" });

    const activeId =
      selectedNodeIds.size > 0 ? Array.from(selectedNodeIds)[0] : null;
    const activeNode = activeId ? nodeMap.get(activeId) : null;
    const activeScopeId = activeNode
      ? activeNode.parentId ?? null
      : currentScopeId ?? null;
    const scopeNode = activeScopeId ? nodeMap.get(activeScopeId) : null;

    const appendScopeAncestors = (node?: GraphNode | null) => {
      if (!node) return;
      const stack: GraphNode[] = [];
      const visited = new Set<string>();
      let current: GraphNode | undefined | null = node;
      while (current?.parentId) {
        if (visited.has(current.parentId)) break;
        const parent = nodeMap.get(current.parentId);
        if (!parent) break;
        stack.unshift(parent);
        visited.add(parent.id);
        current = parent;
      }
      stack.forEach((ancestor) =>
        pushCrumb({
          id: ancestor.id,
          name: getNodeTitleForBreadcrumb(ancestor),
          type: "scope",
        })
      );
    };

    if (scopeNode) {
      appendScopeAncestors(scopeNode);
      pushCrumb({
        id: scopeNode.id,
        name: getNodeTitleForBreadcrumb(scopeNode),
        type: "scope",
      });
    }

    const nodesInScope = nodes.filter((n) => (n.parentId ?? null) === (activeScopeId ?? null));
    const edgesInScope = edges.filter((e) => (e.parentId ?? null) === (activeScopeId ?? null));

    const buildLineageInScope = () => {
      if (!activeId || !activeNode) return [] as GraphNode[];
      if (nodesInScope.length === 0) return [activeNode];

      const nodeIdsInScope = new Set(nodesInScope.map((n) => n.id));
      if (!nodeIdsInScope.has(activeId)) return [activeNode];

      const adjacency = new Map<string, Set<string>>();
      nodesInScope.forEach((n) => adjacency.set(n.id, new Set()));
      edgesInScope.forEach((edge) => {
        const sourceNeighbors = adjacency.get(edge.source);
        const targetNeighbors = adjacency.get(edge.target);
        if (sourceNeighbors) sourceNeighbors.add(edge.target);
        if (targetNeighbors) targetNeighbors.add(edge.source);
      });

      const inDegree = new Map<string, number>();
      nodesInScope.forEach((n) => inDegree.set(n.id, 0));
      edgesInScope.forEach((edge) => {
        const current = inDegree.get(edge.target);
        if (typeof current === "number") {
          inDegree.set(edge.target, current + 1);
        }
      });

      const rootCandidates = nodesInScope.filter(
        (n) => (inDegree.get(n.id) || 0) === 0
      );
      const traversalStarts =
        rootCandidates.length > 0 ? rootCandidates : nodesInScope;

      const queue: string[] = [];
      const visited = new Set<string>();
      const parentMap = new Map<string, string>();

      const enqueue = (id: string) => {
        if (visited.has(id)) return;
        visited.add(id);
        queue.push(id);
      };

      traversalStarts.forEach((node) => enqueue(node.id));

      let found = false;
      while (queue.length > 0) {
        const current = queue.shift()!;
        if (current === activeId) {
          found = true;
          break;
        }
        const neighbors = adjacency.get(current);
        if (!neighbors) continue;
        neighbors.forEach((neighbor) => {
          if (visited.has(neighbor)) return;
          parentMap.set(neighbor, current);
          enqueue(neighbor);
        });
      }

      if (!found) return [activeNode];

      const lineagePath: GraphNode[] = [];
      let cursor: string | undefined = activeId;
      while (cursor) {
        const node = nodeMap.get(cursor);
        if (node) lineagePath.unshift(node);
        cursor = parentMap.get(cursor);
      }
      return lineagePath;
    };

    if (activeNode) {
      const lineagePath = buildLineageInScope();
      lineagePath.forEach((node) =>
        pushCrumb({
          id: node.id,
          name: getNodeTitleForBreadcrumb(node),
          type: "node",
        })
      );
    }

    return crumbs;
  }, [nodes, edges, currentScopeId, selectedNodeIds, dirName, nodeMap]);

  return breadcrumbs;
};

