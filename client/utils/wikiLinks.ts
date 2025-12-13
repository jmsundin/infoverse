import { GraphNode, NodeType } from "../types";

export const INTERNAL_NODE_LINK_PREFIX = "infoverse-node://";
export const INTERNAL_NODE_LINK_REGEX = /\[\[([^\[\]]+)\]\]/g;

export const formatInternalNodeLinks = (content?: string | null) => {
  if (!content) return "";
  return content.replace(INTERNAL_NODE_LINK_REGEX, (match, rawTarget) => {
    const [target, display] = rawTarget.split("|");
    const trimmedTarget = target?.trim();
    if (!trimmedTarget) return match;
    const label = (display ?? target)?.trim() || trimmedTarget;
    return `[${label}](${INTERNAL_NODE_LINK_PREFIX}${encodeURIComponent(
      trimmedTarget
    )})`;
  });
};

export const extractInternalNodeTitle = (href: string) => {
  return decodeURIComponent(href.replace(INTERNAL_NODE_LINK_PREFIX, ""));
};

export const getNodeTitle = (node: GraphNode) => {
  if (node.type === NodeType.NOTE) {
    const firstLine = (node.content || "").split("\n")[0]?.trim();
    return firstLine || "Untitled Note";
  }
  return node.content || "Untitled";
};
