import * as Y from "yjs";
import { describe, expect, it } from "vitest";
import { ChatMessage, NodeType, type GraphNode } from "../../../../types";
import {
  NODE_KEYS,
  applyNodeUpdate,
  createNodeDocument,
  documentToNode,
  initializeDocumentFromNode,
} from "../YjsNodeDocument";

function makeNode(overrides?: Partial<GraphNode>): GraphNode {
  return {
    id: "node-1",
    type: NodeType.CHAT,
    x: 10,
    y: 20,
    width: 320,
    height: 240,
    content: "# Topic\n\n**user**: Hi\n\n**assistant**: Hello",
    ...overrides,
  };
}

describe("YjsNodeDocument", () => {
  it("round-trips runtime-derived fields from content", () => {
    const doc = createNodeDocument();
    initializeDocumentFromNode(
      doc,
      makeNode({
        content: `# Topic

[[Alias]]
[Source](https://example.com)

**user**: Hi

**assistant**: Hello`,
      })
    );

    const node = documentToNode(doc);
    expect(node.title).toBe("Topic");
    expect(node.aliases).toEqual(["Alias"]);
    expect(node.link).toBe("https://example.com");
    expect(node.messages?.map((m) => m.role)).toEqual(["user", "model"]);
  });

  it("applies message updates by mutating content", () => {
    const doc = createNodeDocument();
    initializeDocumentFromNode(
      doc,
      makeNode({ content: "# Topic\n\nContext block" })
    );

    const messages: ChatMessage[] = [
      { role: "user", text: "Question", timestamp: 0 },
      { role: "model", text: "Answer", timestamp: 1 },
    ];
    applyNodeUpdate(doc, { messages });

    const node = documentToNode(doc);
    expect(node.content).toContain("**user**: Question");
    expect(node.content).toContain("**model**: Answer");
    expect(node.messages?.map((m) => m.text)).toEqual(["Question", "Answer"]);
  });

  it("folds legacy link/aliases/messages fields into content", () => {
    const doc = createNodeDocument();
    initializeDocumentFromNode(
      doc,
      makeNode({ content: "", messages: undefined, aliases: undefined, link: undefined })
    );

    const root = doc.getMap("root");
    const metadata = root.get(NODE_KEYS.METADATA) as Y.Map<any>;
    metadata.set("link", "https://legacy.example");

    const aliases = new Y.Array<string>();
    aliases.push(["LegacyAlias"]);
    root.set(NODE_KEYS.ALIASES, aliases);

    const messages = new Y.Array<ChatMessage>();
    messages.push([
      { role: "user", text: "Legacy question", timestamp: 1 },
      { role: "model", text: "Legacy answer", timestamp: 2 },
    ]);
    root.set(NODE_KEYS.MESSAGES, messages);

    const node = documentToNode(doc);
    expect(node.content).toContain("https://legacy.example");
    expect(node.content).toContain("[[LegacyAlias]]");
    expect(node.content).toContain("**user**: Legacy question");
    expect(node.messages?.map((m) => m.role)).toEqual(["user", "model"]);
  });
});
