/**
 * SQLiteSchema - Database schema definitions and migrations
 *
 * Defines the split layout/content tables with R*Tree spatial index
 * and automatic triggers to keep the spatial index in sync.
 */

import { SQLiteService } from './SQLiteService';

export const SCHEMA_VERSION = 1;

/**
 * SQL statements to create the schema
 */
export const CREATE_TABLES_SQL = `
-- Layout table: small, frequently updated during drag
-- This is the source of truth for positions; R*Tree is derived index
CREATE TABLE IF NOT EXISTS node_layout (
  id TEXT PRIMARY KEY,                -- ULID
  x REAL NOT NULL,
  y REAL NOT NULL,
  width REAL DEFAULT 300,
  height REAL DEFAULT 200,
  pinned INTEGER DEFAULT 0,
  parent_id TEXT,                     -- For relative child positioning
  parent_offset_x REAL,               -- Offset from parent (if child)
  parent_offset_y REAL,
  scope_id TEXT,
  position_updated_at INTEGER NOT NULL,
  layout_materialized_at INTEGER,
  layout_hash TEXT                    -- xxhash of serialized layout for conflict detection
);

-- Content table: larger, less frequently updated
CREATE TABLE IF NOT EXISTS node_content (
  id TEXT PRIMARY KEY,                -- ULID, same as node_layout.id
  type TEXT NOT NULL DEFAULT 'NOTE',
  content TEXT,
  title TEXT,
  color TEXT,
  auto_expand_depth INTEGER,
  filename TEXT NOT NULL,
  file_mtime INTEGER,
  content_hash TEXT,                  -- xxhash of content for conflict detection
  content_updated_at INTEGER NOT NULL,
  content_materialized_at INTEGER
);

-- R*Tree spatial index - DERIVED from node_layout, maintained by triggers
CREATE VIRTUAL TABLE IF NOT EXISTS nodes_rtree USING rtree(
  id,                                 -- INTEGER rowid (auto-assigned by R*Tree)
  min_x, max_x,
  min_y, max_y
);

-- Mapping table for R*Tree (R*Tree uses INTEGER rowids, we have TEXT ULIDs)
CREATE TABLE IF NOT EXISTS node_layout_rtree_map (
  rowid INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id TEXT UNIQUE NOT NULL
);

-- Edges table with proper indexes
CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  label TEXT,
  scope_id TEXT,
  UNIQUE(source, target, label)
);

-- Sync outbox: structured for multi-device with ordering + idempotency
CREATE TABLE IF NOT EXISTS sync_outbox (
  local_seq INTEGER PRIMARY KEY AUTOINCREMENT,  -- Monotonic local sequence
  op_id TEXT UNIQUE NOT NULL,                   -- ULID for idempotency
  device_id TEXT NOT NULL,
  workspace_id TEXT,
  operation TEXT NOT NULL,                       -- 'INSERT', 'UPDATE', 'DELETE'
  entity_type TEXT NOT NULL,                     -- 'node_layout', 'node_content', 'edge'
  entity_id TEXT NOT NULL,
  payload TEXT NOT NULL,                         -- JSON, versioned
  payload_version INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL,
  synced_at INTEGER                              -- NULL = pending, timestamp = synced
);

-- Deleted nodes for undo
CREATE TABLE IF NOT EXISTS deleted_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id TEXT NOT NULL,
  layout_data TEXT NOT NULL,           -- JSON snapshot of node_layout
  content_data TEXT NOT NULL,          -- JSON snapshot of node_content
  edges_data TEXT,                     -- JSON array of connected edges
  deleted_at INTEGER NOT NULL
);

-- Schema version for migrations
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
`;

/**
 * SQL statements to create indexes
 */
export const CREATE_INDEXES_SQL = `
-- node_layout indexes
CREATE INDEX IF NOT EXISTS idx_node_layout_scope ON node_layout(scope_id);
CREATE INDEX IF NOT EXISTS idx_node_layout_parent ON node_layout(parent_id);
CREATE INDEX IF NOT EXISTS idx_node_layout_updated ON node_layout(position_updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_node_layout_materialized ON node_layout(layout_materialized_at);

-- node_content indexes
CREATE INDEX IF NOT EXISTS idx_node_content_filename ON node_content(filename);
CREATE INDEX IF NOT EXISTS idx_node_content_updated ON node_content(content_updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_node_content_materialized ON node_content(content_materialized_at);

-- Edge indexes
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target);
CREATE INDEX IF NOT EXISTS idx_edges_scope ON edges(scope_id);

-- Sync outbox indexes
CREATE INDEX IF NOT EXISTS idx_outbox_pending ON sync_outbox(synced_at) WHERE synced_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_outbox_entity ON sync_outbox(entity_type, entity_id);

-- Deleted nodes index
CREATE INDEX IF NOT EXISTS idx_deleted_nodes_time ON deleted_nodes(deleted_at DESC);
`;

/**
 * SQL statements to create triggers that keep R*Tree in sync with node_layout
 */
export const CREATE_TRIGGERS_SQL = `
-- Trigger: INSERT on node_layout -> INSERT into R*Tree
CREATE TRIGGER IF NOT EXISTS node_layout_insert_rtree
AFTER INSERT ON node_layout
BEGIN
  INSERT INTO node_layout_rtree_map (node_id) VALUES (NEW.id);
  INSERT INTO nodes_rtree (id, min_x, max_x, min_y, max_y)
  SELECT rowid, NEW.x, NEW.x + NEW.width, NEW.y, NEW.y + NEW.height
  FROM node_layout_rtree_map WHERE node_id = NEW.id;
END;

-- Trigger: UPDATE position on node_layout -> UPDATE R*Tree
CREATE TRIGGER IF NOT EXISTS node_layout_update_rtree
AFTER UPDATE OF x, y, width, height ON node_layout
BEGIN
  UPDATE nodes_rtree SET
    min_x = NEW.x,
    max_x = NEW.x + NEW.width,
    min_y = NEW.y,
    max_y = NEW.y + NEW.height
  WHERE id = (SELECT rowid FROM node_layout_rtree_map WHERE node_id = NEW.id);
END;

-- Trigger: DELETE on node_layout -> DELETE from R*Tree
CREATE TRIGGER IF NOT EXISTS node_layout_delete_rtree
AFTER DELETE ON node_layout
BEGIN
  DELETE FROM nodes_rtree WHERE id = (SELECT rowid FROM node_layout_rtree_map WHERE node_id = OLD.id);
  DELETE FROM node_layout_rtree_map WHERE node_id = OLD.id;
END;
`;

/**
 * Initialize the database schema
 * Creates tables, indexes, and triggers if they don't exist
 */
export async function initializeSchema(db: SQLiteService): Promise<void> {
  const currentVersion = getSchemaVersion(db);

  if (currentVersion === 0) {
    // Fresh database - create everything
    console.log('[SQLiteSchema] Initializing fresh database schema');

    db.transaction(() => {
      // Create tables
      db.run(CREATE_TABLES_SQL);

      // Create indexes
      db.run(CREATE_INDEXES_SQL);

      // Create triggers
      const triggerStatements = CREATE_TRIGGERS_SQL.split(/(?=CREATE TRIGGER)/);
      for (const stmt of triggerStatements) {
        if (stmt.trim()) {
          db.run(stmt);
        }
      }

      // Set schema version
      db.run('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)', [
        SCHEMA_VERSION,
        Date.now(),
      ]);
    });

    console.log('[SQLiteSchema] Schema initialized at version', SCHEMA_VERSION);
  } else if (currentVersion < SCHEMA_VERSION) {
    // Need migration
    console.log('[SQLiteSchema] Migrating from version', currentVersion, 'to', SCHEMA_VERSION);
    await runMigrations(db, currentVersion, SCHEMA_VERSION);
  } else {
    console.log('[SQLiteSchema] Schema up to date at version', currentVersion);
  }
}

/**
 * Get the current schema version
 */
export function getSchemaVersion(db: SQLiteService): number {
  try {
    const result = db.queryScalar<number>('SELECT MAX(version) FROM schema_version');
    return result ?? 0;
  } catch {
    // Table doesn't exist yet
    return 0;
  }
}

/**
 * Run schema migrations
 */
async function runMigrations(
  db: SQLiteService,
  fromVersion: number,
  toVersion: number
): Promise<void> {
  // Migrations will be added here as schema evolves
  // Each migration is a function that takes the db and applies changes

  const migrations: Record<number, (db: SQLiteService) => void> = {
    // Example: Migration from v1 to v2
    // 2: (db) => {
    //   db.run('ALTER TABLE node_content ADD COLUMN new_field TEXT');
    // },
  };

  for (let version = fromVersion + 1; version <= toVersion; version++) {
    const migration = migrations[version];
    if (migration) {
      console.log(`[SQLiteSchema] Running migration to version ${version}`);
      db.transaction(() => {
        migration(db);
        db.run('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)', [
          version,
          Date.now(),
        ]);
      });
    }
  }
}

/**
 * Verify schema integrity
 * Returns true if all expected tables and indexes exist
 */
export function verifySchema(db: SQLiteService): boolean {
  const expectedTables = [
    'node_layout',
    'node_content',
    'nodes_rtree',
    'node_layout_rtree_map',
    'edges',
    'sync_outbox',
    'deleted_nodes',
    'schema_version',
  ];

  for (const table of expectedTables) {
    const exists = db.queryScalar<number>(
      `SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?`,
      [table]
    );
    if (!exists) {
      console.error(`[SQLiteSchema] Missing table: ${table}`);
      return false;
    }
  }

  // Verify triggers exist
  const expectedTriggers = [
    'node_layout_insert_rtree',
    'node_layout_update_rtree',
    'node_layout_delete_rtree',
  ];

  for (const trigger of expectedTriggers) {
    const exists = db.queryScalar<number>(
      `SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name=?`,
      [trigger]
    );
    if (!exists) {
      console.error(`[SQLiteSchema] Missing trigger: ${trigger}`);
      return false;
    }
  }

  return true;
}

/**
 * Reset the database (drop all data but keep schema)
 * WARNING: This is destructive!
 */
export function resetData(db: SQLiteService): void {
  db.transaction(() => {
    db.run('DELETE FROM sync_outbox');
    db.run('DELETE FROM deleted_nodes');
    db.run('DELETE FROM edges');
    db.run('DELETE FROM node_content');
    db.run('DELETE FROM node_layout'); // Triggers will clean up R*Tree
  });
}

/**
 * Get database statistics
 */
export function getStats(db: SQLiteService): {
  nodeCount: number;
  edgeCount: number;
  pendingSyncCount: number;
  deletedCount: number;
  dbSizeBytes: number;
} {
  return {
    nodeCount: db.queryScalar<number>('SELECT COUNT(*) FROM node_layout') ?? 0,
    edgeCount: db.queryScalar<number>('SELECT COUNT(*) FROM edges') ?? 0,
    pendingSyncCount:
      db.queryScalar<number>('SELECT COUNT(*) FROM sync_outbox WHERE synced_at IS NULL') ?? 0,
    deletedCount: db.queryScalar<number>('SELECT COUNT(*) FROM deleted_nodes') ?? 0,
    dbSizeBytes: db.queryScalar<number>('SELECT page_count * page_size FROM pragma_page_count(), pragma_page_size()') ?? 0,
  };
}
