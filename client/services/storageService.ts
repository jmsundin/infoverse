import { GraphNode, GraphEdge, EmbeddedEdge, NodeType } from "../types";
import yaml from "js-yaml";

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
    try {
      const handle = await window.showDirectoryPicker({
        mode: "readwrite",
      });
      return handle;
    } catch (e) {
      console.log("Directory picker cancelled", e);
      return null;
    }
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

// Parse a markdown node file and extract embedded edges
const parseMarkdownNode = async (
  fileHandle: FileSystemFileHandle
): Promise<{ node: GraphNode; edges: EmbeddedEdge[] } | null> => {
  try {
    const file = await fileHandle.getFile();
    const text = await file.text();

    const parts = text.split(/^---$/m);
    if (parts.length < 3) return null;

    const metadata = yaml.load(parts[1]) as any;
    const content = parts.slice(2).join("---").trim();

    // Extract edges from metadata (if present)
    const embeddedEdges: EmbeddedEdge[] = metadata.edges || [];

    // Remove edges from node object (they're stored separately in memory)
    const nodeData = { ...metadata };
    delete nodeData.edges;

    const node: GraphNode = {
      ...nodeData,
      content: metadata.content || content || "Untitled",
    };

    return { node, edges: embeddedEdges };
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
            const { node, edges: embeddedEdges } = result;
            nodesMap.set(node.id, node);

            // Convert embedded edges to full GraphEdge (add source from node id)
            for (const edge of embeddedEdges) {
              allEdges.push({
                id: edge.id,
                source: node.id,
                target: edge.target,
                label: edge.label,
              });
            }
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
export const saveNodeToFile = async (
  dirHandle: FileSystemDirectoryHandle,
  node: GraphNode,
  outgoingEdges: GraphEdge[] = []
) => {
  const newFileName = `${node.id}.md`;
  const lockName = `infoverse:fswrite:${dirHandle.name}:${newFileName}`;

  try {
    const hasPerm = await verifyPermission(dirHandle, true);
    if (!hasPerm) return;

    await withExclusiveWebLock(lockName, async () => {
      let writable: any = null;
      try {
        const fileHandle = await dirHandle.getFileHandle(newFileName, {
          create: true,
        });

        // This line is what creates the .crswap file
        writable = await fileHandle.createWritable();

        const metadata: any = { ...node };
        // Remove content from metadata (it goes in the body)
        delete metadata.content;

        // Convert outgoing edges to embedded format (omit source, it's implicit)
        if (outgoingEdges.length > 0) {
          metadata.edges = outgoingEdges.map((edge) => ({
            id: edge.id,
            target: edge.target,
            label: edge.label,
          }));
        } else {
          // Remove edges key if no edges
          delete metadata.edges;
        }

        const frontmatter = yaml.dump(metadata);

        let body = "";
        if (node.messages) {
          body = node.messages
            .map((m) => `**${m.role}**: ${m.text}`)
            .join("\n\n");
        } else {
          body = node.summary || "";
        }

        const fileContent = `---\n${frontmatter}---\n\n# ${node.content}\n\n${body}`;

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

export const deleteNodeFile = async (
  dirHandle: FileSystemDirectoryHandle,
  nodeId: string
) => {
  try {
    const hasPerm = await verifyPermission(dirHandle, true);
    if (!hasPerm) return;

    try {
      await dirHandle.removeEntry(`${nodeId}.md`);
      return;
    } catch (e: any) {
      if (!isFileSystemAccessApiError(e, ["NotFoundError"])) {
        console.error("Error deleting node:", e);
        return;
      }
    }

    for await (const entry of dirHandle.values()) {
      if (entry.kind === "file" && entry.name.endsWith(".md")) {
        const fileHandle = entry as FileSystemFileHandle;
        try {
          const file = await fileHandle.getFile();
          const text = await file.text();
          if (
            text.includes(`id: "${nodeId}"`) ||
            text.includes(`id: ${nodeId}`)
          ) {
            await dirHandle.removeEntry(entry.name);
            break;
          }
        } catch (e: any) {
          if (
            !isFileSystemAccessApiError(e, [
              "NotFoundError",
              "NotReadableError",
            ])
          ) {
            console.error("Error deleting node:", e);
          }
        }
      }
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
