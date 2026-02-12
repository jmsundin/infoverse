import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useBreadcrumbs } from "../useBreadcrumbs";
import { GraphEdge, GraphNode, NodeType } from "../../types";

const makeNode = (id: string, opts?: Partial<GraphNode>): GraphNode => ({
  id,
  type: NodeType.NOTE,
  x: 0,
  y: 0,
  content: opts?.content ?? "",
  ...opts,
});

const makeEdge = (
  id: string,
  source: string,
  target: string,
  scopeId?: string
): GraphEdge => ({
  id,
  source,
  target,
  label: "rel",
  scopeId,
});

describe("useBreadcrumbs", () => {
  it("returns only the root crumb when nothing is selected", () => {
    const nodes: GraphNode[] = [makeNode("a", { title: "A" })];
    const edges: GraphEdge[] = [];

    const { result } = renderHook(() =>
      useBreadcrumbs(nodes, edges, null, new Set(), null)
    );

    expect(result.current.map((c) => c.name)).toEqual(["Home"]);
    expect(result.current.map((c) => c.type)).toEqual(["root"]);
  });

  it("builds scope ancestry and node lineage for a single selected node", () => {
    const nodes: GraphNode[] = [
      makeNode("grand", { title: "Grand" }),
      makeNode("parent", { title: "Parent", scopeId: "grand" }),
      makeNode("child-1", { title: "Child 1", scopeId: "parent" }),
      makeNode("child-2", { title: "Child 2", scopeId: "parent" }),
    ];
    const edges: GraphEdge[] = [makeEdge("e-1", "child-1", "child-2", "parent")];

    const { result } = renderHook(() =>
      useBreadcrumbs(nodes, edges, "parent", new Set(["child-2"]), null)
    );

    expect(result.current.map((c) => c.name)).toEqual([
      "Home",
      "Grand",
      "Parent",
      "Child 1",
      "Child 2",
    ]);
    expect(result.current.map((c) => c.type)).toEqual([
      "root",
      "scope",
      "scope",
      "node",
      "node",
    ]);
  });

  it("does not pick an arbitrary active node when multiple nodes are selected", () => {
    const nodes: GraphNode[] = [
      makeNode("grand", { title: "Grand" }),
      makeNode("parent", { title: "Parent", scopeId: "grand" }),
      makeNode("child-1", { title: "Child 1", scopeId: "parent" }),
      makeNode("child-2", { title: "Child 2", scopeId: "parent" }),
    ];
    const edges: GraphEdge[] = [makeEdge("e-1", "child-1", "child-2", "parent")];

    const { result } = renderHook(() =>
      useBreadcrumbs(
        nodes,
        edges,
        "parent",
        new Set(["child-1", "child-2"]),
        null
      )
    );

    expect(result.current.map((c) => c.name)).toEqual([
      "Home",
      "Grand",
      "Parent",
    ]);
    expect(result.current.map((c) => c.type)).toEqual(["root", "scope", "scope"]);
  });

  it("uses directed lineage instead of reverse-edge traversal", () => {
    const nodes: GraphNode[] = [
      makeNode("r", { title: "R" }),
      makeNode("x", { title: "X" }),
      makeNode("z", { title: "Z" }),
      makeNode("w", { title: "W" }),
      makeNode("y", { title: "Y" }),
      makeNode("a", { title: "A" }),
    ];
    const edges: GraphEdge[] = [
      makeEdge("e1", "r", "x"),
      makeEdge("e2", "y", "x"),
      makeEdge("e3", "z", "w"),
      makeEdge("e4", "w", "y"),
      makeEdge("e5", "y", "a"),
    ];

    const { result } = renderHook(() =>
      useBreadcrumbs(nodes, edges, null, new Set(["a"]), null)
    );

    expect(result.current.map((c) => c.name)).toEqual(["Home", "Z", "W", "Y", "A"]);
    expect(result.current.map((c) => c.name)).not.toEqual([
      "Home",
      "R",
      "X",
      "Y",
      "A",
    ]);
  });
});
