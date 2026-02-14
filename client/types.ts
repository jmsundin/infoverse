export enum NodeType {
  NOTE = 'NOTE',
  CHAT = 'CHAT'
}

export type NodeColor = 'slate' | 'red' | 'green' | 'blue' | 'amber' | 'purple';

export type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export type LODLevel = 'DETAIL' | 'TITLE';

export type EdgeStyle = 'default' | 'sankey-lr';

// Node loading state for viewport-based lazy loading
export type NodeLoadState = 'position-only' | 'loading' | 'loaded' | 'error';

// Embedded edge stored in node's markdown frontmatter (outgoing edges only)
export interface EmbeddedEdge {
  id: string;
  target: string;
  label: string;
  scopeId?: string;
}

// Persisted fields (stored in markdown frontmatter).
// See docs/markdown-node-schema-v2.md for the canonical file contract.
export interface GraphNodeFrontmatter {
  id: string;
  type: NodeType;
  x: number;
  y: number;
  width?: number;
  height?: number;
  color?: NodeColor;
  pinned?: boolean;
  scopeId?: string | null; // For hierarchical scoping (viewport)
  parentId?: string | null; // For outline tree hierarchy (expansion/creation parent)
  edges?: EmbeddedEdge[]; // Labeled outgoing edges stored with this node
  autoExpandDepth?: number; // Number of levels to automatically expand
}

// Runtime node with derived fields (not persisted directly in frontmatter).
export interface GraphNode extends GraphNodeFrontmatter {
  // Content fields (body is source of truth, but these are parsed for runtime use)
  content: string; // The markdown body content
  title?: string; // Derived from first # heading in body

  // Runtime-derived fields (parsed from body, not in frontmatter)
  // For CHAT nodes: messages parsed from body (**role**: text format)
  messages?: ChatMessage[];
  // Aliases derived from wiki-links in body
  aliases?: string[];
  // External link (first markdown link in body, e.g. Wikipedia)
  link?: string;
  // Summary for display (can be derived from content or AI-generated)
  summary?: string;

  // Viewport-based lazy loading state (runtime only)
  _loadState?: NodeLoadState;
  _loadError?: string;
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  timestamp: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string; // Relationship description
  scopeId?: string; // For hierarchical scoping
}

export interface ViewportTransform {
  x: number;
  y: number;
  k: number;
}

export interface SelectionTooltipState {
  x: number;
  y: number;
  bottom?: number;
  text: string;
  sourceId?: string;
}

export interface ExpandResponse {
  mainTopic?: string; // For summary of long text inputs
  nodes: {
    name: string;
    description: string;
    type: 'concept' | 'entity';
    wikiLink?: string;
  }[];
  edges: {
    targetName: string; // Corresponds to a name in the nodes array
    relationship: string;
  }[];
}

// Duplicate detection types
export interface DuplicateMatch {
  id: string;
  content: string;
  summary: string;
  similarity: number;
}

export interface DuplicateCheckResult {
  proposedIndex: number;
  proposedName: string;
  matches: DuplicateMatch[];
}

export interface PendingExpansion {
  sourceNodeId: string;
  sourceNode: GraphNode;
  result: ExpandResponse;
  duplicates: DuplicateCheckResult[];
  isWikidata?: boolean;
  // For Wikidata expansions
  wikidataSubtopics?: Array<{
    id: string;
    label: string;
    description?: string;
    wikidataUrl: string;
  }>;
}

// Physics simulation configuration
export interface PhysicsConfig {
  physicsEnabled: boolean;          // Master toggle for physics simulation
  collisionOnly: boolean;           // If true: only resolve overlaps, no springs/gravity/repulsion
  springConstant: number;           // Hooke's law spring constant for edge attraction
  springLength: number;             // Ideal edge length (rest length)
  springDamping: number;            // Damping on spring forces
  gravityConstant: number;          // Pull toward subtree center
  subtreeRepulsionConstant: number; // Repulsion between subtree centroids
  collisionPadding: number;         // Padding for collision detection
  childFollowTightness: number;     // How tightly children follow dragged parent (0-1)
  velocityThreshold: number;        // Stop simulation when max velocity below this
  maxIterations: number;            // Maximum simulation ticks before forced stop
  dampingFactor: number;            // Velocity decay per tick (0-1)
}

// Triggers that start a physics simulation
export type SimulationTrigger =
  | 'drag-start'
  | 'node-creation'
  | 'node-expansion'
  | 'node-deletion'
  | 'manual-relayout'
  | 'manual-subtree';

// File System Access API Types
declare global {
  interface Window {
    showDirectoryPicker(options?: { mode?: 'read' | 'readwrite' }): Promise<FileSystemDirectoryHandle>;
  }

  interface FileSystemHandlePermissionDescriptor {
    mode?: 'read' | 'readwrite';
  }

  interface FileSystemHandle {
    readonly kind: 'file' | 'directory';
    readonly name: string;
    isSameEntry(other: FileSystemHandle): Promise<boolean>;
    queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
    requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  }

  interface FileSystemDirectoryHandle extends FileSystemHandle {
    values(): AsyncIterableIterator<FileSystemHandle>;
    getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>;
    removeEntry(name: string): Promise<void>;
  }

  interface FileSystemFileHandle extends FileSystemHandle {
    getFile(): Promise<File>;
    createWritable(): Promise<FileSystemWritableFileStream>;
  }

  interface FileSystemWritableFileStream extends WritableStream {
    write(data: any): Promise<void>;
    close(): Promise<void>;
  }
}
