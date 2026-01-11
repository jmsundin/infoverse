import { LODLevel } from '../types';

export interface LODConfig {
  baseClusterThreshold: number;
  baseTitleThreshold: number;
  maxNodesBeforeEarlierClustering: number;
  hysteresisMargin: number;
}

export const DEFAULT_LOD_CONFIG: LODConfig = {
  baseClusterThreshold: 0.4,
  baseTitleThreshold: 0.6,
  maxNodesBeforeEarlierClustering: 50,
  hysteresisMargin: 0.05,
};

/**
 * Calculates dynamic LOD level based on zoom and visible node density.
 * Higher density → switch to cluster mode earlier (at higher zoom levels).
 * Includes hysteresis to prevent flickering at threshold boundaries.
 */
export const calculateDynamicLOD = (
  currentZoom: number,
  visibleNodeCount: number,
  previousLOD: LODLevel,
  config: LODConfig = DEFAULT_LOD_CONFIG
): { lodLevel: LODLevel; clusterThreshold: number; titleThreshold: number } => {
  // Calculate density factor (0-1 scale)
  // More nodes = higher density factor = earlier clustering
  const densityFactor = Math.min(
    1,
    visibleNodeCount / (config.maxNodesBeforeEarlierClustering * 2)
  );

  // Adjust thresholds based on density
  // At high density, thresholds shift up (cluster earlier)
  const clusterThreshold = config.baseClusterThreshold + densityFactor * 0.2;
  const titleThreshold = config.baseTitleThreshold + densityFactor * 0.2;

  const { hysteresisMargin } = config;

  // Determine LOD with hysteresis to prevent flickering
  let lodLevel: LODLevel;

  if (currentZoom < clusterThreshold - hysteresisMargin) {
    // Definitely in cluster zone
    lodLevel = 'CLUSTER';
  } else if (currentZoom > titleThreshold + hysteresisMargin) {
    // Definitely in detail zone
    lodLevel = 'DETAIL';
  } else if (currentZoom >= clusterThreshold + hysteresisMargin &&
             currentZoom <= titleThreshold - hysteresisMargin) {
    // Definitely in title zone
    lodLevel = 'TITLE';
  } else {
    // In a hysteresis band - maintain previous state
    if (previousLOD === 'CLUSTER') {
      // Only leave CLUSTER if clearly past threshold
      if (currentZoom > clusterThreshold + hysteresisMargin) {
        lodLevel = 'TITLE';
      } else {
        lodLevel = 'CLUSTER';
      }
    } else if (previousLOD === 'DETAIL') {
      // Only leave DETAIL if clearly below threshold
      if (currentZoom < titleThreshold - hysteresisMargin) {
        lodLevel = 'TITLE';
      } else {
        lodLevel = 'DETAIL';
      }
    } else {
      // Previous was TITLE
      if (currentZoom < clusterThreshold - hysteresisMargin) {
        lodLevel = 'CLUSTER';
      } else if (currentZoom > titleThreshold + hysteresisMargin) {
        lodLevel = 'DETAIL';
      } else {
        lodLevel = 'TITLE';
      }
    }
  }

  return { lodLevel, clusterThreshold, titleThreshold };
};

/**
 * Get density-based thresholds table for debugging/display
 */
export const getDensityThresholds = (
  nodeCount: number,
  config: LODConfig = DEFAULT_LOD_CONFIG
): { cluster: number; title: number } => {
  const densityFactor = Math.min(
    1,
    nodeCount / (config.maxNodesBeforeEarlierClustering * 2)
  );

  return {
    cluster: config.baseClusterThreshold + densityFactor * 0.2,
    title: config.baseTitleThreshold + densityFactor * 0.2,
  };
};
