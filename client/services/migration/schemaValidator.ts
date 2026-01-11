import {
  GraphNode,
  NodeType,
  EmbeddedEdge,
  ChatMessage,
  NodeColor,
} from "../../types";
import {
  extractFirstNounPhrase,
  cleanTitleMarkdown,
} from "../../utils/titleUtils";
import { SchemaValidationResult } from "./types";

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
 * Validate a GraphNode against the current schema
 * Returns validation results with suggested fixes for invalid/missing fields
 */
export function validateNodeSchema(node: GraphNode): SchemaValidationResult {
  const missingFields: string[] = [];
  const invalidFields: Array<{ field: string; reason: string }> = [];
  const suggestedFixes: Partial<GraphNode> = {};

  // Required fields
  if (!node.id || typeof node.id !== "string") {
    missingFields.push("id");
  }

  if (!node.type || !VALID_NODE_TYPES.includes(node.type)) {
    invalidFields.push({ field: "type", reason: `Invalid type: ${node.type}` });
    suggestedFixes.type = NodeType.NOTE;
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

  // Title validation - generate if missing or empty
  if (!node.title || node.title.trim() === "") {
    const generatedTitle = generateTitleFromContent(node.content || "");
    suggestedFixes.title = generatedTitle;
    invalidFields.push({
      field: "title",
      reason: "Title missing, generated from content",
    });
  } else {
    // Clean existing title of markdown artifacts
    console.log("node.title", node.title);
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

  // Messages array validation (for CHAT nodes)
  if (node.type === NodeType.CHAT && node.messages !== undefined) {
    if (!Array.isArray(node.messages)) {
      invalidFields.push({
        field: "messages",
        reason: "messages must be an array",
      });
      suggestedFixes.messages = [];
    } else {
      const validMessages = node.messages.filter(isValidChatMessage);
      if (validMessages.length !== node.messages.length) {
        invalidFields.push({
          field: "messages",
          reason: "Some messages have invalid structure",
        });
        suggestedFixes.messages = validMessages;
      }
    }
  }

  // Aliases validation
  if (node.aliases !== undefined) {
    if (!Array.isArray(node.aliases)) {
      invalidFields.push({
        field: "aliases",
        reason: "aliases must be an array",
      });
      suggestedFixes.aliases = [];
    } else if (!node.aliases.every((a) => typeof a === "string")) {
      invalidFields.push({
        field: "aliases",
        reason: "aliases must be strings",
      });
      suggestedFixes.aliases = node.aliases.filter(
        (a) => typeof a === "string"
      );
    }
  }

  // ClusterIds validation
  if (node.clusterIds !== undefined) {
    if (!Array.isArray(node.clusterIds)) {
      invalidFields.push({
        field: "clusterIds",
        reason: "clusterIds must be an array",
      });
      suggestedFixes.clusterIds = [];
    } else if (!node.clusterIds.every((id) => typeof id === "string")) {
      invalidFields.push({
        field: "clusterIds",
        reason: "clusterIds must be strings",
      });
      suggestedFixes.clusterIds = node.clusterIds.filter(
        (id) => typeof id === "string"
      );
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

  // clusterCount validation
  if (
    node.clusterCount !== undefined &&
    typeof node.clusterCount !== "number"
  ) {
    invalidFields.push({
      field: "clusterCount",
      reason: "clusterCount must be a number",
    });
    suggestedFixes.clusterCount = 0;
  }

  // pinned validation
  if (node.pinned !== undefined && typeof node.pinned !== "boolean") {
    invalidFields.push({ field: "pinned", reason: "pinned must be a boolean" });
    suggestedFixes.pinned = false;
  }

  return {
    isValid: missingFields.length === 0 && invalidFields.length === 0,
    missingFields,
    invalidFields,
    suggestedFixes,
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
 * Check if a message has valid ChatMessage structure
 */
function isValidChatMessage(msg: unknown): msg is ChatMessage {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return (
    (m.role === "user" || m.role === "model") &&
    typeof m.text === "string" &&
    typeof m.timestamp === "number"
  );
}

/**
 * Generate a title from content using LOCAL extraction only (no AI)
 */
function generateTitleFromContent(content: string): string {
  const extracted = extractFirstNounPhrase(content, 30);
  return cleanTitleMarkdown(extracted);
}
