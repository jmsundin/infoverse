import * as Y from 'yjs';
import { GraphNode, EmbeddedEdge, ChatMessage, NodeType, NodeColor } from '../../../types';
import {
  appendAliasToContent,
  composeChatContentFromMessages,
  deriveAliasesFromContent,
  deriveChatMessagesFromContent,
  deriveFirstExternalLinkFromContent,
  removeAliasFromContent,
  removeFirstExternalLinkFromContent,
  setAliasesInContent,
  upsertExternalLinkInContent,
  withDerivedContentFields,
} from '../../../utils/nodeContentUtils';

/**
 * Structure of a Yjs document for a single node.
 *
 * CRDT Strategy:
 * - Position (x, y): LWW Register via Y.Map
 * - Dimensions (width, height): LWW Register via Y.Map
 * - Visual (color, type): LWW Register via Y.Map
 * - Metadata (parentId, scope, summary, etc.): LWW Register via Y.Map
 * - Content: Text CRDT via Y.Text
 * - Edges: Set CRDT via Y.Array with deduplication by id
 *
 * Runtime-derived fields (title/aliases/link/messages) are projected from content.
 */

// Keys for the top-level Y.Map in each document
export const NODE_KEYS = {
  ID: 'id',
  POSITION: 'position',
  DIMENSIONS: 'dimensions',
  VISUAL: 'visual',
  METADATA: 'metadata',
  CONTENT: 'content',
  // Legacy-only; kept for backward compatibility with old docs.
  ALIASES: 'aliases',
  EDGES: 'edges',
  // Legacy-only; kept for backward compatibility with old docs.
  MESSAGES: 'messages',
} as const;

/**
 * Create a new Yjs document for a node
 */
export function createNodeDocument(): Y.Doc {
  return new Y.Doc();
}

/**
 * Initialize a Yjs document from a GraphNode
 */
export function initializeDocumentFromNode(doc: Y.Doc, node: GraphNode): void {
  const root = doc.getMap('root');
  let canonicalContent = node.content || '';

  // Legacy compatibility: fold deprecated runtime fields into body when content lacks them.
  if (
    node.type === NodeType.CHAT &&
    node.messages &&
    node.messages.length > 0 &&
    !(deriveChatMessagesFromContent(canonicalContent)?.length)
  ) {
    canonicalContent = composeChatContentFromMessages(
      canonicalContent,
      node.messages.map((m) => ({ role: m.role, text: m.text }))
    );
  }

  if (node.aliases && node.aliases.length > 0 && deriveAliasesFromContent(canonicalContent).length === 0) {
    canonicalContent = setAliasesInContent(canonicalContent, node.aliases);
  }

  if (node.link && !deriveFirstExternalLinkFromContent(canonicalContent)) {
    canonicalContent = upsertExternalLinkInContent(canonicalContent, node.link);
  }

  // Set ID
  root.set(NODE_KEYS.ID, node.id);

  // Position (LWW)
  const position = new Y.Map<number>();
  position.set('x', node.x);
  position.set('y', node.y);
  root.set(NODE_KEYS.POSITION, position);

  // Dimensions (LWW)
  const dimensions = new Y.Map<number>();
  dimensions.set('width', node.width ?? 300);
  dimensions.set('height', node.height ?? 200);
  root.set(NODE_KEYS.DIMENSIONS, dimensions);

  // Visual properties (LWW)
  const visual = new Y.Map<string>();
  visual.set('type', node.type);
  if (node.color) visual.set('color', node.color);
  root.set(NODE_KEYS.VISUAL, visual);

  // Metadata (LWW)
  // Note: title is derived from content's first # heading, not stored separately
  const metadata = new Y.Map<any>();
  if (node.scopeId) metadata.set('scopeId', node.scopeId);
  if (node.parentId) metadata.set('parentId', node.parentId);
  if (node.summary) metadata.set('summary', node.summary);
  if (node.autoExpandDepth !== undefined) {
    metadata.set('autoExpandDepth', node.autoExpandDepth);
  }
  if (node.pinned) metadata.set('pinned', node.pinned);
  root.set(NODE_KEYS.METADATA, metadata);

  // Content (Text CRDT)
  const content = new Y.Text();
  content.insert(0, canonicalContent);
  root.set(NODE_KEYS.CONTENT, content);

  // Edges (Set CRDT)
  const edges = new Y.Array<EmbeddedEdge>();
  if (node.edges) {
    edges.push(node.edges);
  }
  root.set(NODE_KEYS.EDGES, edges);
}

/**
 * Convert a Yjs document back to a GraphNode
 */
export function documentToNode(doc: Y.Doc): GraphNode {
  const root = doc.getMap('root');

  const id = root.get(NODE_KEYS.ID) as string;
  const position = root.get(NODE_KEYS.POSITION) as Y.Map<number>;
  const dimensions = root.get(NODE_KEYS.DIMENSIONS) as Y.Map<number>;
  const visual = root.get(NODE_KEYS.VISUAL) as Y.Map<string>;
  const metadata = root.get(NODE_KEYS.METADATA) as Y.Map<any>;
  const content = root.get(NODE_KEYS.CONTENT) as Y.Text;
  const legacyAliases = root.get(NODE_KEYS.ALIASES) as Y.Array<string>;
  const edges = root.get(NODE_KEYS.EDGES) as Y.Array<EmbeddedEdge>;
  const legacyMessages = root.get(NODE_KEYS.MESSAGES) as Y.Array<ChatMessage>;

  const node: GraphNode = {
    id,
    type: (visual?.get('type') as NodeType) || NodeType.NOTE,
    x: position?.get('x') ?? 0,
    y: position?.get('y') ?? 0,
    content: content?.toString() || '',
  };

  // Optional dimensions
  if (dimensions) {
    const width = dimensions.get('width');
    const height = dimensions.get('height');
    if (width !== undefined) node.width = width;
    if (height !== undefined) node.height = height;
  }

  // Optional visual
  if (visual) {
    const color = visual.get('color') as NodeColor | undefined;
    if (color) node.color = color;
  }

  // Optional metadata
  // Note: title is derived from content's first # heading, not stored in metadata
  if (metadata) {
    const scopeId = metadata.get('scopeId');
    const parentId = metadata.get('parentId');
    const link = metadata.get('link');
    const summary = metadata.get('summary');
    const autoExpandDepth = metadata.get('autoExpandDepth');
    const pinned = metadata.get('pinned');

    if (scopeId) node.scopeId = scopeId;
    if (parentId) node.parentId = parentId;
    if (summary) node.summary = summary;
    if (autoExpandDepth !== undefined) node.autoExpandDepth = autoExpandDepth;
    if (pinned) node.pinned = pinned;

    // Legacy metadata.link: fold into body so derived field is canonical.
    if (typeof link === 'string' && link.trim()) {
      node.content = upsertExternalLinkInContent(node.content, link);
    }
  }

  // Optional edges
  if (edges && edges.length > 0) {
    node.edges = edges.toArray();
  }

  // Legacy aliases/messages: fold into body if content doesn't already encode them.
  if (legacyAliases && legacyAliases.length > 0 && deriveAliasesFromContent(node.content).length === 0) {
    node.content = setAliasesInContent(node.content, legacyAliases.toArray());
  }

  if (
    node.type === NodeType.CHAT &&
    legacyMessages &&
    legacyMessages.length > 0 &&
    !(deriveChatMessagesFromContent(node.content)?.length)
  ) {
    node.content = composeChatContentFromMessages(
      node.content,
      legacyMessages.toArray().map((m) => ({ role: m.role, text: m.text }))
    );
  }

  return withDerivedContentFields(node);
}

/**
 * Update position in a Yjs document (LWW)
 */
export function updatePosition(doc: Y.Doc, x: number, y: number): void {
  const root = doc.getMap('root');
  const position = root.get(NODE_KEYS.POSITION) as Y.Map<number>;
  if (position) {
    doc.transact(() => {
      position.set('x', x);
      position.set('y', y);
    });
  }
}

/**
 * Update dimensions in a Yjs document (LWW)
 */
export function updateDimensions(doc: Y.Doc, width: number, height: number): void {
  const root = doc.getMap('root');
  const dimensions = root.get(NODE_KEYS.DIMENSIONS) as Y.Map<number>;
  if (dimensions) {
    doc.transact(() => {
      dimensions.set('width', width);
      dimensions.set('height', height);
    });
  }
}

/**
 * Update content in a Yjs document (Text CRDT)
 */
export function updateContent(doc: Y.Doc, newContent: string): void {
  const root = doc.getMap('root');
  const content = root.get(NODE_KEYS.CONTENT) as Y.Text;
  if (content) {
    doc.transact(() => {
      content.delete(0, content.length);
      content.insert(0, newContent);
    });
  }
}

function getContentText(doc: Y.Doc): string {
  const root = doc.getMap('root');
  const content = root.get(NODE_KEYS.CONTENT) as Y.Text;
  return content?.toString() || '';
}

/**
 * Update color in a Yjs document (LWW)
 */
export function updateColor(doc: Y.Doc, color: NodeColor): void {
  const root = doc.getMap('root');
  const visual = root.get(NODE_KEYS.VISUAL) as Y.Map<string>;
  if (visual) {
    visual.set('color', color);
  }
}

/**
 * Add an alias by mutating markdown body content.
 */
export function addAlias(doc: Y.Doc, alias: string): void {
  const current = getContentText(doc);
  const next = appendAliasToContent(current, alias);
  if (next !== current) {
    updateContent(doc, next);
  }
}

/**
 * Remove an alias by mutating markdown body content.
 */
export function removeAlias(doc: Y.Doc, alias: string): void {
  const current = getContentText(doc);
  const next = removeAliasFromContent(current, alias);
  if (next !== current) {
    updateContent(doc, next);
  }
}

/**
 * Add an edge (Set CRDT - deduplicates by id)
 */
export function addEdge(doc: Y.Doc, edge: EmbeddedEdge): void {
  const root = doc.getMap('root');
  const edges = root.get(NODE_KEYS.EDGES) as Y.Array<EmbeddedEdge>;
  if (edges) {
    const existing = edges.toArray();
    if (!existing.some((e) => e.id === edge.id)) {
      edges.push([edge]);
    }
  }
}

/**
 * Remove an edge by id
 */
export function removeEdge(doc: Y.Doc, edgeId: string): void {
  const root = doc.getMap('root');
  const edges = root.get(NODE_KEYS.EDGES) as Y.Array<EmbeddedEdge>;
  if (edges) {
    const arr = edges.toArray();
    const index = arr.findIndex((e) => e.id === edgeId);
    if (index !== -1) {
      edges.delete(index, 1);
    }
  }
}

/**
 * Update edges (replace all)
 */
export function updateEdges(doc: Y.Doc, newEdges: EmbeddedEdge[]): void {
  const root = doc.getMap('root');
  const edges = root.get(NODE_KEYS.EDGES) as Y.Array<EmbeddedEdge>;
  if (edges) {
    doc.transact(() => {
      edges.delete(0, edges.length);
      edges.push(newEdges);
    });
  }
}

/**
 * Add a message to a CHAT node by mutating markdown body content.
 */
export function addMessage(doc: Y.Doc, message: ChatMessage): void {
  const current = getContentText(doc);
  const existing = deriveChatMessagesFromContent(current) || [];
  const next = composeChatContentFromMessages(
    current,
    [...existing, message].map((m) => ({ role: m.role, text: m.text }))
  );
  if (next !== current) {
    updateContent(doc, next);
  }
}

/**
 * Update messages (replace all) by mutating markdown body content.
 */
export function updateMessages(doc: Y.Doc, newMessages: ChatMessage[]): void {
  const current = getContentText(doc);
  const next = composeChatContentFromMessages(
    current,
    newMessages.map((m) => ({ role: m.role, text: m.text }))
  );
  if (next !== current) {
    updateContent(doc, next);
  }
}

/**
 * Apply a partial update to a node document
 * This handles the CRDT strategy per field type
 */
export function applyNodeUpdate(doc: Y.Doc, updates: Partial<GraphNode>): void {
  doc.transact(() => {
    const root = doc.getMap('root');

    if (updates.x !== undefined || updates.y !== undefined) {
      const position = root.get(NODE_KEYS.POSITION) as Y.Map<number>;
      if (position) {
        if (updates.x !== undefined) position.set('x', updates.x);
        if (updates.y !== undefined) position.set('y', updates.y);
      }
    }

    if (updates.width !== undefined || updates.height !== undefined) {
      const dimensions = root.get(NODE_KEYS.DIMENSIONS) as Y.Map<number>;
      if (dimensions) {
        if (updates.width !== undefined) dimensions.set('width', updates.width);
        if (updates.height !== undefined) dimensions.set('height', updates.height);
      }
    }

    if (updates.color !== undefined) {
      updateColor(doc, updates.color);
    }

    if (
      updates.content !== undefined ||
      updates.aliases !== undefined ||
      updates.messages !== undefined ||
      updates.link !== undefined
    ) {
      const contentText = getContentText(doc);
      let nextContent =
        updates.content !== undefined ? updates.content : contentText;

      if (updates.aliases !== undefined) {
        nextContent = setAliasesInContent(nextContent, updates.aliases);
      }

      if (updates.messages !== undefined) {
        nextContent = composeChatContentFromMessages(
          nextContent,
          updates.messages.map((m) => ({ role: m.role, text: m.text }))
        );
      }

      if (updates.link !== undefined) {
        if (typeof updates.link === 'string' && updates.link.trim()) {
          nextContent = upsertExternalLinkInContent(nextContent, updates.link);
        } else {
          nextContent = removeFirstExternalLinkFromContent(nextContent);
        }
      }

      if (nextContent !== contentText) {
        const content = root.get(NODE_KEYS.CONTENT) as Y.Text;
        if (content) {
          content.delete(0, content.length);
          content.insert(0, nextContent);
        }
      }
    }

    if (updates.edges !== undefined) {
      updateEdges(doc, updates.edges);
    }

    // Handle metadata updates
    // Note: title is derived from content's first # heading, not stored in metadata
    if (
      updates.scopeId !== undefined ||
      updates.parentId !== undefined ||
      updates.summary !== undefined ||
      updates.autoExpandDepth !== undefined ||
      updates.pinned !== undefined
    ) {
      const metadata = root.get(NODE_KEYS.METADATA) as Y.Map<any>;
      if (metadata) {
        if (updates.scopeId !== undefined) metadata.set('scopeId', updates.scopeId);
        if (updates.parentId !== undefined) metadata.set('parentId', updates.parentId);
        if (updates.summary !== undefined) metadata.set('summary', updates.summary);
        if (updates.autoExpandDepth !== undefined) {
          metadata.set('autoExpandDepth', updates.autoExpandDepth);
        }
        if (updates.pinned !== undefined) metadata.set('pinned', updates.pinned);
      }
    }
  });
}
