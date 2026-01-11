import { useState, useCallback, useEffect } from 'react';
import { getMigrationService } from '../services/migration/MigrationService';
import { MigrationProgress, MigrationResult } from '../services/migration/types';
import { GraphNode } from '../types';

interface UseMigrationOptions {
  loadNode: (nodeId: string) => Promise<GraphNode | null>;
  saveNode: (node: GraphNode) => Promise<void>;
  getAllNodeIds: () => string[];
}

interface UseMigrationReturn {
  progress: MigrationProgress | null;
  result: MigrationResult | null;
  startMigration: () => Promise<void>;
  cancelMigration: () => void;
  isRunning: boolean;
}

/**
 * React hook for managing schema migration state
 */
export function useMigration(options: UseMigrationOptions): UseMigrationReturn {
  const { loadNode, saveNode, getAllNodeIds } = options;
  const [progress, setProgress] = useState<MigrationProgress | null>(null);
  const [result, setResult] = useState<MigrationResult | null>(null);

  const migrationService = getMigrationService();

  // Load last migration timestamp on mount
  useEffect(() => {
    const lastTimestamp = migrationService.getLastMigrationTimestamp();
    if (lastTimestamp) {
      setProgress({
        isRunning: false,
        totalNodes: 0,
        processedNodes: 0,
        nodesNeedingUpdates: 0,
        currentStatus: 'Idle',
        lastMigrationTimestamp: lastTimestamp,
        errors: [],
      });
    }
  }, []);

  const startMigration = useCallback(async () => {
    try {
      setResult(null);
      const migrationResult = await migrationService.runMigration(
        loadNode,
        saveNode,
        getAllNodeIds,
        setProgress
      );
      setResult(migrationResult);
    } catch (e) {
      console.error('Migration failed:', e);
    }
  }, [loadNode, saveNode, getAllNodeIds]);

  const cancelMigration = useCallback(() => {
    migrationService.cancel();
  }, []);

  return {
    progress,
    result,
    startMigration,
    cancelMigration,
    isRunning: progress?.isRunning ?? false,
  };
}
