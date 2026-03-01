import { GraphNode } from "../types";
import { extractHeadingTitle, extractMarkdownBodyContent } from "./nodeContentUtils";
import { cleanTitleMarkdown } from "./titleUtils";

const NON_UNIQUE_TITLES = new Set([
  "",
  "untitled",
  "new note",
  "new chat",
  "note",
  "chat",
]);

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

export function normalizeNoteTitle(rawTitle: string): string | null {
  const normalized = normalizeWhitespace(cleanTitleMarkdown(rawTitle || ""));
  if (!normalized || NON_UNIQUE_TITLES.has(normalized)) return null;
  return normalized;
}

export function deriveNodeDedupTitle(
  node: Pick<GraphNode, "content" | "summary">
): string | null {
  const bodyContent = extractMarkdownBodyContent(node.content || "");
  const headingTitle = extractHeadingTitle(bodyContent);
  if (headingTitle) return normalizeNoteTitle(headingTitle);

  const fallbackSource = bodyContent.trim() || node.summary || "";
  if (!fallbackSource.trim()) return null;
  const normalizedFallback = normalizeWhitespace(fallbackSource);
  if (!normalizedFallback || NON_UNIQUE_TITLES.has(normalizedFallback)) {
    return null;
  }
  return normalizedFallback;
}

export function findDuplicateNoteNode(
  nodes: GraphNode[],
  candidate: Pick<GraphNode, "content" | "summary">,
  options: { excludeId?: string } = {}
): GraphNode | null {
  const dedupTitle = deriveNodeDedupTitle(candidate);
  if (!dedupTitle) return null;

  for (const node of nodes) {
    if (options.excludeId && node.id === options.excludeId) continue;
    if (deriveNodeDedupTitle(node) === dedupTitle) {
      return node;
    }
  }

  return null;
}

export function findDuplicateNoteByTitle(
  nodes: GraphNode[],
  title: string,
  options: { excludeId?: string } = {}
): GraphNode | null {
  const dedupTitle = normalizeNoteTitle(title);
  if (!dedupTitle) return null;

  for (const node of nodes) {
    if (options.excludeId && node.id === options.excludeId) continue;
    if (deriveNodeDedupTitle(node) === dedupTitle) {
      return node;
    }
  }

  return null;
}

export function buildNoteDedupTitleIndex(nodes: GraphNode[]): Map<string, GraphNode> {
  const titleIndex = new Map<string, GraphNode>();

  for (const node of nodes) {
    const dedupTitle = deriveNodeDedupTitle(node);
    if (!dedupTitle || titleIndex.has(dedupTitle)) continue;
    titleIndex.set(dedupTitle, node);
  }

  return titleIndex;
}
