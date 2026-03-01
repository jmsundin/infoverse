import { describe, expect, it } from "vitest";
import { NodeType, type GraphNode } from "../../types";
import {
  buildNoteDedupTitleIndex,
  deriveNodeDedupTitle,
  findDuplicateNoteByTitle,
  findDuplicateNoteNode,
  normalizeNoteTitle,
} from "../noteDeduplication";

function createNode(id: string, content: string): GraphNode {
  return {
    id,
    type: NodeType.NOTE,
    x: 0,
    y: 0,
    content,
  };
}

describe("noteDeduplication", () => {
  it("normalizes meaningful titles", () => {
    expect(normalizeNoteTitle("  # Machine   Learning  ")).toBe("machine learning");
  });

  it("ignores placeholder titles", () => {
    expect(normalizeNoteTitle("Untitled")).toBeNull();
    expect(normalizeNoteTitle("new chat")).toBeNull();
    expect(normalizeNoteTitle("new note")).toBeNull();
  });

  it("derives dedupe title from markdown heading", () => {
    const node = createNode("1", "# Graph Databases\n\nBody");
    expect(deriveNodeDedupTitle(node)).toBe("graph databases");
  });

  it("finds duplicates by node content/title", () => {
    const nodes = [
      createNode("1", "# Graph Databases\n\nDetails"),
      createNode("2", "# Vector Search\n\nDetails"),
    ];

    const duplicate = findDuplicateNoteNode(nodes, {
      content: "# graph databases\n\nDifferent details",
    });

    expect(duplicate?.id).toBe("1");
  });

  it("finds duplicates by explicit title", () => {
    const nodes = [
      createNode("1", "# Machine Learning\n\nOverview"),
      createNode("2", "# Retrieval\n\nOverview"),
    ];

    const duplicate = findDuplicateNoteByTitle(nodes, "machine learning");
    expect(duplicate?.id).toBe("1");
  });

  it("uses exact fallback content when no heading exists", () => {
    const nodes = [
      createNode("1", "Raw paragraph content without a markdown heading"),
      createNode("2", "Different paragraph content"),
    ];

    const duplicate = findDuplicateNoteNode(nodes, {
      content: "raw paragraph content without a markdown heading",
    });

    expect(duplicate?.id).toBe("1");
  });

  it("indexes unique dedupe titles once", () => {
    const nodes = [
      createNode("1", "# Search\n\nA"),
      createNode("2", "# search\n\nB"),
      createNode("3", "# Ranking\n\nC"),
    ];

    const index = buildNoteDedupTitleIndex(nodes);
    expect(index.size).toBe(2);
    expect(index.get("search")?.id).toBe("1");
    expect(index.get("ranking")?.id).toBe("3");
  });
});
