import yaml from 'js-yaml';

const ARCHIVE_FILENAME = '_deleted-nodes.md';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

interface ArchiveEntry {
  deleted: string; // ISO timestamp
  title: string;
  originalFile: string;
  content: string; // Full original markdown content
}

/**
 * NodeArchiveService archives deleted node content to a human-readable markdown file.
 * When nodes are deleted, their full markdown content is prepended to _deleted-nodes.md.
 * Entries older than 30 days are automatically pruned.
 */
export class NodeArchiveService {
  private dirHandle: FileSystemDirectoryHandle | null = null;
  private initialized = false;

  /**
   * Initialize the service with a directory handle
   */
  async initialize(dirHandle: FileSystemDirectoryHandle): Promise<void> {
    this.dirHandle = dirHandle;
    this.initialized = true;
  }

  /**
   * Check if the service is ready to use
   */
  isEnabled(): boolean {
    return this.initialized && this.dirHandle !== null;
  }

  /**
   * Archive a deleted node by prepending it to the archive file
   */
  async archiveNode(
    originalFilename: string,
    title: string,
    rawMarkdownContent: string
  ): Promise<void> {
    if (!this.dirHandle) return;

    const lockName = `infoverse:node-archive:${this.dirHandle.name}`;

    await this.withExclusiveWebLock(lockName, async () => {
      // Load existing archive content
      let existingContent = '';
      try {
        const fileHandle = await this.dirHandle!.getFileHandle(ARCHIVE_FILENAME);
        const file = await fileHandle.getFile();
        existingContent = await file.text();
      } catch {
        // File doesn't exist yet - that's fine
      }

      // Create new entry header
      const now = new Date().toISOString();
      const entryHeader = `---
deleted: ${now}
title: ${JSON.stringify(title)}
originalFile: ${originalFilename}
---

`;

      // Prepend new entry to existing content
      const newContent = entryHeader + rawMarkdownContent + '\n\n' + existingContent;

      // Write the updated archive
      let writable: FileSystemWritableFileStream | null = null;
      try {
        const fileHandle = await this.dirHandle!.getFileHandle(ARCHIVE_FILENAME, {
          create: true,
        });
        writable = await fileHandle.createWritable();
        await writable.write(newContent);
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
   * Remove entries older than the specified age (defaults to 30 days)
   * Returns the number of entries pruned
   */
  async pruneOldEntries(maxAgeMs: number = THIRTY_DAYS_MS): Promise<number> {
    if (!this.dirHandle) return 0;

    const lockName = `infoverse:node-archive:${this.dirHandle.name}`;

    return this.withExclusiveWebLock(lockName, async () => {
      // Load archive content
      let text = '';
      try {
        const fileHandle = await this.dirHandle!.getFileHandle(ARCHIVE_FILENAME);
        const file = await fileHandle.getFile();
        text = await file.text();
      } catch {
        // File doesn't exist - nothing to prune
        return 0;
      }

      if (!text.trim()) return 0;

      // Parse entries
      const entries = this.parseArchiveFile(text);
      const originalCount = entries.length;

      // Filter out old entries
      const cutoff = Date.now() - maxAgeMs;
      const keptEntries = entries.filter((entry) => {
        const deletedTime = new Date(entry.deleted).getTime();
        return deletedTime > cutoff;
      });

      const pruned = originalCount - keptEntries.length;

      if (pruned > 0) {
        // Serialize and save
        const newContent = this.serializeEntries(keptEntries);

        let writable: FileSystemWritableFileStream | null = null;
        try {
          const fileHandle = await this.dirHandle!.getFileHandle(ARCHIVE_FILENAME, {
            create: true,
          });
          writable = await fileHandle.createWritable();
          await writable.write(newContent);
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
      }

      return pruned;
    });
  }

  /**
   * Parse the archive file into individual entries
   */
  private parseArchiveFile(text: string): ArchiveEntry[] {
    const entries: ArchiveEntry[] = [];

    // Split by frontmatter boundaries - each entry starts with ---
    // Pattern: ---\n<yaml>\n---\n<content>
    const entryPattern = /^---\n([\s\S]*?)\n---\n([\s\S]*?)(?=\n---\n|$)/gm;

    let match;
    while ((match = entryPattern.exec(text)) !== null) {
      try {
        const frontmatter = yaml.load(match[1]) as any;
        const content = match[2].trim();

        if (frontmatter && frontmatter.deleted) {
          entries.push({
            deleted: frontmatter.deleted,
            title: frontmatter.title || 'Untitled',
            originalFile: frontmatter.originalFile || 'unknown.md',
            content,
          });
        }
      } catch {
        // Skip malformed entries
      }
    }

    return entries;
  }

  /**
   * Serialize entries back to file content
   */
  private serializeEntries(entries: ArchiveEntry[]): string {
    if (entries.length === 0) return '';

    return entries
      .map((entry) => {
        const header = `---
deleted: ${entry.deleted}
title: ${JSON.stringify(entry.title)}
originalFile: ${entry.originalFile}
---

${entry.content}`;
        return header;
      })
      .join('\n\n');
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
