import { describe, expect, it } from "vitest";
import { NodeType, type GraphNode } from "../../types";
import {
  appendAliasToContent,
  deriveAliasesFromContent,
  deriveChatMessagesFromContent,
  deriveFirstExternalLinkFromContent,
  extractHeadingTitle,
  removeAliasFromContent,
  upsertExternalLinkInContent,
  withDerivedContentFields,
} from "../nodeContentUtils";

const makeNode = (content: string): GraphNode => ({
  id: "node-1",
  type: NodeType.NOTE,
  x: 0,
  y: 0,
  content,
});

describe("nodeContentUtils", () => {
  it("derives heading title, aliases, and first external link from content", () => {
    const content = `# Heading Title

[[Alpha]]
[[Beta|Display]]

[Internal](infoverse-node://abc)
[Source](https://example.com/article)
`;

    expect(extractHeadingTitle(content)).toBe("Heading Title");
    expect(deriveAliasesFromContent(content)).toEqual(
      expect.arrayContaining(["Alpha", "Beta", "Display"])
    );
    expect(deriveFirstExternalLinkFromContent(content)).toBe(
      "https://example.com/article"
    );
  });

  it("adds aliases to content without duplicates", () => {
    const original = "# Node\n\nBody";
    const withAlias = appendAliasToContent(original, "Alpha");
    const withDuplicate = appendAliasToContent(withAlias, "alpha");

    expect(withAlias).toContain("[[Alpha]]");
    expect(withDuplicate).toBe(withAlias);
  });

  it("removes matching wiki aliases from content", () => {
    const content = "# Node\n\n[[Alpha]]\n[[Beta|Alias]]\n[[Gamma]]";
    const removed = removeAliasFromContent(content, "Alias");

    expect(removed).not.toContain("[[Beta|Alias]]");
    expect(removed).toContain("[[Alpha]]");
    expect(removed).toContain("[[Gamma]]");
  });

  it("upserts first external link while preserving label", () => {
    const content = `# Node

[Internal](infoverse-node://node-1)
[Wikipedia](https://en.wikipedia.org/wiki/Old)
`;

    const updated = upsertExternalLinkInContent(
      content,
      "https://en.wikipedia.org/wiki/New",
      "Source"
    );

    expect(updated).toContain("[Wikipedia](https://en.wikipedia.org/wiki/New)");
    expect(updated).not.toContain("wiki/Old");
  });

  it("projects content-derived fields onto a runtime node", () => {
    const node = makeNode(`# Topic

[[Alias]]
[Ref](https://example.com)
`);

    const projected = withDerivedContentFields(node);

    expect(projected.title).toBe("Topic");
    expect(projected.aliases).toEqual(["Alias"]);
    expect(projected.link).toBe("https://example.com");
  });

  it("derives chat messages from markdown transcript", () => {
    const content = `# Chat

**user**: Hi

**assistant**: Hello there`;

    const messages = deriveChatMessagesFromContent(content);
    expect(messages).toEqual([
      { role: "user", text: "Hi", timestamp: 0 },
      { role: "model", text: "Hello there", timestamp: 1 },
    ]);
  });

  it("includes derived chat messages in projected CHAT nodes", () => {
    const node = makeNode(`**user**: Question

**assistant**: Answer`);
    node.type = NodeType.CHAT;

    const projected = withDerivedContentFields(node);
    expect(projected.messages).toEqual([
      { role: "user", text: "Question", timestamp: 0 },
      { role: "model", text: "Answer", timestamp: 1 },
    ]);
  });
});
