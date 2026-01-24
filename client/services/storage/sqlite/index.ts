/**
 * SQLite storage module exports
 */

export { SQLiteService, getSQLiteService, type QueryResult, type SQLiteServiceConfig } from './SQLiteService';
export { SQLiteSpatialIndex, type ViewportBounds, type SpatialQueryResult, type NodeLayoutRow, type NodeContentRow } from './SQLiteSpatialIndex';
export { SQLiteStorageAdapter, type SQLiteStorageAdapterConfig } from './SQLiteStorageAdapter';
export {
  initializeSchema,
  getSchemaVersion,
  verifySchema,
  resetData,
  getStats,
  SCHEMA_VERSION,
} from './SQLiteSchema';
export { MarkdownBootstrap, needsBootstrap, type BootstrapProgress, type BootstrapOptions } from './MarkdownBootstrap';
