import { GraphNode } from "../types";
import { cleanTitleMarkdown } from "./titleUtils";
import {
  extractPrefixContent,
  formatChatContent,
  parseChatMessages,
} from "./chatFormatUtils";

const INTERNAL_NODE_LINK_PREFIX = "infoverse-node://";
const MARKDOWN_FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?([\s\S]*)$/;

export function extractMarkdownBodyContent(content: string): string {
  if (!content) return "";

  const withoutBom = content.replace(/^\uFEFF/, "");
  const match = withoutBom.match(MARKDOWN_FRONTMATTER_REGEX);
  if (!match) return content;

  const rawFrontmatter = match[1] ?? "";
  // Guard against treating a top-of-file thematic break as frontmatter.
  if (!/^[a-zA-Z0-9_-]+\s*:/m.test(rawFrontmatter)) {
    return content;
  }

  const body = match[2] ?? "";
  return body.startsWith("\n") ? body.slice(1) : body;
}

export function extractHeadingTitle(content: string): string | undefined {
  const bodyContent = extractMarkdownBodyContent(content || "");
  if (!bodyContent) return undefined;
  const headingMatch = bodyContent.match(/^#\s+(.+)$/m);
  if (!headingMatch) return undefined;

  const cleaned = cleanTitleMarkdown(headingMatch[1].trim());
  return cleaned || undefined;
}

export function deriveAliasesFromContent(content: string): string[] {
  const bodyContent = extractMarkdownBodyContent(content || "");
  const aliases = new Set<string>();
  const wikiLinkRegex = /\[\[([^\[\]]+)\]\]/g;

  for (const match of bodyContent.matchAll(wikiLinkRegex)) {
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
  const bodyContent = extractMarkdownBodyContent(content || "");
  const markdownLinkRegex = /\[([^\]]+)\]\(([^)\s]+)\)/g;
  for (const match of bodyContent.matchAll(markdownLinkRegex)) {
    const href = match[2]?.trim();
    if (!href) continue;
    if (href.startsWith(INTERNAL_NODE_LINK_PREFIX)) continue;
    if (/^https?:\/\//i.test(href)) return href;
  }

  return undefined;
}

export function deriveChatMessagesFromContent(content: string): GraphNode["messages"] {
  const bodyContent = extractMarkdownBodyContent(content || "");
  const parsed = parseChatMessages(bodyContent);
  if (!parsed.length) return undefined;

  return parsed.map((message, index) => ({
    role: message.role === "user" ? "user" : "model",
    text: message.text,
    timestamp: index,
  }));
}

function stripLeadingTitleHeading(
  prefix: string,
  title?: string
): string | null {
  const trimmed = prefix.trim();
  if (!trimmed) return null;
  if (!title) return trimmed;

  const lines = trimmed.split("\n");
  const headingMatch = lines[0]?.match(/^#\s+(.+)$/);
  if (!headingMatch) return trimmed;

  const headingTitle = cleanTitleMarkdown(headingMatch[1] || "");
  const normalizedTitle = cleanTitleMarkdown(title);
  if (!headingTitle || headingTitle !== normalizedTitle) {
    return trimmed;
  }

  const remaining = lines.slice(1).join("\n").trim();
  return remaining || null;
}

export function composeChatContentFromMessages(
  existingContent: string,
  messages: Array<{ role: "user" | "model" | "assistant" | "system"; text: string }>
): string {
  const canonicalExisting = extractMarkdownBodyContent(existingContent || "");
  if (!messages.length) return canonicalExisting;

  const normalizedMessages = messages.map((m) => ({
    role: m.role,
    text: m.text,
  }));
  const title = extractHeadingTitle(canonicalExisting);
  const existingParsedMessages = parseChatMessages(canonicalExisting);
  const prefixRaw =
    extractPrefixContent(canonicalExisting) ??
    (existingParsedMessages.length === 0 ? canonicalExisting.trim() : null);
  const prefix = prefixRaw ? stripLeadingTitleHeading(prefixRaw, title) : null;
  const messagesBody = formatChatContent(normalizedMessages);

  if (title && prefix) {
    return `# ${title}\n\n${prefix}\n\n${messagesBody}`;
  }
  if (title) {
    return formatChatContent(normalizedMessages, title);
  }
  if (prefix) {
    return `${prefix}\n\n${messagesBody}`;
  }
  return messagesBody;
}

export function withDerivedContentFields(node: GraphNode): GraphNode {
  const normalizedContent = extractMarkdownBodyContent(node.content || "");
  const title = extractHeadingTitle(normalizedContent);
  const aliases = deriveAliasesFromContent(normalizedContent);
  const link = deriveFirstExternalLinkFromContent(normalizedContent);
  const messages =
    node.type === "CHAT"
      ? deriveChatMessagesFromContent(normalizedContent)
      : undefined;

  const next: GraphNode = { ...node, content: normalizedContent };

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
  const canonicalContent = extractMarkdownBodyContent(content || "");
  const normalizedAlias = alias.trim();
  if (!normalizedAlias) return canonicalContent;

  const existing = deriveAliasesFromContent(canonicalContent).some(
    (a) => a.toLowerCase() === normalizedAlias.toLowerCase()
  );
  if (existing) return canonicalContent;

  const trimmed = canonicalContent.trimEnd();
  if (!trimmed) return `[[${normalizedAlias}]]`;
  return `${trimmed}\n\n[[${normalizedAlias}]]`;
}

export function removeAliasFromContent(content: string, alias: string): string {
  const canonicalContent = extractMarkdownBodyContent(content || "");
  const normalizedAlias = alias.trim().toLowerCase();
  if (!normalizedAlias) return canonicalContent;
  const wikiLinkRegex = /\[\[([^\[\]]+)\]\]/g;

  const withoutAlias = canonicalContent.replace(wikiLinkRegex, (full, inner: string) => {
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

export function setAliasesInContent(content: string, aliases: string[]): string {
  const canonicalContent = extractMarkdownBodyContent(content || "");
  let next = canonicalContent;
  for (const existing of deriveAliasesFromContent(canonicalContent)) {
    next = removeAliasFromContent(next, existing);
  }

  const unique = Array.from(
    new Set(
      aliases
        .map((alias) => alias.trim())
        .filter((alias) => alias.length > 0)
    )
  );
  for (const alias of unique) {
    next = appendAliasToContent(next, alias);
  }
  return next;
}

export function upsertExternalLinkInContent(
  content: string,
  url: string,
  fallbackLabel = "Source"
): string {
  const canonicalContent = extractMarkdownBodyContent(content || "");
  const normalizedUrl = url.trim();
  if (!/^https?:\/\//i.test(normalizedUrl)) return canonicalContent;
  const markdownLinkRegex = /\[([^\]]+)\]\(([^)\s]+)\)/g;

  for (const match of canonicalContent.matchAll(markdownLinkRegex)) {
    const href = match[2]?.trim();
    if (
      href &&
      /^https?:\/\//i.test(href) &&
      !href.startsWith(INTERNAL_NODE_LINK_PREFIX)
    ) {
      const label = match[1]?.trim() || fallbackLabel;
      const replacement = `[${label}](${normalizedUrl})`;
      const start = match.index ?? 0;
      return `${canonicalContent.slice(0, start)}${replacement}${canonicalContent.slice(
        start + match[0].length
      )}`;
    }
  }

  const trimmed = canonicalContent.trimEnd();
  if (!trimmed) return `[${fallbackLabel}](${normalizedUrl})`;
  return `${trimmed}\n\n[${fallbackLabel}](${normalizedUrl})`;
}

export function removeFirstExternalLinkFromContent(content: string): string {
  const canonicalContent = extractMarkdownBodyContent(content || "");
  const markdownLinkRegex = /\[([^\]]+)\]\(([^)\s]+)\)/g;
  for (const match of canonicalContent.matchAll(markdownLinkRegex)) {
    const href = match[2]?.trim();
    if (!href) continue;
    if (href.startsWith(INTERNAL_NODE_LINK_PREFIX)) continue;
    if (!/^https?:\/\//i.test(href)) continue;

    const start = match.index ?? 0;
    const next = `${canonicalContent.slice(0, start)}${canonicalContent.slice(start + match[0].length)}`;
    return next.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trimEnd();
  }

  return canonicalContent;
}
