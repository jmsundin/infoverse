import * as Y from 'yjs';
import { GraphNode } from '../../../types';
import {
  createNodeDocument,
  initializeDocumentFromNode,
  documentToNode,
  applyNodeUpdate,
} from './YjsNodeDocument';

/**
 * YjsSyncEngine manages Yjs documents for nodes and handles CRDT merging.
 *
 * Key responsibilities:
 * - Maintain a Y.Doc per node for fine-grained sync
 * - Apply local updates to documents
 * - Merge remote updates using Yjs CRDT semantics
 * - Convert between GraphNode and Y.Doc representations
 */
export class YjsSyncEngine {
  private documents: Map<string, Y.Doc> = new Map();
  private observers: Map<string, Set<(node: GraphNode) => void>> = new Map();

  /**
   * Get or create a Yjs document for a node
   */
  getOrCreateDocument(nodeId: string): Y.Doc {
    let doc = this.documents.get(nodeId);
    if (!doc) {
      doc = createNodeDocument();
      this.documents.set(nodeId, doc);
    }
    return doc;
  }

  /**
   * Check if a document exists for a node
   */
  hasDocument(nodeId: string): boolean {
    return this.documents.has(nodeId);
  }

  /**
   * Initialize a document from a GraphNode (used for new nodes or initial load)
   */
  initializeFromNode(nodeId: string, node: GraphNode): Y.Doc {
    const doc = this.getOrCreateDocument(nodeId);
    initializeDocumentFromNode(doc, node);
    return doc;
  }

  /**
   * Apply a remote Yjs update to a node's document
   */
  applyRemoteUpdate(nodeId: string, update: Uint8Array): void {
    const doc = this.getOrCreateDocument(nodeId);
    Y.applyUpdate(doc, update);

    // Notify observers
    this.notifyObservers(nodeId);
  }

  /**
   * Apply multiple remote updates
   */
  applyRemoteUpdates(updates: Map<string, Uint8Array>): void {
    for (const [nodeId, update] of updates) {
      this.applyRemoteUpdate(nodeId, update);
    }
  }

  /**
   * Get the full state of a document as an update
   */
  getFullState(nodeId: string): Uint8Array | null {
    const doc = this.documents.get(nodeId);
    if (!doc) return null;
    return Y.encodeStateAsUpdate(doc);
  }

  /**
   * Get an incremental update since a given state vector
   */
  getUpdateSince(nodeId: string, stateVector: Uint8Array): Uint8Array | null {
    const doc = this.documents.get(nodeId);
    if (!doc) return null;
    return Y.encodeStateAsUpdate(doc, stateVector);
  }

  /**
   * Get the state vector for a document
   */
  getStateVector(nodeId: string): Uint8Array | null {
    const doc = this.documents.get(nodeId);
    if (!doc) return null;
    return Y.encodeStateVector(doc);
  }

  /**
   * Convert a Y.Doc to GraphNode
   */
  toGraphNode(nodeId: string): GraphNode | null {
    const doc = this.documents.get(nodeId);
    if (!doc) return null;
    return documentToNode(doc);
  }

  /**
   * Apply a partial update from local changes
   */
  applyLocalUpdate(nodeId: string, updates: Partial<GraphNode>): void {
    const doc = this.getOrCreateDocument(nodeId);
    applyNodeUpdate(doc, updates);

    // Notify observers
    this.notifyObservers(nodeId);
  }

  /**
   * Merge a local node with a remote node using CRDT semantics
   * Returns the merged node and the Yjs update to send to remote
   */
  mergeNodes(
    local: GraphNode,
    remote: GraphNode
  ): { merged: GraphNode; update: Uint8Array } {
    // Create documents for both nodes
    const localDoc = createNodeDocument();
    initializeDocumentFromNode(localDoc, local);

    const remoteDoc = createNodeDocument();
    initializeDocumentFromNode(remoteDoc, remote);

    // Get the state of both documents
    const localState = Y.encodeStateAsUpdate(localDoc);
    const remoteState = Y.encodeStateAsUpdate(remoteDoc);

    // Apply remote state to local document (Yjs handles merging)
    Y.applyUpdate(localDoc, remoteState);

    // Apply local state to remote document (for completeness)
    Y.applyUpdate(remoteDoc, localState);

    // The merged result
    const merged = documentToNode(localDoc);

    // Store the merged document
    this.documents.set(local.id, localDoc);

    // The update to send to remote is the local state
    return { merged, update: localState };
  }

  /**
   * Merge multiple remote nodes with local state
   */
  mergeRemoteNodes(
    localNodes: Map<string, GraphNode>,
    remoteNodes: GraphNode[]
  ): { mergedNodes: GraphNode[]; updates: Map<string, Uint8Array> } {
    const mergedNodes: GraphNode[] = [];
    const updates = new Map<string, Uint8Array>();

    for (const remote of remoteNodes) {
      const local = localNodes.get(remote.id);

      if (local) {
        // Node exists locally - merge
        const { merged, update } = this.mergeNodes(local, remote);
        mergedNodes.push(merged);
        updates.set(remote.id, update);
      } else {
        // Node only exists remotely - just store it
        const doc = this.initializeFromNode(remote.id, remote);
        mergedNodes.push(documentToNode(doc));
      }
    }

    return { mergedNodes, updates };
  }

  /**
   * Register an observer for node changes
   */
  observeNode(nodeId: string, callback: (node: GraphNode) => void): () => void {
    let observers = this.observers.get(nodeId);
    if (!observers) {
      observers = new Set();
      this.observers.set(nodeId, observers);
    }
    observers.add(callback);

    // Set up Yjs observer if not already done
    const doc = this.documents.get(nodeId);
    if (doc) {
      const root = doc.getMap('root');
      const handler = () => {
        const node = documentToNode(doc);
        callback(node);
      };
      root.observeDeep(handler);

      return () => {
        observers?.delete(callback);
        root.unobserveDeep(handler);
      };
    }

    return () => {
      observers?.delete(callback);
    };
  }

  /**
   * Notify all observers of a node change
   */
  private notifyObservers(nodeId: string): void {
    const observers = this.observers.get(nodeId);
    if (!observers) return;

    const node = this.toGraphNode(nodeId);
    if (!node) return;

    for (const callback of observers) {
      callback(node);
    }
  }

  /**
   * Remove a document (when node is deleted)
   */
  removeDocument(nodeId: string): void {
    this.documents.delete(nodeId);
    this.observers.delete(nodeId);
  }

  /**
   * Clear all documents
   */
  clear(): void {
    this.documents.clear();
    this.observers.clear();
  }

  /**
   * Get all document IDs
   */
  getDocumentIds(): string[] {
    return Array.from(this.documents.keys());
  }

  /**
   * Get count of documents
   */
  getDocumentCount(): number {
    return this.documents.size;
  }

  /**
   * Compact a document (remove tombstones to reduce size)
   */
  compactDocument(nodeId: string): void {
    const doc = this.documents.get(nodeId);
    if (!doc) return;

    // Get current node state
    const node = documentToNode(doc);

    // Create a fresh document
    const freshDoc = createNodeDocument();
    initializeDocumentFromNode(freshDoc, node);

    // Replace the old document
    this.documents.set(nodeId, freshDoc);
  }

  /**
   * Compact all documents
   */
  compactAll(): void {
    for (const nodeId of this.documents.keys()) {
      this.compactDocument(nodeId);
    }
  }

  /**
   * Get memory usage estimate
   */
  getMemoryUsage(): { totalBytes: number; documentCount: number } {
    let totalBytes = 0;

    for (const doc of this.documents.values()) {
      const state = Y.encodeStateAsUpdate(doc);
      totalBytes += state.byteLength;
    }

    return {
      totalBytes,
      documentCount: this.documents.size,
    };
  }
}
