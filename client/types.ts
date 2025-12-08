import React from 'react';

export enum NodeType {
  NOTE = 'NOTE',
  CHAT = 'CHAT'
}

export type NodeColor = 'slate' | 'red' | 'green' | 'blue' | 'amber' | 'purple';

export type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export type LODLevel = 'DETAIL' | 'TITLE' | 'CLUSTER';

export interface GraphNode {
  id: string;
  type: NodeType;
  x: number;
  y: number;
  content: string; // For NOTE, this is the text. For CHAT, initial context or title.
  messages?: ChatMessage[]; // Only for CHAT
  width?: number;
  height?: number;
  link?: string; // Wikipedia link
  color?: NodeColor;
  parentId?: string; // For hierarchical scoping
  summary?: string; // High-level summary for semantic zoom
  autoExpandDepth?: number; // Number of levels to automatically expand
  aliases?: string[]; // Alternative names for the node
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
  parentId?: string; // For hierarchical scoping
}

export interface ViewportTransform {
  x: number;
  y: number;
  k: number;
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