import { GraphNode } from "../types";
import { cleanTitleMarkdown } from "./titleUtils";
import { parseChatMessages } from "./chatFormatUtils";

const INTERNAL_NODE_LINK_PREFIX = "infoverse-node://";

export function extractHeadingTitle(content: string): string | undefined {
  if (!content) return undefined;
  const headingMatch = content.match(/^#\s+(.+)$/m);
  if (!headingMatch) return undefined;

  const cleaned = cleanTitleMarkdown(headingMatch[1].trim());
  return cleaned || undefined;
}

export function deriveAliasesFromContent(content: string): string[] {
  const aliases = new Set<string>();
  const wikiLinkRegex = /\[\[([^\[\]]+)\]\]/g;

  for (const match of content.matchAll(wikiLinkRegex)) {
    const raw = match[1]?.trim();
    if (!raw) continue;

    const [target, display] = raw.split("|");
    const targetAlias = target?.trim();
    const displayAlias = display?.trim();

    if (targetAlias) aliases.add(targetAlias);
    if (displayAlias) aliases.add(displayAlias);
  }

  return Array.from(aliases);
}

export function deriveFirstExternalLinkFromContent(
  content: string
): string | undefined {
  const markdownLinkRegex = /\[([^\]]+)\]\(([^)\s]+)\)/g;
  for (const match of content.matchAll(markdownLinkRegex)) {
    const href = match[2]?.trim();
    if (!href) continue;
    if (href.startsWith(INTERNAL_NODE_LINK_PREFIX)) continue;
    if (/^https?:\/\//i.test(href)) return href;
  }

  return undefined;
}

export function deriveChatMessagesFromContent(content: string): GraphNode["messages"] {
  const parsed = parseChatMessages(content || "");
  if (!parsed.length) return undefined;

  return parsed.map((message, index) => ({
    role: message.role === "user" ? "user" : "model",
    text: message.text,
    timestamp: index,
  }));
}

export function withDerivedContentFields(node: GraphNode): GraphNode {
  const title = extractHeadingTitle(node.content || "");
  const aliases = deriveAliasesFromContent(node.content || "");
  const link = deriveFirstExternalLinkFromContent(node.content || "");
  const messages = node.type === "CHAT" ? deriveChatMessagesFromContent(node.content || "") : undefined;

  const next: GraphNode = { ...node };

  if (title) {
    next.title = title;
  } else {
    delete next.title;
  }

  if (aliases.length > 0) {
    next.aliases = aliases;
  } else {
    delete next.aliases;
  }

  if (link) {
    next.link = link;
  } else {
    delete next.link;
  }

  if (node.type === "CHAT" && messages && messages.length > 0) {
    next.messages = messages;
  } else if (node.type === "CHAT") {
    delete next.messages;
  }

  return next;
}

export function appendAliasToContent(content: string, alias: string): string {
  const normalizedAlias = alias.trim();
  if (!normalizedAlias) return content;

  const existing = deriveAliasesFromContent(content).some(
    (a) => a.toLowerCase() === normalizedAlias.toLowerCase()
  );
  if (existing) return content;

  const trimmed = content.trimEnd();
  if (!trimmed) return `[[${normalizedAlias}]]`;
  return `${trimmed}\n\n[[${normalizedAlias}]]`;
}

export function removeAliasFromContent(content: string, alias: string): string {
  const normalizedAlias = alias.trim().toLowerCase();
  if (!normalizedAlias) return content;
  const wikiLinkRegex = /\[\[([^\[\]]+)\]\]/g;

  const withoutAlias = content.replace(wikiLinkRegex, (full, inner: string) => {
    const [targetRaw, displayRaw] = inner.split("|");
    const target = targetRaw?.trim().toLowerCase();
    const display = displayRaw?.trim().toLowerCase();

    if (target === normalizedAlias || display === normalizedAlias) {
      return "";
    }
    return full;
  });

  return withoutAlias.replace(/\n{3,}/g, "\n\n").trimEnd();
}

export function upsertExternalLinkInContent(
  content: string,
  url: string,
  fallbackLabel = "Source"
): string {
  const normalizedUrl = url.trim();
  if (!/^https?:\/\//i.test(normalizedUrl)) return content;
  const markdownLinkRegex = /\[([^\]]+)\]\(([^)\s]+)\)/g;

  for (const match of content.matchAll(markdownLinkRegex)) {
    const href = match[2]?.trim();
    if (
      href &&
      /^https?:\/\//i.test(href) &&
      !href.startsWith(INTERNAL_NODE_LINK_PREFIX)
    ) {
      const label = match[1]?.trim() || fallbackLabel;
      const replacement = `[${label}](${normalizedUrl})`;
      const start = match.index ?? 0;
      return `${content.slice(0, start)}${replacement}${content.slice(
        start + match[0].length
      )}`;
    }
  }

  const trimmed = content.trimEnd();
  if (!trimmed) return `[${fallbackLabel}](${normalizedUrl})`;
  return `${trimmed}\n\n[${fallbackLabel}](${normalizedUrl})`;
}
