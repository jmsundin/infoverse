import { GraphNode, GraphEdge } from '../../types';
import { DeletedNodeEntry, DeletionStack } from './types';
import yaml from 'js-yaml';

const STACK_FILENAME = '.infoverse-deleted-stack.md';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * DeletionStackService manages a stack of deleted nodes for soft delete functionality.
 * Deleted nodes are stored in a single file and can be restored via Ctrl+Z.
 * Entries older than 30 days are automatically pruned.
 */
export class DeletionStackService {
  private dirHandle: FileSystemDirectoryHandle | null = null;
  private stack: DeletionStack = { version: 1, entries: [] };
  private initialized = false;

  /**
   * Initialize the service with a directory handle
   */
  async initialize(dirHandle: FileSystemDirectoryHandle): Promise<void> {
    this.dirHandle = dirHandle;
    await this.loadStack();
    this.initialized = true;
  }

  /**
   * Check if the service is ready to use
   */
  isEnabled(): boolean {
    return this.initialized && this.dirHandle !== null;
  }

  /**
   * Get the number of entries in the deletion stack
   */
  getStackSize(): number {
    return this.stack.entries.length;
  }

  /**
   * Push a deleted node onto the stack
   */
  async pushDeletion(node: GraphNode, edges: GraphEdge[]): Promise<void> {
    if (!this.dirHandle) return;

    const entry: DeletedNodeEntry = {
      node,
      edges,
      deletedAt: Date.now(),
    };

    this.stack.entries.push(entry);
    await this.saveStack();
  }

  /**
   * Pop the most recently deleted node from the stack
   * Returns null if the stack is empty
   */
  async popDeletion(): Promise<DeletedNodeEntry | null> {
    if (!this.dirHandle || this.stack.entries.length === 0) {
      return null;
    }

    const entry = this.stack.entries.pop()!;
    await this.saveStack();
    return entry;
  }

  /**
   * Peek at the most recently deleted node without removing it
   */
  peekDeletion(): DeletedNodeEntry | null {
    if (this.stack.entries.length === 0) {
      return null;
    }
    return this.stack.entries[this.stack.entries.length - 1];
  }

  /**
   * Remove entries older than the specified age (defaults to 30 days)
   * Returns the number of entries pruned
   */
  async pruneOldEntries(maxAgeMs: number = THIRTY_DAYS_MS): Promise<number> {
    if (!this.dirHandle) return 0;

    const cutoff = Date.now() - maxAgeMs;
    const originalLength = this.stack.entries.length;

    this.stack.entries = this.stack.entries.filter(
      (entry) => entry.deletedAt > cutoff
    );

    const pruned = originalLength - this.stack.entries.length;

    if (pruned > 0) {
      await this.saveStack();
    }

    return pruned;
  }

  /**
   * Clear all entries from the stack
   */
  async clearStack(): Promise<void> {
    if (!this.dirHandle) return;

    this.stack.entries = [];
    await this.saveStack();
  }

  /**
   * Load the stack from the file system
   */
  private async loadStack(): Promise<void> {
    if (!this.dirHandle) return;

    try {
      const fileHandle = await this.dirHandle.getFileHandle(STACK_FILENAME);
      const file = await fileHandle.getFile();
      const text = await file.text();

      const parsed = this.parseStackFile(text);
      if (parsed) {
        this.stack = parsed;
      }
    } catch {
      // File doesn't exist or can't be read - start with empty stack
      this.stack = { version: 1, entries: [] };
    }
  }

  /**
   * Save the stack to the file system
   */
  private async saveStack(): Promise<void> {
    if (!this.dirHandle) return;

    const lockName = `infoverse:deletion-stack:${this.dirHandle.name}`;

    await this.withExclusiveWebLock(lockName, async () => {
      let writable: FileSystemWritableFileStream | null = null;
      try {
        const fileHandle = await this.dirHandle!.getFileHandle(STACK_FILENAME, {
          create: true,
        });
        writable = await fileHandle.createWritable();

        const content = this.serializeStack();
        await writable.write(content);
        await writable.close();
        writable = null;
      } catch (e) {
        if (writable) {
          try {
            await writable.close();
          } catch {
            // ignore
          }
        }
        throw e;
      }
    });
  }

  /**
   * Parse the stack file content
   */
  private parseStackFile(text: string): DeletionStack | null {
    try {
      // Extract frontmatter
      const frontmatterMatch = text.match(/^---\n([\s\S]*?)\n---/);
      if (!frontmatterMatch) return null;

      const parsed = yaml.load(frontmatterMatch[1]) as any;
      if (!parsed || typeof parsed.version !== 'number') {
        return null;
      }

      return {
        version: parsed.version,
        entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      };
    } catch {
      return null;
    }
  }

  /**
   * Serialize the stack to file content
   */
  private serializeStack(): string {
    const data = {
      version: this.stack.version,
      entries: this.stack.entries,
    };

    const yamlContent = yaml.dump(data, {
      lineWidth: -1, // Don't wrap long lines
      noRefs: true, // Don't use YAML references
    });

    return `---\n${yamlContent}---\n`;
  }

  /**
   * Execute work with an exclusive web lock
   */
  private async withExclusiveWebLock<T>(
    lockName: string,
    work: () => Promise<T>
  ): Promise<T> {
    const navigatorWithLocks = navigator as any;
    const locks = navigatorWithLocks?.locks;
    if (locks && typeof locks.request === 'function') {
      return locks.request(lockName, { mode: 'exclusive' }, work);
    }
    return work();
  }
}
