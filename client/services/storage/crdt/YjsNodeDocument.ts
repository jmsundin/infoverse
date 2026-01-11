import * as Y from 'yjs';
import { GraphNode, EmbeddedEdge, ChatMessage, NodeType, NodeColor } from '../../../types';

/**
 * Structure of a Yjs document for a single node.
 *
 * CRDT Strategy:
 * - Position (x, y): LWW Register via Y.Map
 * - Dimensions (width, height): LWW Register via Y.Map
 * - Visual (color, type): LWW Register via Y.Map
 * - Metadata (parentId, link, etc.): LWW Register via Y.Map
 * - Content: Text CRDT via Y.Text
 * - Aliases: Set CRDT via Y.Array with deduplication
 * - Edges: Set CRDT via Y.Array with deduplication by id
 * - Messages: Ordered list via Y.Array
 */

// Keys for the top-level Y.Map in each document
export const NODE_KEYS = {
  ID: 'id',
  POSITION: 'position',
  DIMENSIONS: 'dimensions',
  VISUAL: 'visual',
  METADATA: 'metadata',
  CONTENT: 'content',
  ALIASES: 'aliases',
  EDGES: 'edges',
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
  const metadata = new Y.Map<any>();
  if (node.title) metadata.set('title', node.title);
  if (node.parentId) metadata.set('parentId', node.parentId);
  if (node.link) metadata.set('link', node.link);
  if (node.summary) metadata.set('summary', node.summary);
  if (node.autoExpandDepth !== undefined) {
    metadata.set('autoExpandDepth', node.autoExpandDepth);
  }
  if (node.clusterCount !== undefined) {
    metadata.set('clusterCount', node.clusterCount);
  }
  if (node.clusterIds) {
    metadata.set('clusterIds', node.clusterIds);
  }
  root.set(NODE_KEYS.METADATA, metadata);

  // Content (Text CRDT)
  const content = new Y.Text();
  content.insert(0, node.content || '');
  root.set(NODE_KEYS.CONTENT, content);

  // Aliases (Set CRDT)
  const aliases = new Y.Array<string>();
  if (node.aliases) {
    aliases.push(node.aliases);
  }
  root.set(NODE_KEYS.ALIASES, aliases);

  // Edges (Set CRDT)
  const edges = new Y.Array<EmbeddedEdge>();
  if (node.edges) {
    edges.push(node.edges);
  }
  root.set(NODE_KEYS.EDGES, edges);

  // Messages (Ordered list for CHAT nodes)
  const messages = new Y.Array<ChatMessage>();
  if (node.messages) {
    messages.push(node.messages);
  }
  root.set(NODE_KEYS.MESSAGES, messages);
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
  const aliases = root.get(NODE_KEYS.ALIASES) as Y.Array<string>;
  const edges = root.get(NODE_KEYS.EDGES) as Y.Array<EmbeddedEdge>;
  const messages = root.get(NODE_KEYS.MESSAGES) as Y.Array<ChatMessage>;

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
  if (metadata) {
    const title = metadata.get('title');
    const parentId = metadata.get('parentId');
    const link = metadata.get('link');
    const summary = metadata.get('summary');
    const autoExpandDepth = metadata.get('autoExpandDepth');
    const clusterCount = metadata.get('clusterCount');
    const clusterIds = metadata.get('clusterIds');

    if (title) node.title = title;
    if (parentId) node.parentId = parentId;
    if (link) node.link = link;
    if (summary) node.summary = summary;
    if (autoExpandDepth !== undefined) node.autoExpandDepth = autoExpandDepth;
    if (clusterCount !== undefined) node.clusterCount = clusterCount;
    if (clusterIds) node.clusterIds = clusterIds;
  }

  // Optional aliases
  if (aliases && aliases.length > 0) {
    node.aliases = aliases.toArray();
  }

  // Optional edges
  if (edges && edges.length > 0) {
    node.edges = edges.toArray();
  }

  // Optional messages (CHAT nodes)
  if (messages && messages.length > 0) {
    node.messages = messages.toArray();
  }

  return node;
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
 * Add an alias (Set CRDT - deduplicates)
 */
export function addAlias(doc: Y.Doc, alias: string): void {
  const root = doc.getMap('root');
  const aliases = root.get(NODE_KEYS.ALIASES) as Y.Array<string>;
  if (aliases) {
    const existing = aliases.toArray();
    if (!existing.includes(alias)) {
      aliases.push([alias]);
    }
  }
}

/**
 * Remove an alias
 */
export function removeAlias(doc: Y.Doc, alias: string): void {
  const root = doc.getMap('root');
  const aliases = root.get(NODE_KEYS.ALIASES) as Y.Array<string>;
  if (aliases) {
    const arr = aliases.toArray();
    const index = arr.indexOf(alias);
    if (index !== -1) {
      aliases.delete(index, 1);
    }
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
 * Add a message to a CHAT node
 */
export function addMessage(doc: Y.Doc, message: ChatMessage): void {
  const root = doc.getMap('root');
  const messages = root.get(NODE_KEYS.MESSAGES) as Y.Array<ChatMessage>;
  if (messages) {
    messages.push([message]);
  }
}

/**
 * Update messages (replace all)
 */
export function updateMessages(doc: Y.Doc, newMessages: ChatMessage[]): void {
  const root = doc.getMap('root');
  const messages = root.get(NODE_KEYS.MESSAGES) as Y.Array<ChatMessage>;
  if (messages) {
    doc.transact(() => {
      messages.delete(0, messages.length);
      messages.push(newMessages);
    });
  }
}

/**
 * Apply a partial update to a node document
 * This handles the CRDT strategy per field type
 */
export function applyNodeUpdate(doc: Y.Doc, updates: Partial<GraphNode>): void {
  doc.transact(() => {
    if (updates.x !== undefined || updates.y !== undefined) {
      const root = doc.getMap('root');
      const position = root.get(NODE_KEYS.POSITION) as Y.Map<number>;
      if (position) {
        if (updates.x !== undefined) position.set('x', updates.x);
        if (updates.y !== undefined) position.set('y', updates.y);
      }
    }

    if (updates.width !== undefined || updates.height !== undefined) {
      const root = doc.getMap('root');
      const dimensions = root.get(NODE_KEYS.DIMENSIONS) as Y.Map<number>;
      if (dimensions) {
        if (updates.width !== undefined) dimensions.set('width', updates.width);
        if (updates.height !== undefined) dimensions.set('height', updates.height);
      }
    }

    if (updates.color !== undefined) {
      updateColor(doc, updates.color);
    }

    if (updates.content !== undefined) {
      updateContent(doc, updates.content);
    }

    if (updates.aliases !== undefined) {
      const root = doc.getMap('root');
      const aliases = root.get(NODE_KEYS.ALIASES) as Y.Array<string>;
      if (aliases) {
        aliases.delete(0, aliases.length);
        aliases.push(updates.aliases);
      }
    }

    if (updates.edges !== undefined) {
      updateEdges(doc, updates.edges);
    }

    if (updates.messages !== undefined) {
      updateMessages(doc, updates.messages);
    }

    // Handle metadata updates
    if (
      updates.title !== undefined ||
      updates.parentId !== undefined ||
      updates.link !== undefined ||
      updates.summary !== undefined ||
      updates.autoExpandDepth !== undefined ||
      updates.clusterCount !== undefined ||
      updates.clusterIds !== undefined
    ) {
      const root = doc.getMap('root');
      const metadata = root.get(NODE_KEYS.METADATA) as Y.Map<any>;
      if (metadata) {
        if (updates.title !== undefined) metadata.set('title', updates.title);
        if (updates.parentId !== undefined) metadata.set('parentId', updates.parentId);
        if (updates.link !== undefined) metadata.set('link', updates.link);
        if (updates.summary !== undefined) metadata.set('summary', updates.summary);
        if (updates.autoExpandDepth !== undefined) {
          metadata.set('autoExpandDepth', updates.autoExpandDepth);
        }
        if (updates.clusterCount !== undefined) {
          metadata.set('clusterCount', updates.clusterCount);
        }
        if (updates.clusterIds !== undefined) {
          metadata.set('clusterIds', updates.clusterIds);
        }
      }
    }
  });
}
