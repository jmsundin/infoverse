import { GraphNode, GraphEdge } from '../types';
import { loadGraphFromApi, saveNodesBatchToApi, saveEdgesToApi } from './apiStorageService';

// Import graph data from cloud storage
export const importFromCloud = async (): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] } | null> => {
  try {
    const data = await loadGraphFromApi();
    return {
      nodes: data.nodes || [],
      edges: data.edges || [],
    };
  } catch (error) {
    console.error('Failed to import from cloud:', error);
    return null;
  }
};

// Export current graph to cloud storage (full sync)
export const exportToCloud = async (
  nodes: GraphNode[],
  edges: GraphEdge[]
): Promise<boolean> => {
  try {
    // Batch save all nodes
    if (nodes.length > 0) {
      await saveNodesBatchToApi(nodes.map(node => ({ ...node, skipEmbedding: false })));
    }

    // Save all edges
    if (edges.length > 0) {
      await saveEdgesToApi(edges);
    }

    return true;
  } catch (error) {
    console.error('Failed to export to cloud:', error);
    return false;
  }
};

// Check if cloud has data (for detecting if user has existing vault in cloud)
export const hasCloudData = async (): Promise<boolean> => {
  try {
    const data = await loadGraphFromApi();
    return (data.nodes && data.nodes.length > 0) || (data.edges && data.edges.length > 0);
  } catch {
    return false;
  }
};
