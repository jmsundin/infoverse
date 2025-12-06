
import { GraphNode, GraphEdge } from '../types';

export const pickDirectory = async (): Promise<FileSystemDirectoryHandle | null> => {
  if (typeof window.showDirectoryPicker !== 'function') {
    alert("Your browser does not support the File System Access API. Please use Chrome, Edge, or Opera.");
    return null;
  }

  try {
    return await window.showDirectoryPicker({ mode: 'readwrite' });
  } catch (e: any) {
    // Only log "cancelled" if it is actually an AbortError
    if (e.name === 'AbortError') {
      console.log('Directory selection cancelled by user.');
      return null;
    }
    // Otherwise, it's a real error
    console.error('Directory selection failed:', e);
    alert(`Error accessing directory: ${e.message || 'Unknown error'}`);
    return null;
  }
};

export const verifyPermission = async (handle: FileSystemHandle, readWrite: boolean): Promise<boolean> => {
  const options: FileSystemHandlePermissionDescriptor = {
    mode: readWrite ? 'readwrite' : 'read'
  };
  
  // Check if permission was already granted
  if ((await handle.queryPermission(options)) === 'granted') {
    return true;
  }
  
  // Request permission
  if ((await handle.requestPermission(options)) === 'granted') {
    return true;
  }
  
  return false;
};

export const loadGraphFromDirectory = async (dirHandle: FileSystemDirectoryHandle) => {
  const nodes: GraphNode[] = [];
  let edges: GraphEdge[] = [];

  try {
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'file') {
        if (entry.name === '_edges.json') {
          try {
            const fileHandle = await dirHandle.getFileHandle('_edges.json');
            const file = await fileHandle.getFile();
            const text = await file.text();
            edges = JSON.parse(text);
          } catch (e) {
            console.warn('Failed to load edges', e);
          }
        } else if (entry.name.endsWith('.json')) {
          // Assume it is a node file
          try {
            const fileHandle = entry as FileSystemFileHandle;
            const file = await fileHandle.getFile();
            const text = await file.text();
            const node = JSON.parse(text);
            // Basic validation
            if (node.id && node.type) {
              nodes.push(node);
            }
          } catch (e) {
            console.warn(`Failed to load node file ${entry.name}`, e);
          }
        }
      }
    }
  } catch (e) {
    console.error("Error reading directory contents:", e);
  }
  return { nodes, edges };
};

export const saveNodeToFile = async (dirHandle: FileSystemDirectoryHandle, node: GraphNode) => {
  try {
    const fileName = `${node.id}.json`;
    const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(node, null, 2));
    await writable.close();
  } catch (e) {
    console.error(`Failed to save node ${node.id}`, e);
    throw e; // Propagate to caller
  }
};

export const deleteNodeFile = async (dirHandle: FileSystemDirectoryHandle, nodeId: string) => {
  try {
    await dirHandle.removeEntry(`${nodeId}.json`);
  } catch (e) {
    // Ignore if file doesn't exist or other minor errors
    console.warn(`Failed to delete node file ${nodeId}`, e);
  }
};

export const saveEdgesToFile = async (dirHandle: FileSystemDirectoryHandle, edges: GraphEdge[]) => {
  try {
    const fileHandle = await dirHandle.getFileHandle('_edges.json', { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(edges, null, 2));
    await writable.close();
  } catch (e) {
    console.error('Failed to save edges', e);
    throw e;
  }
};
