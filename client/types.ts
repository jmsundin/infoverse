import React from 'react';

export enum NodeType {
  NOTE = 'NOTE',
  CHAT = 'CHAT',
  CLUSTER = 'CLUSTER'
}

export type NodeColor = 'slate' | 'red' | 'green' | 'blue' | 'amber' | 'purple';

export type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export type LODLevel = 'DETAIL' | 'TITLE' | 'CLUSTER';

export type EdgeStyle = 'default' | 'sankey-lr';

// Cluster visualization data types
export interface ClusterMemberNode {
  id: string;
  relativeX: number;  // 0-1 normalized position within cluster bounds
  relativeY: number;
  color: NodeColor;
  title?: string;
}

export interface ClusterInternalEdge {
  sourceId: string;
  targetId: string;
}

// Node loading state for viewport-based lazy loading
export type NodeLoadState = 'position-only' | 'loading' | 'loaded' | 'error';

// Embedded edge stored in node's markdown frontmatter (outgoing edges only)
export interface EmbeddedEdge {
  id: string;
  target: string;
  label: string;
}

export interface GraphNode {
  id: string;
  type: NodeType;
  x: number;
  y: number;
  title?: string; // AI-generated display title for LOD view and breadcrumbs
  content: string; // For NOTE, this is the text. For CHAT, initial context or title.
  messages?: ChatMessage[]; // Only for CHAT
  width?: number;
  height?: number;
  link?: string; // Wikipedia link
  color?: NodeColor;
  scopeId?: string; // For hierarchical scoping (viewport)
  parentId?: string; // For outline tree hierarchy (expansion/creation parent)
  summary?: string; // High-level summary for semantic zoom
  autoExpandDepth?: number; // Number of levels to automatically expand
  aliases?: string[]; // Alternative names for the node
  clusterCount?: number; // Number of nodes in this cluster
  clusterIds?: string[]; // IDs of nodes in this cluster
  clusterMemberNodes?: ClusterMemberNode[]; // Pre-computed mini-node data for visualization
  clusterInternalEdges?: ClusterInternalEdge[]; // Pre-computed internal edges for visualization
  edges?: EmbeddedEdge[]; // Outgoing edges stored with this node
  pinned?: boolean; // User-pinned anchor for physics simulation
  // Viewport-based lazy loading state
  _loadState?: NodeLoadState; // Tracks if full content has been loaded
  _loadError?: string; // Error message if loading failed
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

// Physics simulation configuration
export interface PhysicsConfig {
  physicsEnabled: boolean;          // Master toggle for physics simulation
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