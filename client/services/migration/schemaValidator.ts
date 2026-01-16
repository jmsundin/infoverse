import {
  GraphNode,
  NodeType,
  EmbeddedEdge,
  NodeColor,
} from "../../types";
import {
  extractFirstNounPhrase,
  cleanTitleMarkdown,
} from "../../utils/titleUtils";
import { SchemaValidationResult, OldSchemaFields, OldChatMessage } from "./types";

const VALID_NODE_TYPES = Object.values(NodeType);
const VALID_COLORS: NodeColor[] = [
  "slate",
  "red",
  "green",
  "blue",
  "amber",
  "purple",
];

/**
 * Edge context for parentId inference during migration
 */
export interface EdgeContext {
  incomingEdgeSources: string[]; // Node IDs that have edges pointing to this node
}

/**
 * Detect fields from old schema that need migration
 */
export function detectOldSchemaFields(node: Record<string, unknown>): OldSchemaFields {
  const oldFields: OldSchemaFields = {};

  // Check for deprecated fields in frontmatter
  if ('summary' in node && node.summary !== undefined) {
    oldFields.summary = node.summary as string;
  }
  if ('aliases' in node && Array.isArray(node.aliases)) {
    oldFields.aliases = node.aliases as string[];
  }
  if ('link' in node && typeof node.link === 'string') {
    oldFields.link = node.link;
  }
  if ('messages' in node && Array.isArray(node.messages)) {
    oldFields.messages = node.messages as OldChatMessage[];
  }

  // Check for cluster fields (CLUSTER type is removed)
  if ('clusterCount' in node) {
    oldFields.clusterCount = node.clusterCount as number;
  }
  if ('clusterIds' in node && Array.isArray(node.clusterIds)) {
    oldFields.clusterIds = node.clusterIds as string[];
  }
  if ('clusterMemberNodes' in node && Array.isArray(node.clusterMemberNodes)) {
    oldFields.clusterMemberNodes = node.clusterMemberNodes;
  }
  if ('clusterInternalEdges' in node && Array.isArray(node.clusterInternalEdges)) {
    oldFields.clusterInternalEdges = node.clusterInternalEdges;
  }

  // Check for old field names (parentId used to be scope, outlineParentId -> parentId)
  if ('outlineParentId' in node && node.outlineParentId !== undefined) {
    oldFields.outlineParentId = node.outlineParentId as string;
  }

  // Check if title is in frontmatter (should be derived from body now)
  if ('title' in node && typeof node.title === 'string') {
    oldFields.title = node.title;
  }

  return oldFields;
}

/**
 * Check if node has any old schema fields that need migration
 */
export function needsMigration(oldFields: OldSchemaFields): boolean {
  return (
    oldFields.title !== undefined ||
    oldFields.summary !== undefined ||
    oldFields.aliases !== undefined ||
    oldFields.link !== undefined ||
    oldFields.messages !== undefined ||
    oldFields.clusterCount !== undefined ||
    oldFields.clusterIds !== undefined ||
    oldFields.clusterMemberNodes !== undefined ||
    oldFields.clusterInternalEdges !== undefined ||
    oldFields.outlineParentId !== undefined
  );
}

/**
 * Migrate node content from old schema to new schema
 * Transforms frontmatter fields into body content
 */
export function migrateNodeContent(
  node: GraphNode,
  oldFields: OldSchemaFields
): { content: string; removedFields: string[] } {
  let body = node.content || '';
  const removedFields: string[] = [];

  // 1. Add title as heading if not present in body
  if (oldFields.title && !body.match(/^#\s+.+$/m)) {
    body = `# ${oldFields.title}\n\n${body}`;
    removedFields.push('title');
  }

  // 2. Convert messages array to markdown (CHAT nodes)
  if (oldFields.messages?.length) {
    const messagesMd = oldFields.messages
      .map(m => {
        // Normalize 'model' to 'assistant' for new schema
        const role = m.role === 'model' ? 'assistant' : m.role;
        return `**${role}**: ${m.text}`;
      })
      .join('\n\n');

    // If body already has a title heading, insert messages after it
    const headingMatch = body.match(/^(#\s+.+\n\n?)/);
    if (headingMatch) {
      body = headingMatch[1] + '\n' + messagesMd + body.slice(headingMatch[0].length);
    } else if (body.trim()) {
      // Body has content but no heading - prepend messages
      body = messagesMd + '\n\n' + body;
    } else {
      body = messagesMd;
    }
    removedFields.push('messages');
  }

  // 3. Convert link to markdown (append to body)
  if (oldFields.link) {
    const linkMd = `\n\n[Source](${oldFields.link})`;
    body = body.trimEnd() + linkMd;
    removedFields.push('link');
  }

  // 4. Mark other deprecated fields for removal (they don't transform to body)
  if (oldFields.summary !== undefined) removedFields.push('summary');
  if (oldFields.aliases !== undefined) removedFields.push('aliases');
  if (oldFields.clusterCount !== undefined) removedFields.push('clusterCount');
  if (oldFields.clusterIds !== undefined) removedFields.push('clusterIds');
  if (oldFields.clusterMemberNodes !== undefined) removedFields.push('clusterMemberNodes');
  if (oldFields.clusterInternalEdges !== undefined) removedFields.push('clusterInternalEdges');

  return { content: body.trim(), removedFields };
}

/**
 * Migrate field names from old schema to new schema
 * - Old parentId (scope) -> scopeId
 * - Old outlineParentId -> parentId
 */
export function migrateFieldNames(
  node: Record<string, unknown>,
  oldFields: OldSchemaFields
): Partial<GraphNode> {
  const fixes: Partial<GraphNode> = {};

  // Old outlineParentId becomes new parentId
  if (oldFields.outlineParentId !== undefined) {
    fixes.parentId = oldFields.outlineParentId;
  }

  // If node has old parentId but no scopeId, and no outlineParentId,
  // then old parentId was actually the scope
  const hasOldParentIdAsScopeId =
    !('scopeId' in node) &&
    'parentId' in node &&
    oldFields.outlineParentId === undefined;

  if (hasOldParentIdAsScopeId) {
    fixes.scopeId = node.parentId as string | null;
  }

  return fixes;
}

/**
 * Migrate CLUSTER type to NOTE (CLUSTER is removed from schema)
 */
export function migrateClusterType(node: Record<string, unknown>): Partial<GraphNode> {
  if (node.type === 'CLUSTER') {
    return { type: NodeType.NOTE };
  }
  return {};
}

/**
 * Validate a GraphNode against the current schema
 * Returns validation results with suggested fixes for invalid/missing fields
 */
export function validateNodeSchema(
  node: GraphNode,
  edgeContext?: EdgeContext
): SchemaValidationResult {
  const missingFields: string[] = [];
  const invalidFields: Array<{ field: string; reason: string }> = [];
  const suggestedFixes: Partial<GraphNode> = {};

  // Detect old schema fields
  const oldSchemaFields = detectOldSchemaFields(node as unknown as Record<string, unknown>);
  const hasOldSchema = needsMigration(oldSchemaFields);

  // Required fields
  if (!node.id || typeof node.id !== "string") {
    missingFields.push("id");
  }

  // Type validation - also handle CLUSTER -> NOTE migration
  if (!node.type || !VALID_NODE_TYPES.includes(node.type)) {
    // Check if it's a CLUSTER type that needs migration
    if ((node as unknown as Record<string, unknown>).type === 'CLUSTER') {
      invalidFields.push({ field: "type", reason: "CLUSTER type removed, migrating to NOTE" });
      suggestedFixes.type = NodeType.NOTE;
    } else {
      invalidFields.push({ field: "type", reason: `Invalid type: ${node.type}` });
      suggestedFixes.type = NodeType.NOTE;
    }
  }

  if (typeof node.x !== "number" || isNaN(node.x)) {
    invalidFields.push({ field: "x", reason: "x must be a number" });
    suggestedFixes.x = 0;
  }

  if (typeof node.y !== "number" || isNaN(node.y)) {
    invalidFields.push({ field: "y", reason: "y must be a number" });
    suggestedFixes.y = 0;
  }

  if (node.content === undefined || node.content === null) {
    missingFields.push("content");
    suggestedFixes.content = "";
  }

  // Title validation - generate if missing or empty (title is now derived from body)
  if (!node.title || node.title.trim() === "") {
    const generatedTitle = generateTitleFromContent(node.content || "");
    suggestedFixes.title = generatedTitle;
    invalidFields.push({
      field: "title",
      reason: "Title missing, generated from content",
    });
  } else {
    // Clean existing title of markdown artifacts
    const cleanedTitle = cleanTitleMarkdown(node.title);
    if (cleanedTitle !== node.title) {
      suggestedFixes.title = cleanedTitle;
      invalidFields.push({
        field: "title",
        reason: "Title contained markdown formatting",
      });
    }
  }

  // Optional field type validation
  if (
    node.width !== undefined &&
    (typeof node.width !== "number" || node.width <= 0)
  ) {
    invalidFields.push({
      field: "width",
      reason: "width must be a positive number",
    });
    suggestedFixes.width = 300;
  }

  if (
    node.height !== undefined &&
    (typeof node.height !== "number" || node.height <= 0)
  ) {
    invalidFields.push({
      field: "height",
      reason: "height must be a positive number",
    });
    suggestedFixes.height = 200;
  }

  if (node.color !== undefined && !VALID_COLORS.includes(node.color)) {
    invalidFields.push({
      field: "color",
      reason: `Invalid color: ${node.color}`,
    });
    suggestedFixes.color = "slate";
  }

  // Edges array validation
  if (node.edges !== undefined) {
    if (!Array.isArray(node.edges)) {
      invalidFields.push({ field: "edges", reason: "edges must be an array" });
      suggestedFixes.edges = [];
    } else {
      const validEdges = node.edges.filter(isValidEmbeddedEdge);
      if (validEdges.length !== node.edges.length) {
        invalidFields.push({
          field: "edges",
          reason: "Some edges have invalid structure",
        });
        suggestedFixes.edges = validEdges;
      }
    }
  }

  // autoExpandDepth validation
  if (
    node.autoExpandDepth !== undefined &&
    typeof node.autoExpandDepth !== "number"
  ) {
    invalidFields.push({
      field: "autoExpandDepth",
      reason: "autoExpandDepth must be a number",
    });
    suggestedFixes.autoExpandDepth = 0;
  }

  // pinned validation
  if (node.pinned !== undefined && typeof node.pinned !== "boolean") {
    invalidFields.push({ field: "pinned", reason: "pinned must be a boolean" });
    suggestedFixes.pinned = false;
  }

  // parentId inference from edge relationships
  // If node has no parentId and is the target of edges, infer parentId from first source
  if (!node.parentId && edgeContext?.incomingEdgeSources.length) {
    const sources = edgeContext.incomingEdgeSources;
    suggestedFixes.parentId = sources[0];

    if (sources.length > 1) {
      // Multiple potential parents - log as info, use first one
      invalidFields.push({
        field: "parentId",
        reason: `Inferred parentId from edge (${sources.length} sources, using first)`,
      });
    } else {
      invalidFields.push({
        field: "parentId",
        reason: "Inferred parentId from edge relationship",
      });
    }
  }

  // Apply old schema migration fixes if needed
  if (hasOldSchema) {
    // Migrate content (title, messages, link -> body)
    const { content: migratedContent, removedFields } = migrateNodeContent(node, oldSchemaFields);
    if (removedFields.length > 0) {
      suggestedFixes.content = migratedContent;
      for (const field of removedFields) {
        invalidFields.push({
          field,
          reason: `Deprecated field migrated to body content`,
        });
      }
    }

    // Migrate field names (parentId <-> scopeId)
    const fieldNameFixes = migrateFieldNames(
      node as unknown as Record<string, unknown>,
      oldSchemaFields
    );
    Object.assign(suggestedFixes, fieldNameFixes);
    if (fieldNameFixes.scopeId !== undefined) {
      invalidFields.push({
        field: "scopeId",
        reason: "Migrated from old parentId field",
      });
    }
    if (fieldNameFixes.parentId !== undefined && oldSchemaFields.outlineParentId !== undefined) {
      invalidFields.push({
        field: "parentId",
        reason: "Migrated from outlineParentId field",
      });
    }

    // Migrate CLUSTER type
    const typeFixes = migrateClusterType(node as unknown as Record<string, unknown>);
    if (typeFixes.type !== undefined) {
      suggestedFixes.type = typeFixes.type;
    }
  }

  return {
    isValid: missingFields.length === 0 && invalidFields.length === 0,
    missingFields,
    invalidFields,
    suggestedFixes,
    oldSchemaFields: hasOldSchema ? oldSchemaFields : undefined,
  };
}

/**
 * Check if an edge has valid EmbeddedEdge structure
 */
function isValidEmbeddedEdge(edge: unknown): edge is EmbeddedEdge {
  if (typeof edge !== "object" || edge === null) return false;
  const e = edge as Record<string, unknown>;
  return (
    typeof e.id === "string" &&
    typeof e.target === "string" &&
    typeof e.label === "string"
  );
}

/**
 * Generate a title from content using LOCAL extraction only (no AI)
 */
function generateTitleFromContent(content: string): string {
  const extracted = extractFirstNounPhrase(content, 30);
  return cleanTitleMarkdown(extracted);
}
