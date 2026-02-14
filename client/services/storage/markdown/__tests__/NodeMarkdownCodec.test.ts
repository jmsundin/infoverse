import { describe, expect, it } from "vitest";
import { NodeType, type GraphNode } from "../../../../types";
import {
  parseNodeMarkdown,
  parseNodeMarkdownFrontmatter,
  serializeNodeMarkdown,
} from "../NodeMarkdownCodec";

const makeNode = (overrides?: Partial<GraphNode>): GraphNode => ({
  id: "node-1",
  type: NodeType.NOTE,
  x: 12,
  y: 34,
  width: 320,
  height: 210,
  content: "# Sample\n\nBody text",
  ...overrides,
});

describe("NodeMarkdownCodec", () => {
  it("parses frontmatter, derived fields, and embedded edges", () => {
    const markdown = `---
id: chat-1
type: CHAT
x: 10
y: 20
scopeId: scope-a
parentId: parent-a
edges:
  - id: edge-1
    target: node-2
    label: related
---

# Chat Topic

Context for this chat.

**user**: Hello

**assistant**: Hi there

[[Alpha]]
[[Beta|Beta Display]]

[Source](https://example.com/ref)
`;

    const parsed = parseNodeMarkdown(markdown);
    expect(parsed).not.toBeNull();
    expect(parsed?.frontmatter.id).toBe("chat-1");
    expect(parsed?.node.type).toBe(NodeType.CHAT);
    expect(parsed?.node.title).toBe("Chat Topic");
    expect(parsed?.node.scopeId).toBe("scope-a");
    expect(parsed?.node.parentId).toBe("parent-a");
    expect(parsed?.node.messages?.map((m) => m.role)).toEqual(["user", "model"]);
    expect(parsed?.node.aliases).toEqual(
      expect.arrayContaining(["Alpha", "Beta", "Beta Display"])
    );
    expect(parsed?.node.link).toBe("https://example.com/ref");
    expect(parsed?.edges).toEqual([
      {
        id: "edge-1",
        source: "chat-1",
        target: "node-2",
        label: "related",
        scopeId: undefined,
      },
    ]);
  });

  it("supports legacy scope/parent migration from frontmatter keys", () => {
    const legacyMarkdown = `---
id: legacy-1
type: NOTE
x: 1
y: 2
parentId: legacy-scope
outlineParentId: outline-parent
---

Legacy body
`;

    const parsed = parseNodeMarkdown(legacyMarkdown);
    expect(parsed).not.toBeNull();
    expect(parsed?.node.scopeId).toBe("legacy-scope");
    expect(parsed?.node.parentId).toBe("outline-parent");
  });

  it("serializes only persisted frontmatter fields plus body content", () => {
    const node = makeNode({
      type: NodeType.CHAT,
      content: "# Canonical Title\n\n**user**: question",
      title: "Do not persist me",
      messages: [{ role: "user", text: "question", timestamp: 1 }],
      aliases: ["AliasA"],
      link: "https://example.com",
      summary: "Do not persist summary",
    });

    const markdown = serializeNodeMarkdown({
      node,
      edges: [
        { id: "edge-1", source: "node-1", target: "node-2", label: "rel" },
        { id: "edge-2", source: "other-node", target: "node-1", label: "ignored" },
      ],
    });

    expect(markdown).toContain("id: node-1");
    expect(markdown).toContain("type: CHAT");
    expect(markdown).toContain("edges:");
    expect(markdown).not.toContain("title:");
    expect(markdown).not.toContain("messages:");
    expect(markdown).not.toContain("aliases:");
    expect(markdown).not.toContain("summary:");
    expect(markdown).not.toContain("link:");
    expect(markdown).toContain("# Canonical Title");
  });

  it("round-trips through serialize + parse", () => {
    const node = makeNode({
      id: "roundtrip-1",
      type: NodeType.NOTE,
      scopeId: "scope-x",
      parentId: "parent-y",
      autoExpandDepth: 2,
      content: "# Roundtrip\n\nBody with --- delimiter",
    });

    const serialized = serializeNodeMarkdown({
      node,
      edges: [{ id: "edge-rt", source: "roundtrip-1", target: "target-1", label: "rel" }],
    });
    const parsed = parseNodeMarkdown(serialized);

    expect(parsed).not.toBeNull();
    expect(parsed?.node.id).toBe(node.id);
    expect(parsed?.node.type).toBe(node.type);
    expect(parsed?.node.scopeId).toBe(node.scopeId);
    expect(parsed?.node.parentId).toBe(node.parentId);
    expect(parsed?.node.content).toBe(node.content);
    expect(parsed?.edges).toHaveLength(1);
    expect(parsed?.edges[0].target).toBe("target-1");
  });

  it("parses frontmatter without reading full body", () => {
    const markdown = `---
id: quick-1
type: NOTE
x: 50
y: 80
---

# Title
Body
`;

    const frontmatter = parseNodeMarkdownFrontmatter(markdown);
    expect(frontmatter).not.toBeNull();
    expect(frontmatter?.id).toBe("quick-1");
    expect(frontmatter?.x).toBe(50);
    expect(frontmatter?.y).toBe(80);
  });
});

