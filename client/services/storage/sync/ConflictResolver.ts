/**
 * ConflictResolver - Hash-based conflict detection and resolution
 *
 * Detects conflicts by comparing content hashes rather than timestamps,
 * which is more reliable across timezone skew, coarse granularity, git operations, etc.
 */

import { GraphNode } from '../../../types';

export type ConflictResolution = 'local' | 'file' | 'merge';

export interface ConflictInfo {
  nodeId: string;
  filename: string;
  localNode: GraphNode;
  localUpdatedAt: number;
  localHash: string;
  fileNode: GraphNode;
  fileHash: string;
  conflictType: 'content' | 'position' | 'both';
}

export interface PositionConflict {
  nodeId: string;
  localPosition: { x: number; y: number; width: number; height: number };
  filePosition: { x: number; y: number; width: number; height: number };
}

export class ConflictResolver {
  /**
   * Detect if a conflict exists based on hash comparison
   *
   * Conflict occurs when:
   * 1. File hash differs from last materialized hash (external change)
   * 2. DB has unsynced edits (updated_at > materialized_at)
   */
  detectConflict(
    localUpdatedAt: number,
    localMaterializedAt: number,
    lastMaterializedHash: string,
    currentFileHash: string
  ): boolean {
    // No conflict if file hasn't changed
    if (lastMaterializedHash === currentFileHash) {
      return false;
    }

    // No conflict if we don't have unsynced local edits
    if (localUpdatedAt <= localMaterializedAt) {
      return false;
    }

    // Both have changed - conflict!
    return true;
  }

  /**
   * Auto-resolve using last-writer-wins
   * Returns the node that should be kept
   */
  autoResolve(conflict: ConflictInfo): GraphNode {
    // For content conflicts, prefer the most recent edit
    // Since we don't have reliable timestamps from file, prefer local if edited recently
    // This is a simple heuristic - production apps might want more sophisticated merging
    return conflict.localNode;
  }

  /**
   * Merge content from both sources (simple line-based merge)
   * This is a basic implementation - production apps might use a proper diff/merge library
   */
  mergeContent(local: string, file: string): string {
    if (local === file) return local;

    // Simple conflict marker approach
    const localLines = local.split('\n');
    const fileLines = file.split('\n');

    // If content is substantially different, use conflict markers
    if (Math.abs(localLines.length - fileLines.length) > 5 || this.hasMajorDifferences(local, file)) {
      return this.mergeWithMarkers(local, file);
    }

    // Try to merge line by line for small differences
    return this.mergeLines(localLines, fileLines);
  }

  /**
   * Resolve position conflicts
   * Default: file wins (user moved something externally, we should respect that)
   */
  resolvePosition(conflict: PositionConflict): { x: number; y: number; width: number; height: number } {
    // File position takes precedence
    return conflict.filePosition;
  }

  /**
   * Check if two strings have major differences (more than 30% different)
   */
  private hasMajorDifferences(a: string, b: string): boolean {
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return false;

    // Simple character-level difference ratio
    let diffCount = 0;
    const minLen = Math.min(a.length, b.length);

    for (let i = 0; i < minLen; i++) {
      if (a[i] !== b[i]) diffCount++;
    }

    diffCount += Math.abs(a.length - b.length);

    return diffCount / maxLen > 0.3;
  }

  /**
   * Merge with conflict markers (git-style)
   */
  private mergeWithMarkers(local: string, file: string): string {
    return `<<<<<<< LOCAL
${local}
=======
${file}
>>>>>>> FILE`;
  }

  /**
   * Attempt line-by-line merge for small differences
   */
  private mergeLines(localLines: string[], fileLines: string[]): string {
    const result: string[] = [];
    const maxLen = Math.max(localLines.length, fileLines.length);

    for (let i = 0; i < maxLen; i++) {
      const localLine = localLines[i];
      const fileLine = fileLines[i];

      if (localLine === undefined) {
        // File has extra lines
        result.push(fileLine);
      } else if (fileLine === undefined) {
        // Local has extra lines
        result.push(localLine);
      } else if (localLine === fileLine) {
        // Lines match
        result.push(localLine);
      } else {
        // Lines differ - include both with marker
        result.push(`<<<<<<< LOCAL`);
        result.push(localLine);
        result.push(`=======`);
        result.push(fileLine);
        result.push(`>>>>>>> FILE`);
      }
    }

    return result.join('\n');
  }

  /**
   * Create a diff-friendly description of changes
   */
  describeConflict(conflict: ConflictInfo): string {
    const localLen = conflict.localNode.content?.length ?? 0;
    const fileLen = conflict.fileNode.content?.length ?? 0;

    return `Conflict in "${conflict.filename}":
- Local version: ${localLen} chars, updated ${this.formatTime(conflict.localUpdatedAt)}
- File version: ${fileLen} chars, hash ${conflict.fileHash.slice(0, 8)}
- Conflict type: ${conflict.conflictType}`;
  }

  /**
   * Format timestamp for display
   */
  private formatTime(ts: number): string {
    const date = new Date(ts);
    const now = new Date();

    if (date.toDateString() === now.toDateString()) {
      // Today - show time only
      return date.toLocaleTimeString();
    }

    // Show date and time
    return date.toLocaleString();
  }
}
