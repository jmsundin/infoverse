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
  /** Fields from old schema that need migration */
  oldSchemaFields?: OldSchemaFields;
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

/**
 * Old chat message format (from frontmatter)
 */
export interface OldChatMessage {
  role: 'user' | 'model' | 'assistant' | 'system';
  text: string;
  timestamp?: number;
}

/**
 * Fields from old schema that need migration
 */
export interface OldSchemaFields {
  // Deprecated fields that may exist in old files
  title?: string;          // Now derived from body
  summary?: string;        // Removed, use embeddings
  aliases?: string[];      // Derived from wiki-links
  link?: string;           // Move to body as markdown
  messages?: OldChatMessage[]; // Convert to body format

  // Cluster fields (removed)
  clusterCount?: number;
  clusterIds?: string[];
  clusterMemberNodes?: unknown[];
  clusterInternalEdges?: unknown[];

  // Old field names
  outlineParentId?: string; // Now parentId
  // parentId in old schema was scopeId (when outlineParentId is absent)
}
