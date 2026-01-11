import React from 'react';
import { MigrationProgress } from '../services/migration/types';

interface MigrationProgressBarProps {
  progress: MigrationProgress;
  onCancel?: () => void;
}

/**
 * Fixed position progress bar overlay shown in top-left of canvas during migration.
 */
export const MigrationProgressBar: React.FC<MigrationProgressBarProps> = ({
  progress,
  onCancel,
}) => {
  if (!progress.isRunning) return null;

  const percentage =
    progress.totalNodes > 0
      ? Math.round((progress.processedNodes / progress.totalNodes) * 100)
      : 0;

  return (
    <div className="fixed top-4 left-20 z-50 bg-slate-800 border border-slate-700 rounded-lg shadow-xl p-4 min-w-[300px]">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-white">Schema Migration</span>
        {onCancel && (
          <button
            onClick={onCancel}
            className="text-slate-400 hover:text-white text-sm px-2 py-1 rounded hover:bg-slate-700 transition-colors"
          >
            Cancel
          </button>
        )}
      </div>

      <div className="w-full bg-slate-700 rounded-full h-2 mb-2">
        <div
          className="bg-sky-500 h-2 rounded-full transition-all duration-300"
          style={{ width: `${percentage}%` }}
        />
      </div>

      <div className="flex justify-between text-xs text-slate-400">
        <span className="truncate max-w-[180px]">{progress.currentStatus}</span>
        <span>
          {progress.processedNodes} / {progress.totalNodes} ({percentage}%)
        </span>
      </div>

      {progress.nodesNeedingUpdates > 0 && (
        <div className="mt-2 text-xs text-amber-400">
          {progress.nodesNeedingUpdates} nodes updated
        </div>
      )}

      {progress.errors.length > 0 && (
        <div className="mt-2 text-xs text-red-400">
          {progress.errors.length} error{progress.errors.length !== 1 ? 's' : ''} encountered
        </div>
      )}
    </div>
  );
};
