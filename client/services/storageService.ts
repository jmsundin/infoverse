import { GraphNode, GraphEdge, NodeType } from "../types";
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

const parseMarkdownNode = async (
  fileHandle: FileSystemFileHandle
): Promise<GraphNode | null> => {
  try {
    const file = await fileHandle.getFile();
    const text = await file.text();

    const parts = text.split(/^---$/m);
    if (parts.length < 3) return null;

    const metadata = yaml.load(parts[1]) as any;
    const content = parts.slice(2).join("---").trim();

    return {
      ...metadata,
      content: metadata.content || content || "Untitled",
    };
  } catch (e: any) {
    if (isFileSystemAccessApiError(e, ["NotFoundError", "NotReadableError"]))
      return null;
    console.error("Error parsing file:", fileHandle.name, e);
    return null;
  }
};

export const loadGraphFromDirectory = async (
  dirHandle: FileSystemDirectoryHandle
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> => {
  const nodesMap = new Map<string, GraphNode>();
  let edges: GraphEdge[] = [];

  for await (const entry of dirHandle.values()) {
    if (entry.kind === "file") {
      try {
        if (entry.name === "_edges.json") {
          const file = await (entry as FileSystemFileHandle).getFile();
          const text = await file.text();
          edges = JSON.parse(text);
        } else if (entry.name.endsWith(".md")) {
          const node = await parseMarkdownNode(entry as FileSystemFileHandle);
          if (node) {
            nodesMap.set(node.id, node);
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

  return { nodes: Array.from(nodesMap.values()), edges };
};

// --- NEW FUNCTION: Use this in your UI instead of saveNodeToFile directly ---
export const scheduleSaveNode = (
  dirHandle: FileSystemDirectoryHandle,
  node: GraphNode,
  delay: number = 2000 // Wait 2 seconds after last edit before saving
) => {
  // Clear any pending save for this specific node
  if (saveTimers.has(node.id)) {
    window.clearTimeout(saveTimers.get(node.id));
  }

  // Schedule a new save
  const timerId = window.setTimeout(() => {
    saveTimers.delete(node.id);
    saveNodeToFile(dirHandle, node);
  }, delay);

  saveTimers.set(node.id, timerId);
};

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

export const saveNodeToFile = async (
  dirHandle: FileSystemDirectoryHandle,
  node: GraphNode
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

        const metadata = { ...node };
        // @ts-ignore
        delete metadata.content;

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
