import { GraphNode } from '../../types';
import { validateNodeSchema } from './schemaValidator';
import { MigrationProgress, MigrationResult, MigrationError } from './types';

type ProgressCallback = (progress: MigrationProgress) => void;

const BATCH_SIZE = 10; // Process 10 nodes per idle callback
const IDLE_TIMEOUT = 100; // Max 100ms timeout for requestIdleCallback

/**
 * MigrationService processes nodes in a non-blocking fashion using requestIdleCallback.
 * Validates all nodes against the current schema and auto-fixes issues.
 */
export class MigrationService {
  private running = false;
  private shouldCancel = false;
  private progressCallback: ProgressCallback | null = null;
  private edgeTargetIndex: Map<string, string[]> = new Map(); // target nodeId -> source nodeIds

  private progress: MigrationProgress = {
    isRunning: false,
    totalNodes: 0,
    processedNodes: 0,
    nodesNeedingUpdates: 0,
    currentStatus: 'Idle',
    lastMigrationTimestamp: null,
    errors: [],
  };

  /**
   * Build reverse edge index: maps target nodeId -> source nodeIds
   * This allows us to infer parentId for nodes that are targets of edges
   */
  private async buildEdgeTargetIndex(
    loadNode: (nodeId: string) => Promise<GraphNode | null>,
    nodeIds: string[]
  ): Promise<void> {
    this.edgeTargetIndex.clear();

    for (const nodeId of nodeIds) {
      if (this.shouldCancel) break;

      const node = await loadNode(nodeId);
      if (node?.edges) {
        for (const edge of node.edges) {
          const sources = this.edgeTargetIndex.get(edge.target) || [];
          sources.push(nodeId);
          this.edgeTargetIndex.set(edge.target, sources);
        }
      }
    }
  }

  /**
   * Start migration process.
   * Uses requestIdleCallback for non-blocking execution.
   */
  async runMigration(
    loadNode: (nodeId: string) => Promise<GraphNode | null>,
    saveNode: (node: GraphNode) => Promise<void>,
    getAllNodeIds: () => string[],
    onProgress: ProgressCallback
  ): Promise<MigrationResult> {
    if (this.running) {
      throw new Error('Migration already in progress');
    }

    this.running = true;
    this.shouldCancel = false;
    this.progressCallback = onProgress;

    const nodeIds = getAllNodeIds();
    const errors: MigrationError[] = [];
    let nodesUpdated = 0;

    this.progress = {
      isRunning: true,
      totalNodes: nodeIds.length,
      processedNodes: 0,
      nodesNeedingUpdates: 0,
      currentStatus: 'Building edge index...',
      lastMigrationTimestamp: null,
      errors: [],
    };
    this.emitProgress();

    // Phase 1: Build edge target index for parentId inference
    await this.buildEdgeTargetIndex(loadNode, nodeIds);

    this.progress.currentStatus = 'Starting migration...';
    this.emitProgress();

    try {
      // Process nodes in batches
      let i = 0;
      while (i < nodeIds.length && !this.shouldCancel) {
        const batchEnd = Math.min(i + BATCH_SIZE, nodeIds.length);
        const batch = nodeIds.slice(i, batchEnd);

        // Process this batch in an idle callback
        const batchUpdates = await this.processBatchInIdleCallback(
          batch,
          loadNode,
          saveNode,
          errors
        );
        nodesUpdated += batchUpdates;

        i = batchEnd;
        this.progress.processedNodes = i;
        this.progress.currentStatus = `Processing node ${i} of ${nodeIds.length}...`;
        this.emitProgress();
      }

      const timestamp = Date.now();
      this.progress = {
        ...this.progress,
        isRunning: false,
        currentStatus: this.shouldCancel ? 'Cancelled' : 'Complete',
        lastMigrationTimestamp: timestamp,
        errors,
      };
      this.emitProgress();

      // Persist last migration timestamp
      this.saveLastMigrationTimestamp(timestamp);

      return {
        totalProcessed: this.progress.processedNodes,
        nodesUpdated: this.progress.nodesNeedingUpdates,
        errors,
        timestamp,
      };
    } finally {
      this.running = false;
      this.progressCallback = null;
    }
  }

  /**
   * Process a batch of nodes in an idle callback for non-blocking execution
   */
  private processBatchInIdleCallback(
    nodeIds: string[],
    loadNode: (nodeId: string) => Promise<GraphNode | null>,
    saveNode: (node: GraphNode) => Promise<void>,
    errors: MigrationError[]
  ): Promise<number> {
    return new Promise((resolve) => {
      const processNodes = async () => {
        let updatedCount = 0;

        for (const nodeId of nodeIds) {
          if (this.shouldCancel) break;

          const wasUpdated = await this.processNode(nodeId, loadNode, saveNode, errors);
          if (wasUpdated) {
            updatedCount++;
          }
        }

        resolve(updatedCount);
      };

      // Use requestIdleCallback if available, otherwise fall back to setTimeout
      if ('requestIdleCallback' in window) {
        requestIdleCallback(
          () => {
            processNodes();
          },
          { timeout: IDLE_TIMEOUT }
        );
      } else {
        // Fallback for Safari
        setTimeout(() => {
          processNodes();
        }, 0);
      }
    });
  }

  /**
   * Process a single node - validate and fix if needed
   */
  private async processNode(
    nodeId: string,
    loadNode: (nodeId: string) => Promise<GraphNode | null>,
    saveNode: (node: GraphNode) => Promise<void>,
    errors: MigrationError[]
  ): Promise<boolean> {
    try {
      const node = await loadNode(nodeId);
      if (!node) {
        errors.push({ nodeId, field: 'node', message: 'Node not found' });
        return false;
      }

      // Get incoming edge sources for parentId inference
      const incomingEdgeSources = this.edgeTargetIndex.get(nodeId) || [];

      const validation = validateNodeSchema(node, { incomingEdgeSources });

      if (!validation.isValid || Object.keys(validation.suggestedFixes).length > 0) {
        // Apply fixes
        const fixedNode: GraphNode = {
          ...node,
          ...validation.suggestedFixes,
        };

        await saveNode(fixedNode);
        this.progress.nodesNeedingUpdates++;

        // Log validation issues
        for (const missing of validation.missingFields) {
          errors.push({ nodeId, field: missing, message: `Missing required field: ${missing}` });
        }
        for (const invalid of validation.invalidFields) {
          errors.push({ nodeId, field: invalid.field, message: invalid.reason });
        }

        return true;
      }

      return false;
    } catch (e) {
      errors.push({ nodeId, field: 'process', message: String(e) });
      return false;
    }
  }

  /**
   * Cancel running migration
   */
  cancel(): void {
    this.shouldCancel = true;
  }

  /**
   * Get current progress
   */
  getProgress(): MigrationProgress {
    return { ...this.progress };
  }

  /**
   * Check if migration is currently running
   */
  isRunning(): boolean {
    return this.running;
  }

  private emitProgress(): void {
    if (this.progressCallback) {
      this.progressCallback({ ...this.progress });
    }
  }

  private saveLastMigrationTimestamp(timestamp: number): void {
    try {
      localStorage.setItem('infoverse:lastMigration', String(timestamp));
    } catch {
      // Ignore storage errors
    }
  }

  getLastMigrationTimestamp(): number | null {
    try {
      const stored = localStorage.getItem('infoverse:lastMigration');
      return stored ? parseInt(stored, 10) : null;
    } catch {
      return null;
    }
  }
}

// Singleton instance
let migrationServiceInstance: MigrationService | null = null;

export function getMigrationService(): MigrationService {
  if (!migrationServiceInstance) {
    migrationServiceInstance = new MigrationService();
  }
  return migrationServiceInstance;
}
