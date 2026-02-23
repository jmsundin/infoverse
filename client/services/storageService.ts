import { GraphNode, GraphEdge, NodeType } from "../types";
import { parseNodeMarkdown, serializeNodeMarkdown } from "./storage/markdown";
import { composeChatContentFromMessages } from "../utils/nodeContentUtils";

type DirectoryPickerErrorCode = "UNSUPPORTED" | "INSECURE_CONTEXT" | "FAILED";

interface DirectoryPickerError extends Error {
  code: DirectoryPickerErrorCode;
  cause?: unknown;
}

const createDirectoryPickerError = (
  code: DirectoryPickerErrorCode,
  message: string,
  cause?: unknown
): DirectoryPickerError => {
  const error = new Error(message) as DirectoryPickerError;
  error.code = code;
  error.cause = cause;
  return error;
};

// --- NEW: Tracking for debounced saves ---
const saveTimers = new Map<string, number>();
const edgeSaveTimer: { current: number | null } = { current: null };
// ----------------------------------------

const withExclusiveWebLock = async <T>(
  lockName: string,
  work: () => Promise<T>
): Promise<T> => {
  const navigatorWithLocks = navigator as any;
  const locks = navigatorWithLocks?.locks;
  if (locks && typeof locks.request === "function") {
    return locks.request(lockName, { mode: "exclusive" }, work);
  }
  return work();
};

export const pickDirectory =
  async (): Promise<FileSystemDirectoryHandle | null> => {
    if (typeof window === "undefined") {
      throw createDirectoryPickerError(
        "FAILED",
        "Directory picker can only run in a browser context."
      );
    }

    if (!window.isSecureContext) {
      throw createDirectoryPickerError(
        "INSECURE_CONTEXT",
        "Directory picker requires a secure context."
      );
    }

    if (typeof window.showDirectoryPicker !== "function") {
      throw createDirectoryPickerError(
        "UNSUPPORTED",
        "Directory picker is not supported in this browser."
      );
    }

    try {
      const handle = await window.showDirectoryPicker({
        mode: "readwrite",
      });
      return handle;
    } catch (e: any) {
      if (e?.name === "AbortError") {
        return null;
      }
      throw createDirectoryPickerError(
        "FAILED",
        "Directory picker failed to open.",
        e
      );
    }
  };

export const getDirectoryPickerErrorMessage = (error: unknown): string => {
  const code = (error as { code?: string })?.code;

  if (code === "UNSUPPORTED") {
    return "This browser does not support directory access. Use Chrome or Edge on http://localhost:3000.";
  }

  if (code === "INSECURE_CONTEXT") {
    return "Directory access requires a secure origin. Open the app on http://localhost:3000 (not a LAN IP).";
  }

  return "Unable to open the directory picker. Check browser permissions and try again.";
};

export const verifyPermission = async (
  fileHandle: FileSystemHandle,
  readWrite: boolean = false
): Promise<boolean> => {
  const options: FileSystemHandlePermissionDescriptor = {
    mode: readWrite ? "readwrite" : "read",
  };
  if ((await fileHandle.queryPermission(options)) === "granted") {
    return true;
  }
  if ((await fileHandle.requestPermission(options)) === "granted") {
    return true;
  }
  return false;
};

const isFileSystemAccessApiError = (e: any, names: string[]) => {
  const errorName = e?.name;
  const message = typeof e?.message === "string" ? e.message : "";
  const code = e?.code;
  return (
    (typeof errorName === "string" && names.includes(errorName)) ||
    (typeof code === "string" && names.includes(code)) ||
    names.some((n) => message.includes(n))
  );
};

const safeCloseOrAbortWritable = async (writable: any, error?: any) => {
  if (!writable) return;
  if (error && typeof writable.abort === "function") {
    try {
      await writable.abort();
      return;
    } catch {
      // fall through to close
    }
  }
  if (typeof writable.close === "function") {
    try {
      await writable.close();
    } catch {
      // ignore
    }
  }
};

// Sanitize a title to create a valid filename
// Only allows alphanumeric, spaces, hyphens, and underscores
const sanitizeFilename = (title: string): string | null => {
  if (!title || !title.trim()) return null;

  const sanitized = title
    .replace(/[^a-zA-Z0-9\s\-_]/g, "") // Keep only alphanumeric, space, hyphen, underscore
    .replace(/\s+/g, " ") // Normalize whitespace
    .trim()
    .slice(0, 200); // Limit length for cross-platform compatibility

  return sanitized || null;
};

// Find the existing file for a node by searching frontmatter for its ID
const findExistingFileForNode = async (
  dirHandle: FileSystemDirectoryHandle,
  nodeId: string
): Promise<string | null> => {
  try {
    for await (const entry of dirHandle.values()) {
      if (entry.kind === "file" && entry.name.endsWith(".md")) {
        try {
          const file = await (entry as FileSystemFileHandle).getFile();
          const text = await file.text();
          const parsed = parseNodeMarkdown(text);
          if (parsed?.node.id === nodeId) {
            return entry.name;
          }
        } catch {
          // Skip files that can't be read
        }
      }
    }
  } catch {
    // Ignore directory iteration errors
  }
  return null;
};

// Get an available filename for a node, adding suffix on collision
const getAvailableFilename = async (
  dirHandle: FileSystemDirectoryHandle,
  node: GraphNode,
  currentFilename: string | null
): Promise<string> => {
  // Prefer title for filename, fall back to content
  const sanitized = sanitizeFilename(node.title || '') || sanitizeFilename(node.content);
  const baseName = sanitized || "Untitled";
  const desiredFilename = `${baseName}.md`;

  // If this is the same filename we already have, keep it
  if (currentFilename === desiredFilename) {
    return desiredFilename;
  }

  // Check if desired filename exists (collision check)
  try {
    await dirHandle.getFileHandle(desiredFilename);
    // File exists - check if it's our own file (same node ID)
    // If not, add shortId suffix to avoid collision
    const shortId = node.id.slice(0, 6);
    return `${baseName}-${shortId}.md`;
  } catch {
    // File doesn't exist - use desired filename
    return desiredFilename;
  }
};

// Parse a markdown node file and extract embedded edges
const parseMarkdownNode = async (
  fileHandle: FileSystemFileHandle
): Promise<{ node: GraphNode; edges: GraphEdge[] } | null> => {
  try {
    const file = await fileHandle.getFile();
    const text = await file.text();
    const parsed = parseNodeMarkdown(text);
    if (!parsed) return null;

    return { node: parsed.node, edges: parsed.edges };
  } catch (e: any) {
    if (isFileSystemAccessApiError(e, ["NotFoundError", "NotReadableError"]))
      return null;
    console.error("Error parsing file:", fileHandle.name, e);
    return null;
  }
};

export const loadGraphFromDirectory = async (
  dirHandle: FileSystemDirectoryHandle
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[]; hasLegacyEdgesFile: boolean }> => {
  const nodesMap = new Map<string, GraphNode>();
  const allEdges: GraphEdge[] = [];
  let legacyEdges: GraphEdge[] = [];
  let hasLegacyEdgesFile = false;

  for await (const entry of dirHandle.values()) {
    if (entry.kind === "file") {
      try {
        if (entry.name === "_edges.json") {
          // Legacy edges file - read for migration purposes
          const file = await (entry as FileSystemFileHandle).getFile();
          const text = await file.text();
          legacyEdges = JSON.parse(text);
          hasLegacyEdgesFile = true;
        } else if (entry.name.endsWith(".md")) {
          const result = await parseMarkdownNode(entry as FileSystemFileHandle);
          if (result) {
            const { node, edges: parsedEdges } = result;
            nodesMap.set(node.id, node);
            allEdges.push(...parsedEdges);
          }
        }
      } catch (e: any) {
        if (
          !isFileSystemAccessApiError(e, ["NotFoundError", "NotReadableError"])
        ) {
          console.error(`Error processing file ${entry.name}:`, e);
        }
      }
    }
  }

  // If we have embedded edges, use those; otherwise fall back to legacy edges
  const edges = allEdges.length > 0 ? allEdges : legacyEdges;

  return { nodes: Array.from(nodesMap.values()), edges, hasLegacyEdgesFile };
};

// Schedule a debounced save for a node with its outgoing edges
export const scheduleSaveNode = (
  dirHandle: FileSystemDirectoryHandle,
  node: GraphNode,
  outgoingEdges: GraphEdge[] = [],
  delay: number = 2000 // Wait 2 seconds after last edit before saving
) => {
  // Clear any pending save for this specific node
  if (saveTimers.has(node.id)) {
    window.clearTimeout(saveTimers.get(node.id));
  }

  // Schedule a new save
  const timerId = window.setTimeout(() => {
    saveTimers.delete(node.id);
    saveNodeToFile(dirHandle, node, outgoingEdges);
  }, delay);

  saveTimers.set(node.id, timerId);
};

// @deprecated - edges are now embedded in node files. Use scheduleSaveNode with outgoingEdges instead.
export const scheduleSaveEdges = (
  dirHandle: FileSystemDirectoryHandle,
  edges: GraphEdge[],
  delay: number = 2000
) => {
  if (edgeSaveTimer.current) {
    window.clearTimeout(edgeSaveTimer.current);
  }
  edgeSaveTimer.current = window.setTimeout(() => {
    saveEdgesToFile(dirHandle, edges);
    edgeSaveTimer.current = null;
  }, delay);
};
// --------------------------------------------------------------------------

// Save a node to file with its outgoing edges embedded in frontmatter
// Filename is based on node title (content), with collision handling
export const saveNodeToFile = async (
  dirHandle: FileSystemDirectoryHandle,
  node: GraphNode,
  outgoingEdges: GraphEdge[] = []
) => {
  try {
    const hasPerm = await verifyPermission(dirHandle, true);
    if (!hasPerm) return;

    // Find current file for this node (if exists) by searching frontmatter
    const currentFilename = await findExistingFileForNode(dirHandle, node.id);

    // Determine new filename based on title (with collision handling)
    const newFileName = await getAvailableFilename(dirHandle, node, currentFilename);
    const lockName = `infoverse:fswrite:${dirHandle.name}:${newFileName}`;

    // If filename changed (title renamed), delete old file first
    if (currentFilename && currentFilename !== newFileName) {
      try {
        await dirHandle.removeEntry(currentFilename);
      } catch {
        // Ignore if old file doesn't exist
      }
    }

    await withExclusiveWebLock(lockName, async () => {
      let writable: any = null;
      try {
        const fileHandle = await dirHandle.getFileHandle(newFileName, {
          create: true,
        });

        // This line is what creates the .crswap file
        writable = await fileHandle.createWritable();

        // For chat nodes, persist transcript text into markdown body.
        let content = node.content || "";
        if (node.type === NodeType.CHAT && node.messages && node.messages.length > 0) {
          content = composeChatContentFromMessages(
            content,
            node.messages.map((m) => ({ role: m.role, text: m.text }))
          );
        }

        const fileContent = serializeNodeMarkdown({
          node: { ...node, content },
          edges: outgoingEdges,
        });

        await writable.write(fileContent);
        await writable.close(); // .crswap is deleted/renamed here
        writable = null;
      } catch (e: any) {
        await safeCloseOrAbortWritable(writable, e);
        throw e;
      }
    });
  } catch (e: any) {
    if (
      isFileSystemAccessApiError(e, [
        "NotFoundError",
        "NotReadableError",
        "NoModificationAllowedError",
      ])
    )
      return;
    console.error("Error saving node:", e);
  }
};

// Delete a node's file by finding it via frontmatter ID
export const deleteNodeFile = async (
  dirHandle: FileSystemDirectoryHandle,
  nodeId: string
) => {
  try {
    const hasPerm = await verifyPermission(dirHandle, true);
    if (!hasPerm) return;

    // Find the file by searching for the node ID in frontmatter
    const filename = await findExistingFileForNode(dirHandle, nodeId);

    if (filename) {
      try {
        await dirHandle.removeEntry(filename);
        return;
      } catch (e: any) {
        if (!isFileSystemAccessApiError(e, ["NotFoundError"])) {
          console.error("Error deleting node file:", e);
        }
      }
    }

    // Fallback: try legacy UUID-based filename
    try {
      await dirHandle.removeEntry(`${nodeId}.md`);
    } catch {
      // File doesn't exist, which is fine
    }
  } catch (e) {
    console.error("Error deleting node:", e);
  }
};

// @deprecated - edges are now embedded in node files
export const saveEdgesToFile = async (
  dirHandle: FileSystemDirectoryHandle,
  edges: GraphEdge[]
) => {
  try {
    const hasPerm = await verifyPermission(dirHandle, true);
    if (!hasPerm) return;

    await withExclusiveWebLock(
      `infoverse:fswrite:${dirHandle.name}:_edges.json`,
      async () => {
        let writable: any = null;
        try {
          const fileHandle = await dirHandle.getFileHandle("_edges.json", {
            create: true,
          });
          writable = await fileHandle.createWritable();
          await writable.write(JSON.stringify(edges, null, 2));
          await writable.close();
          writable = null;
        } catch (e) {
          await safeCloseOrAbortWritable(writable, e);
          throw e;
        }
      }
    );
  } catch (e: any) {
    if (
      isFileSystemAccessApiError(e, [
        "NotFoundError",
        "NotReadableError",
        "NoModificationAllowedError",
      ])
    )
      return;
    console.error("Error saving edges:", e);
  }
};

// Migrate edges from legacy _edges.json to embedded in node files
export const migrateEdgesToNodes = async (
  dirHandle: FileSystemDirectoryHandle,
  nodes: GraphNode[],
  edges: GraphEdge[]
): Promise<boolean> => {
  try {
    const hasPerm = await verifyPermission(dirHandle, true);
    if (!hasPerm) return false;

    // Group edges by source node
    const edgesBySource = new Map<string, GraphEdge[]>();
    for (const edge of edges) {
      const existing = edgesBySource.get(edge.source) || [];
      existing.push(edge);
      edgesBySource.set(edge.source, existing);
    }

    // Update each node file with its outgoing edges
    for (const node of nodes) {
      const outgoingEdges = edgesBySource.get(node.id) || [];
      await saveNodeToFile(dirHandle, node, outgoingEdges);
    }

    // Delete the legacy _edges.json file
    try {
      await dirHandle.removeEntry("_edges.json");
      console.log("Migration complete: _edges.json removed");
    } catch (e: any) {
      if (!isFileSystemAccessApiError(e, ["NotFoundError"])) {
        console.error("Error removing legacy _edges.json:", e);
      }
    }

    return true;
  } catch (e) {
    console.error("Error during edge migration:", e);
    return false;
  }
};

// Get outgoing edges for a specific node from the full edge list
export const getOutgoingEdges = (nodeId: string, edges: GraphEdge[]): GraphEdge[] => {
  return edges.filter((edge) => edge.source === nodeId);
};
