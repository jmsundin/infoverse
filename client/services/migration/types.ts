import { GraphNode } from '../../types';

/**
 * Progress tracking for schema migration
 */
export interface MigrationProgress {
  isRunning: boolean;
  totalNodes: number;
  processedNodes: number;
  nodesNeedingUpdates: number;
  currentStatus: string;
  lastMigrationTimestamp: number | null;
  errors: MigrationError[];
}

/**
 * Error details for a specific node
 */
export interface MigrationError {
  nodeId: string;
  field: string;
  message: string;
}

/**
 * Result of validating a node against the schema
 */
export interface SchemaValidationResult {
  isValid: boolean;
  missingFields: string[];
  invalidFields: Array<{ field: string; reason: string }>;
  suggestedFixes: Partial<GraphNode>;
}

/**
 * Final result after migration completes
 */
export interface MigrationResult {
  totalProcessed: number;
  nodesUpdated: number;
  errors: MigrationError[];
  timestamp: number;
}
