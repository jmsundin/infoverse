import yaml from "js-yaml";
import {
  ChatMessage,
  EmbeddedEdge,
  GraphEdge,
  GraphNode,
  GraphNodeFrontmatter,
  NodeColor,
  NodeType,
} from "../../../types";
import { parseChatMessages } from "../../../utils/chatFormatUtils";
import { cleanTitleMarkdown } from "../../../utils/titleUtils";

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?([\s\S]*)$/;
const INTERNAL_NODE_LINK_PREFIX = "infoverse-node://";
const WIKI_LINK_REGEX = /\[\[([^\[\]]+)\]\]/g;
const MARKDOWN_LINK_REGEX = /\[[^\]]+\]\(([^)\s]+)\)/g;

const VALID_NODE_COLORS: ReadonlySet<NodeColor> = new Set([
  "slate",
  "red",
  "green",
  "blue",
  "amber",
  "purple",
]);

export interface ParseNodeMarkdownResult {
  node: GraphNode;
  edges: GraphEdge[];
  frontmatter: GraphNodeFrontmatter;
  body: string;
}

export interface SerializeNodeMarkdownInput {
  node: GraphNode;
  edges?: GraphEdge[];
}

export interface SerializeNodeMarkdownOptions {
  // Kept true for backward compatibility; positions currently still live in frontmatter.
  includeLayoutInFrontmatter?: boolean;
}

const DEFAULT_SERIALIZE_OPTIONS: Required<SerializeNodeMarkdownOptions> = {
  includeLayoutInFrontmatter: true,
};

/**
 * Parse a markdown node document into normalized node + edges data.
 * Returns null when the document is not a valid node markdown file.
 */
export function parseNodeMarkdown(markdown: string): ParseNodeMarkdownResult | null {
  const match = markdown.match(FRONTMATTER_REGEX);
  if (!match) return null;

  const rawMetadata = parseYamlObject(match[1]);
  if (!rawMetadata) return null;

  const id = asTrimmedString(rawMetadata.id);
  if (!id) return null;

  const frontmatter = normalizeFrontmatter(rawMetadata, id);
  const body = normalizeBody(match[2] ?? "");

  const node: GraphNode = {
    ...frontmatter,
    content: body,
  };

  const title = extractTitleFromBody(body);
  if (title) {
    node.title = title;
  }

  if (node.type === NodeType.CHAT) {
    const messages = extractMessagesFromBody(body);
    if (messages.length > 0) {
      node.messages = messages;
    }
  }

  const aliases = extractAliasesFromBody(body);
  if (aliases.length > 0) {
    node.aliases = aliases;
  }

  const link = extractFirstExternalLink(body);
  if (link) {
    node.link = link;
  }

  const edges = (frontmatter.edges ?? []).map((edge) => ({
    id: edge.id,
    source: id,
    target: edge.target,
    label: edge.label,
    scopeId: edge.scopeId,
  }));

  return {
    node,
    edges,
    frontmatter,
    body,
  };
}

/**
 * Parse just the frontmatter of a markdown node document.
 * Useful for metadata-only indexing paths.
 */
export function parseNodeMarkdownFrontmatter(markdown: string): GraphNodeFrontmatter | null {
  const match = markdown.match(FRONTMATTER_REGEX);
  if (!match) return null;

  const rawMetadata = parseYamlObject(match[1]);
  if (!rawMetadata) return null;

  const id = asTrimmedString(rawMetadata.id);
  if (!id) return null;

  return normalizeFrontmatter(rawMetadata, id);
}

/**
 * Serialize a normalized node + outgoing edges to markdown.
 */
export function serializeNodeMarkdown(
  input: SerializeNodeMarkdownInput,
  options: SerializeNodeMarkdownOptions = {}
): string {
  const config = { ...DEFAULT_SERIALIZE_OPTIONS, ...options };
  const { node, edges = [] } = input;

  const metadata: Record<string, unknown> = {
    id: node.id,
    type: node.type,
  };

  if (config.includeLayoutInFrontmatter) {
    metadata.x = node.x;
    metadata.y = node.y;
    if (isFiniteNumber(node.width)) metadata.width = node.width;
    if (isFiniteNumber(node.height)) metadata.height = node.height;
  }

  if (isNodeColor(node.color)) metadata.color = node.color;
  if (typeof node.pinned === "boolean") metadata.pinned = node.pinned;
  if (node.scopeId !== undefined) metadata.scopeId = node.scopeId;
  if (node.parentId !== undefined) metadata.parentId = node.parentId;
  if (isFiniteNumber(node.autoExpandDepth)) metadata.autoExpandDepth = node.autoExpandDepth;

  const embeddedEdges = edges
    .filter((edge) => edge.source === node.id)
    .map(toEmbeddedEdge);
  if (embeddedEdges.length > 0) {
    metadata.edges = embeddedEdges;
  }

  const frontmatter = yaml
    .dump(metadata, { noRefs: true, lineWidth: -1, sortKeys: false })
    .trimEnd();
  const body = normalizeLineEndings(node.content ?? "");

  return `---\n${frontmatter}\n---\n\n${body}`;
}

function parseYamlObject(rawFrontmatter: string): Record<string, unknown> | null {
  try {
    const parsed = yaml.load(rawFrontmatter);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeFrontmatter(raw: Record<string, unknown>, id: string): GraphNodeFrontmatter {
  const hasScopeId = Object.prototype.hasOwnProperty.call(raw, "scopeId");
  const hasParentId = Object.prototype.hasOwnProperty.call(raw, "parentId");
  const hasOutlineParentId = Object.prototype.hasOwnProperty.call(raw, "outlineParentId");

  const scopeId = hasScopeId ? asNullableString(raw.scopeId) : asNullableString(raw.parentId);
  const parentId = hasOutlineParentId
    ? asNullableString(raw.outlineParentId)
    : hasScopeId && hasParentId
      ? asNullableString(raw.parentId)
      : undefined;

  const frontmatter: GraphNodeFrontmatter = {
    id,
    type: asNodeType(raw.type),
    x: asNumber(raw.x, 0),
    y: asNumber(raw.y, 0),
  };

  if (isPositiveFiniteNumber(raw.width)) frontmatter.width = raw.width as number;
  if (isPositiveFiniteNumber(raw.height)) frontmatter.height = raw.height as number;
  if (isNodeColor(raw.color)) frontmatter.color = raw.color;
  if (typeof raw.pinned === "boolean") frontmatter.pinned = raw.pinned;
  if (scopeId !== undefined) frontmatter.scopeId = scopeId;
  if (parentId !== undefined) frontmatter.parentId = parentId;
  if (isFiniteNumber(raw.autoExpandDepth)) {
    frontmatter.autoExpandDepth = raw.autoExpandDepth as number;
  }

  const embeddedEdges = normalizeEmbeddedEdges(raw.edges);
  if (embeddedEdges.length > 0) {
    frontmatter.edges = embeddedEdges;
  }

  return frontmatter;
}

function normalizeEmbeddedEdges(value: unknown): EmbeddedEdge[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((edge): EmbeddedEdge | null => {
      if (!edge || typeof edge !== "object" || Array.isArray(edge)) return null;
      const candidate = edge as Record<string, unknown>;
      const id = asTrimmedString(candidate.id);
      const target = asTrimmedString(candidate.target);
      const label = asTrimmedString(candidate.label);
      if (!id || !target || !label) return null;

      const normalized: EmbeddedEdge = { id, target, label };
      const scopeId = asTrimmedString(candidate.scopeId);
      if (scopeId) {
        normalized.scopeId = scopeId;
      }
      return normalized;
    })
    .filter((edge): edge is EmbeddedEdge => edge !== null);
}

function extractTitleFromBody(body: string): string | undefined {
  const headingMatch = body.match(/^#\s+(.+)$/m);
  if (!headingMatch) return undefined;

  const cleaned = cleanTitleMarkdown(headingMatch[1].trim());
  return cleaned || undefined;
}

function extractMessagesFromBody(body: string): ChatMessage[] {
  const parsed = parseChatMessages(body);
  return parsed.map((message, index) => ({
    role: message.role === "user" ? "user" : "model",
    text: message.text,
    timestamp: index,
  }));
}

function extractAliasesFromBody(body: string): string[] {
  const aliases = new Set<string>();

  for (const match of body.matchAll(WIKI_LINK_REGEX)) {
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

function extractFirstExternalLink(body: string): string | undefined {
  for (const match of body.matchAll(MARKDOWN_LINK_REGEX)) {
    const href = match[1]?.trim();
    if (!href) continue;
    if (href.startsWith(INTERNAL_NODE_LINK_PREFIX)) continue;
    if (/^https?:\/\//i.test(href)) return href;
  }
  return undefined;
}

function toEmbeddedEdge(edge: GraphEdge): EmbeddedEdge {
  const embedded: EmbeddedEdge = {
    id: edge.id,
    target: edge.target,
    label: edge.label,
  };
  if (edge.scopeId !== undefined) {
    embedded.scopeId = edge.scopeId;
  }
  return embedded;
}

function asNodeType(value: unknown): NodeType {
  return value === NodeType.CHAT ? NodeType.CHAT : NodeType.NOTE;
}

function asNumber(value: unknown, fallback: number): number {
  return isFiniteNumber(value) ? (value as number) : fallback;
}

function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asNullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return asTrimmedString(value);
}

function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, "\n");
}

function normalizeBody(content: string): string {
  const normalized = normalizeLineEndings(content);
  // Remove one framing newline after frontmatter delimiter ("---\n\n<body>").
  return normalized.startsWith("\n") ? normalized.slice(1) : normalized;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

function isNodeColor(value: unknown): value is NodeColor {
  return typeof value === "string" && VALID_NODE_COLORS.has(value as NodeColor);
}
