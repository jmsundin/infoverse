import { GraphNode, NodeType } from "../types";
import { DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT } from "../constants";

export const getDefaultNodePosition = () => {
  if (typeof window === "undefined") {
    return { x: 0, y: 0 };
  }

  return {
    x: window.innerWidth / 2 - DEFAULT_NODE_WIDTH / 2,
    y: window.innerHeight / 2 - DEFAULT_NODE_HEIGHT / 2,
  };
};

export const createDefaultGraphNodes = (): GraphNode[] => {
  const { x, y } = getDefaultNodePosition();
  return [
    {
      id: "1",
      type: NodeType.CHAT,
      x,
      y,
      content: "Infoverse",
      messages: [
        {
          role: "model",
          text: "Welcome to Infoverse! \n\nI am an infinite, AI-powered knowledge canvas. \n\nAsk me anything to visualize a topic, or click the expand icon (top right) to discover related concepts.",
          timestamp: Date.now(),
        },
      ],
      width: DEFAULT_NODE_WIDTH,
      height: DEFAULT_NODE_HEIGHT,
    },
  ];
};

export const getFirstNonEmptyLine = (text?: string | null) => {
  if (!text) return "";
  for (const rawLine of text.split("\n")) {
    const trimmed = rawLine.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return "";
};

export const getNodeTitleForBreadcrumb = (node: GraphNode) => {
  if (!node) return "Untitled";
  if (node.type === NodeType.CHAT) {
    return (node.content || "").trim() || "Chat";
  }

  let title = getFirstNonEmptyLine(node.content);
  const headingMatch = title.match(/^#+\s*(.*)$/);
  if (headingMatch) {
    title = headingMatch[1].trim();
  }

  if (title) return title;

  const summaryLine = getFirstNonEmptyLine(node.summary);
  return summaryLine || "Untitled";
};

// Helper to parse text into nodes locally without API call
export const parseTextToNodes = (text: string) => {
  const subNodes: { name: string; description: string; indent: number }[] = [];

  const lines = text.split("\n");
  // Check if it looks like a list (heuristic: has bullet points or numbers)
  const listLines = lines.filter((l) => /^\s*([-*•]|\d+\.)/.test(l));
  const isList =
    listLines.length > 0 &&
    listLines.length > lines.filter((l) => l.trim()).length * 0.3;

  if (isList) {
    lines.forEach((line) => {
      // Match indentation group (1), bullet group (2), content group (3)
      const match = line.match(/^(\s*)([-*•]|\d+\.)\s+(.*)/);
      if (match) {
        const rawIndent = match[1];
        // Normalize tabs to 4 spaces for calculation
        const indent = rawIndent.replace(/\t/g, "    ").length;
        const content = match[3].trim();
        if (content) {
          subNodes.push({
            name: content.substring(0, 30) + (content.length > 30 ? "..." : ""),
            description: content,
            indent: indent,
          });
        }
      }
    });
  } else {
    // Fallback: split by paragraphs
    const paragraphs = text.split(/\n\s*\n/);
    paragraphs.forEach((p) => {
      const clean = p.trim();
      if (!clean) return;
      // Try to extract a "bold" title **Title**
      const boldMatch = clean.match(/^\*\*(.*?)\*\*/);
      let name = boldMatch ? boldMatch[1] : clean.split(".")[0];
      if (name.length > 40) name = name.substring(0, 40) + "...";

      subNodes.push({ name, description: clean, indent: 0 });
    });
  }
  return subNodes;
};

