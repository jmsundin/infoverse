import { describe, expect, it } from "vitest";
import { NodeType, GraphNode } from "../../../types";
import {
  migrateFieldNames,
  migrateNodeContent,
  validateNodeSchema,
} from "../schemaValidator";
import { OldSchemaFields } from "../types";

const baseNode = (overrides?: Partial<GraphNode>): GraphNode => ({
  id: "node-1",
  type: NodeType.NOTE,
  x: 10,
  y: 20,
  content: "",
  ...overrides,
});

describe("schemaValidator", () => {
  it("migrates legacy title/messages/link into body content", () => {
    const oldFields: OldSchemaFields = {
      title: "Legacy Node",
      messages: [{ role: "model", text: "Hello world" }],
      link: "https://example.com",
    };

    const result = migrateNodeContent(baseNode({ content: "Existing body" }), oldFields);

    expect(result.content).toContain("# Legacy Node");
    expect(result.content).toContain("**assistant**: Hello world");
    expect(result.content).toContain("[Source](https://example.com)");
    expect(result.removedFields).toEqual(expect.arrayContaining(["title", "messages", "link"]));
  });

  it("migrates old parent field names with safety checks", () => {
    expect(
      migrateFieldNames(
        { parentId: "legacy-scope" },
        {}
      )
    ).toEqual({ scopeId: "legacy-scope" });

    expect(
      migrateFieldNames(
        { parentId: "outline-parent", scopeId: null },
        {}
      )
    ).toEqual({});

    expect(
      migrateFieldNames(
        { outlineParentId: "legacy-outline" },
        { outlineParentId: "legacy-outline" }
      )
    ).toEqual({ parentId: "legacy-outline" });
  });

  it("infers parentId from incoming edge context only when missing", () => {
    const noParent = baseNode();
    const inferred = validateNodeSchema(noParent, {
      incomingEdgeSources: ["parent-a", "parent-b"],
    });

    expect(inferred.suggestedFixes.parentId).toBe("parent-a");
    expect(
      inferred.invalidFields.some(
        (field) =>
          field.field === "parentId" &&
          field.reason.includes("using first")
      )
    ).toBe(true);

    const alreadyHasParent = baseNode({ parentId: "keep-me" });
    const notInferred = validateNodeSchema(alreadyHasParent, {
      incomingEdgeSources: ["other-parent"],
    });
    expect(notInferred.suggestedFixes.parentId).toBeUndefined();
  });
});
