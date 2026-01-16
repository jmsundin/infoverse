import { LODLevel } from '../types';

export interface LODConfig {
  baseTitleThreshold: number;
  hysteresisMargin: number;
}

export const DEFAULT_LOD_CONFIG: LODConfig = {
  baseTitleThreshold: 0.6,
  hysteresisMargin: 0.05,
};

/**
 * Calculates dynamic LOD level based on zoom.
 * CLUSTER level has been removed - now only TITLE and DETAIL.
 */
export const calculateDynamicLOD = (
  currentZoom: number,
  _visibleNodeCount: number,
  previousLOD: LODLevel,
  config: LODConfig = DEFAULT_LOD_CONFIG
): { lodLevel: LODLevel; titleThreshold: number } => {
  const { baseTitleThreshold: titleThreshold, hysteresisMargin } = config;

  let lodLevel: LODLevel;

  if (currentZoom > titleThreshold + hysteresisMargin) {
    // Definitely in detail zone
    lodLevel = 'DETAIL';
  } else if (currentZoom < titleThreshold - hysteresisMargin) {
    // Definitely in title zone
    lodLevel = 'TITLE';
  } else {
    // In hysteresis band - maintain previous state
    lodLevel = previousLOD;
  }

  return { lodLevel, titleThreshold };
};

/**
 * Get thresholds for debugging/display
 */
export const getDensityThresholds = (
  _nodeCount: number,
  config: LODConfig = DEFAULT_LOD_CONFIG
): { title: number } => {
  return {
    title: config.baseTitleThreshold,
  };
};
