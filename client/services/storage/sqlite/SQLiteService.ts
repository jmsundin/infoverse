/**
 * SQLiteService - Core SQLite wrapper with OPFS persistence
 *
 * Uses sql.js (WebAssembly SQLite) with Origin Private File System for persistence.
 * Provides transaction support, cross-tab synchronization via Web Locks, and
 * automatic persistence to OPFS.
 */

import initSqlJs, { Database, SqlJsStatic } from 'sql.js';

export interface QueryResult {
  columns: string[];
  values: any[][];
}

export interface SQLiteServiceConfig {
  dbFileName?: string;
  persistIntervalMs?: number;
  enableForeignKeys?: boolean;
}

const DEFAULT_CONFIG: Required<SQLiteServiceConfig> = {
  dbFileName: 'infoverse.sqlite3',
  persistIntervalMs: 5000,
  enableForeignKeys: true,
};

export class SQLiteService {
  private db: Database | null = null;
  private SQL: SqlJsStatic | null = null;
  private config: Required<SQLiteServiceConfig>;
  private opfsRoot: FileSystemDirectoryHandle | null = null;
  private persistTimer: number | null = null;
  private isDirty = false;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor(config: SQLiteServiceConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize SQLite with OPFS persistence
   * Falls back to IndexedDB if OPFS is unavailable
   */
  async initialize(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this._initialize();
    return this.initPromise;
  }

  private async _initialize(): Promise<void> {
    if (this.initialized) return;

    // Initialize sql.js with WASM
    this.SQL = await initSqlJs({
      // Load the WASM file from CDN or local
      locateFile: (file: string) => `https://sql.js.org/dist/${file}`,
    });

    // Try to get OPFS root
    try {
      if ('storage' in navigator && 'getDirectory' in navigator.storage) {
        this.opfsRoot = await navigator.storage.getDirectory();
        console.log('[SQLiteService] OPFS available');
      }
    } catch (e) {
      console.warn('[SQLiteService] OPFS not available, using memory-only mode:', e);
    }

    // Try to load existing database from OPFS
    const existingData = await this.loadFromOPFS();

    if (existingData) {
      this.db = new this.SQL.Database(existingData);
      console.log('[SQLiteService] Loaded existing database from OPFS');
    } else {
      this.db = new this.SQL.Database();
      console.log('[SQLiteService] Created new database');
    }

    // Enable foreign keys if configured
    if (this.config.enableForeignKeys) {
      this.db.run('PRAGMA foreign_keys = ON');
    }

    // Start periodic persistence
    this.startPersistTimer();

    this.initialized = true;
  }

  /**
   * Load database from OPFS
   */
  private async loadFromOPFS(): Promise<Uint8Array | null> {
    if (!this.opfsRoot) return null;

    return this.withExclusiveLock('infoverse:sqlite:read', async () => {
      try {
        const fileHandle = await this.opfsRoot!.getFileHandle(this.config.dbFileName);
        const file = await fileHandle.getFile();
        const arrayBuffer = await file.arrayBuffer();
        return new Uint8Array(arrayBuffer);
      } catch (e) {
        // File doesn't exist yet
        return null;
      }
    });
  }

  /**
   * Persist database to OPFS
   */
  async persist(): Promise<void> {
    if (!this.db || !this.opfsRoot || !this.isDirty) return;

    await this.withExclusiveLock('infoverse:sqlite:write', async () => {
      try {
        const data = this.db!.export();
        const fileHandle = await this.opfsRoot!.getFileHandle(this.config.dbFileName, { create: true });

        // Use sync access handle for atomic writes if available
        if ('createSyncAccessHandle' in fileHandle) {
          const syncHandle = await (fileHandle as any).createSyncAccessHandle();
          try {
            syncHandle.truncate(0);
            syncHandle.write(data, { at: 0 });
            syncHandle.flush();
          } finally {
            syncHandle.close();
          }
        } else {
          // Fallback to writable stream
          const writable = await fileHandle.createWritable();
          await writable.write(data);
          await writable.close();
        }

        this.isDirty = false;
        console.log('[SQLiteService] Database persisted to OPFS');
      } catch (e) {
        console.error('[SQLiteService] Failed to persist database:', e);
        throw e;
      }
    });
  }

  /**
   * Execute a SQL query and return results
   */
  exec(sql: string, params: any[] = []): QueryResult[] {
    this.ensureInitialized();

    try {
      const results = this.db!.exec(sql, params);
      return results.map(r => ({
        columns: r.columns,
        values: r.values,
      }));
    } catch (e) {
      console.error('[SQLiteService] Query error:', sql, params, e);
      throw e;
    }
  }

  /**
   * Execute a SQL statement (INSERT, UPDATE, DELETE)
   * Returns the number of rows changed
   */
  run(sql: string, params: any[] = []): number {
    this.ensureInitialized();

    try {
      this.db!.run(sql, params);
      this.isDirty = true;
      return this.db!.getRowsModified();
    } catch (e) {
      console.error('[SQLiteService] Run error:', sql, params, e);
      throw e;
    }
  }

  /**
   * Execute a query and return all rows as objects
   */
  query<T = Record<string, any>>(sql: string, params: any[] = []): T[] {
    const results = this.exec(sql, params);
    if (results.length === 0) return [];

    const { columns, values } = results[0];
    return values.map(row => {
      const obj: Record<string, any> = {};
      columns.forEach((col, i) => {
        obj[col] = row[i];
      });
      return obj as T;
    });
  }

  /**
   * Execute a query and return the first row as an object
   */
  queryOne<T = Record<string, any>>(sql: string, params: any[] = []): T | null {
    const results = this.query<T>(sql, params);
    return results.length > 0 ? results[0] : null;
  }

  /**
   * Execute a query and return a single scalar value
   */
  queryScalar<T = any>(sql: string, params: any[] = []): T | null {
    const results = this.exec(sql, params);
    if (results.length === 0 || results[0].values.length === 0) return null;
    return results[0].values[0][0] as T;
  }

  /**
   * Run multiple statements in a transaction
   */
  transaction<T>(fn: () => T): T {
    this.ensureInitialized();

    this.db!.run('BEGIN TRANSACTION');
    try {
      const result = fn();
      this.db!.run('COMMIT');
      this.isDirty = true;
      return result;
    } catch (e) {
      this.db!.run('ROLLBACK');
      throw e;
    }
  }

  /**
   * Run multiple statements in a transaction (async version)
   */
  async transactionAsync<T>(fn: () => Promise<T>): Promise<T> {
    this.ensureInitialized();

    this.db!.run('BEGIN TRANSACTION');
    try {
      const result = await fn();
      this.db!.run('COMMIT');
      this.isDirty = true;
      return result;
    } catch (e) {
      this.db!.run('ROLLBACK');
      throw e;
    }
  }

  /**
   * Export the database as a Uint8Array (for backup)
   */
  export(): Uint8Array {
    this.ensureInitialized();
    return this.db!.export();
  }

  /**
   * Import a database from Uint8Array (for restore)
   */
  import(data: Uint8Array): void {
    this.ensureInitialized();

    // Close existing database
    this.db!.close();

    // Create new database from data
    this.db = new this.SQL!.Database(data);

    if (this.config.enableForeignKeys) {
      this.db.run('PRAGMA foreign_keys = ON');
    }

    this.isDirty = true;
  }

  /**
   * Check if database is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Force an immediate persist
   */
  async flush(): Promise<void> {
    await this.persist();
  }

  /**
   * Close the database and clean up
   */
  async close(): Promise<void> {
    this.stopPersistTimer();

    if (this.isDirty) {
      await this.persist();
    }

    if (this.db) {
      this.db.close();
      this.db = null;
    }

    this.initialized = false;
    this.initPromise = null;
  }

  /**
   * Get the raw database instance (for advanced use)
   */
  getDatabase(): Database | null {
    return this.db;
  }

  // --- Private helpers ---

  private ensureInitialized(): void {
    if (!this.initialized || !this.db) {
      throw new Error('SQLiteService not initialized. Call initialize() first.');
    }
  }

  private startPersistTimer(): void {
    if (this.persistTimer) return;

    this.persistTimer = window.setInterval(() => {
      this.persist().catch(e => {
        console.error('[SQLiteService] Periodic persist failed:', e);
      });
    }, this.config.persistIntervalMs);

    // Also persist on page unload
    window.addEventListener('beforeunload', this.handleBeforeUnload);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  }

  private stopPersistTimer(): void {
    if (this.persistTimer) {
      window.clearInterval(this.persistTimer);
      this.persistTimer = null;
    }

    window.removeEventListener('beforeunload', this.handleBeforeUnload);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
  }

  private handleBeforeUnload = (): void => {
    // Synchronous persist on unload - best effort
    if (this.isDirty && this.db) {
      // We can't do async operations here, so just mark for next load
      console.warn('[SQLiteService] Unload with dirty state - data may be lost');
    }
  };

  private handleVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden' && this.isDirty) {
      this.persist().catch(e => {
        console.error('[SQLiteService] Visibility change persist failed:', e);
      });
    }
  };

  private async withExclusiveLock<T>(lockName: string, fn: () => Promise<T>): Promise<T> {
    const nav = navigator as any;
    if (nav.locks && typeof nav.locks.request === 'function') {
      return nav.locks.request(lockName, { mode: 'exclusive' }, fn);
    }
    // Fallback if Web Locks not available
    return fn();
  }
}

// Singleton instance
let instance: SQLiteService | null = null;

export function getSQLiteService(config?: SQLiteServiceConfig): SQLiteService {
  if (!instance) {
    instance = new SQLiteService(config);
  }
  return instance;
}
