import { GraphNode, GraphEdge, NodeType } from '../types';
import yaml from 'js-yaml';

export const pickDirectory = async (): Promise<FileSystemDirectoryHandle | null> => {
  try {
    const handle = await window.showDirectoryPicker({
      mode: 'readwrite'
    });
    return handle;
  } catch (e) {
    // User cancelled or error
    console.log('Directory picker cancelled', e);
    return null;
  }
};

export const verifyPermission = async (fileHandle: FileSystemHandle, readWrite: boolean = false): Promise<boolean> => {
  const options: FileSystemHandlePermissionDescriptor = {
    mode: readWrite ? 'readwrite' : 'read'
  };
  if ((await fileHandle.queryPermission(options)) === 'granted') {
    return true;
  }
  if ((await fileHandle.requestPermission(options)) === 'granted') {
    return true;
  }
  return false;
};

const parseMarkdownNode = async (fileHandle: FileSystemFileHandle): Promise<GraphNode | null> => {
  try {
    const file = await fileHandle.getFile();
    const text = await file.text();

    const parts = text.split(/^---$/m);
    if (parts.length < 3) return null; // Invalid format

    const metadata = yaml.load(parts[1]) as any;
    const content = parts.slice(2).join('---').trim();

    return {
      ...metadata,
      content: metadata.content || content || 'Untitled'
    };
  } catch (e) {
    console.error('Error parsing file:', fileHandle.name, e);
    return null;
  }
};

export const loadGraphFromDirectory = async (dirHandle: FileSystemDirectoryHandle): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> => {
  const nodes: GraphNode[] = [];
  let edges: GraphEdge[] = [];

  for await (const entry of dirHandle.values()) {
    if (entry.kind === 'file') {
      if (entry.name === '_edges.json') {
        const file = await (entry as FileSystemFileHandle).getFile();
        const text = await file.text();
        try {
          edges = JSON.parse(text);
        } catch (e) {
          console.error('Error parsing edges:', e);
        }
      } else if (entry.name.endsWith('.md')) {
        const node = await parseMarkdownNode(entry as FileSystemFileHandle);
        if (node) nodes.push(node);
      }
    }
  }

  return { nodes, edges };
};

// Format: YYYY-MM-DD-HH-mm-ss-SSS
const getTimestamp = () => {
    const now = new Date();
    const pad = (n: number, width = 2) => n.toString().padStart(width, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}-${pad(now.getMilliseconds(), 3)}`;
};

const sanitizeFilename = (name: string) => {
    return name.replace(/[^a-z0-9\-_]/gi, '_').replace(/_{2,}/g, '_').substring(0, 50);
};

export const saveNodeToFile = async (dirHandle: FileSystemDirectoryHandle, node: GraphNode) => {
  try {
    const contentTitle = node.content && node.content.trim() ? node.content : 'Untitled';
    const safeTitle = sanitizeFilename(contentTitle);
    
    // We need to find if there's an existing file for this node to rename it or update it
    let existingFileName: string | null = null;
    
    for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file' && entry.name.endsWith('.md')) {
             const fileHandle = entry as FileSystemFileHandle;
             const file = await fileHandle.getFile();
             const text = await file.text();
             // Simple check for ID in frontmatter
             if (text.includes(`id: "${node.id}"`) || text.includes(`id: ${node.id}`)) {
                 existingFileName = entry.name;
                 break;
             }
        }
    }

    // If title changed, we might want a new filename, but let's keep it simple:
    // If file exists, reuse handle unless we strictly want to rename.
    // Renaming in File System Access API is essentially creating new and deleting old.
    
    // Let's generate the target filename
    // Note: If we want to preserve history/timestamps in filenames, we might create new ones.
    // But if we just edit, we might want to keep the same file if the title hasn't changed much.
    // For this implementation, let's rename if the title-based name + ID check suggests a change,
    // OR just overwrite if we found it.
    // Actually, simpler: Delete old if exists, Write new. (Safest for renaming)
    
    if (existingFileName) {
        // If the name matches our new generated name pattern, we could just overwrite.
        // But the timestamp makes it unique. 
        // Let's just delete the old one to ensure cleanup.
        await dirHandle.removeEntry(existingFileName);
    }

    const timestamp = getTimestamp();
    const newFileName = `${safeTitle}_${timestamp}.md`;
    
    const fileHandle = await dirHandle.getFileHandle(newFileName, { create: true });
    const writable = await fileHandle.createWritable();
    
    const metadata = { ...node };
    // @ts-ignore
    delete metadata.content; // Store content in body, not metadata (optional, but cleaner frontmatter)
    // Actually, keep content in metadata for easier parsing if it's short title. 
    // The body will be the description/chat log.
    
    const frontmatter = yaml.dump(node);
    
    // Reconstruct body
    // If it's a chat, we might want a readable log in the body
    let body = '';
    if (node.messages) {
        body = node.messages.map(m => `**${m.role}**: ${m.text}`).join('\n\n');
    } else {
        body = node.summary || '';
    }
    
    const fileContent = `---\n${frontmatter}---\n\n# ${node.content}\n\n${body}`;
    
    await writable.write(fileContent);
    await writable.close();
    
  } catch (e) {
    console.error('Error saving node:', e);
  }
};

export const deleteNodeFile = async (dirHandle: FileSystemDirectoryHandle, nodeId: string) => {
    try {
        for await (const entry of dirHandle.values()) {
            if (entry.kind === 'file' && entry.name.endsWith('.md')) {
                 const fileHandle = entry as FileSystemFileHandle;
                 const file = await fileHandle.getFile();
                 const text = await file.text();
                 if (text.includes(`id: "${nodeId}"`) || text.includes(`id: ${nodeId}`)) {
                     await dirHandle.removeEntry(entry.name);
                     break;
                 }
            }
        }
    } catch (e) {
        console.error('Error deleting node:', e);
    }
};

export const saveEdgesToFile = async (dirHandle: FileSystemDirectoryHandle, edges: GraphEdge[]) => {
    try {
        const fileHandle = await dirHandle.getFileHandle('_edges.json', { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(edges, null, 2));
        await writable.close();
    } catch (e) {
        console.error('Error saving edges:', e);
    }
};
