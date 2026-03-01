import { useCallback, useMemo } from "react";
import { v4 as uuidv4 } from "uuid";
import { GraphNode, GraphEdge, NodeType, ViewportTransform, SimulationTrigger } from "../types";
import { DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT } from "../constants";
import * as geminiService from "../services/geminiService";
import * as hfService from "../services/huggingfaceService";
import { useStorage } from "../context/StorageContext";
import { formatChatContent, appendChatMessage, updateLastAssistantMessage } from "../utils/chatFormatUtils";
import { ActiveSidePane } from "./useSidePanes";
import { findDuplicateNoteByTitle, findDuplicateNoteNode } from "../utils/noteDeduplication";

// --- Config-based interface for cleaner hook usage ---

export interface GraphOperationsConfig {
  state: {
    nodes: GraphNode[];
    edges: GraphEdge[];
    currentScopeId: string | null;
    selectedNodeIds: Set<string>;
    viewTransform: ViewportTransform;
    cutNodeId: string | null;
    aiProvider: 'gemini' | 'huggingface';
    user: any;
  };

  actions: {
    setNodes: (nodes: GraphNode[] | ((prev: GraphNode[]) => GraphNode[])) => void;
    setEdges: (edges: GraphEdge[] | ((prev: GraphEdge[]) => GraphEdge[])) => void;
    setCurrentScopeId: (id: string | null) => void;
    setSelectedNodeIds: (ids: Set<string>) => void;
    setViewTransform: (t: ViewportTransform) => void;
    showToast: (message: string, action?: () => void) => void;
    setCutNodeId: (id: string | null) => void;
    showLimitModal: () => void;
    removeSidePane: (id: string) => void;
    setSidePanes: (panes: ActiveSidePane[] | ((prev: ActiveSidePane[]) => ActiveSidePane[])) => void;
  };

  services: {
    dirHandle: FileSystemDirectoryHandle | null;
    deleteNode: (nodeId: string) => Promise<void>;
    removeNodesFromState?: (nodeIds: string[]) => void;
    restoreNodesToState?: (nodes: GraphNode[], edges: GraphEdge[]) => void;
  };

  callbacks: {
    handleExpandNode: (id: string, topic: string, node?: GraphNode) => void;
    startSimulation?: (trigger: SimulationTrigger, subtreeRootId?: string) => void;
  };

  refs: {
    deletedNodeRef: React.MutableRefObject<{ nodes: GraphNode[]; edges: GraphEdge[]; timer: number | null; } | null>;
  };
}

/**
 * Config-based version of useGraphOperations for use with GraphModeContainer.
 * Provides the same functionality but with a cleaner, grouped interface.
 */
export const useGraphOperationsWithConfig = (config: GraphOperationsConfig) => {
  const { state, actions, services, callbacks, refs } = config;

  const handleCreateNode = useCallback(
    (node: GraphNode) => {
      actions.setNodes((prevNodes) => [...prevNodes, node]);
      actions.setSelectedNodeIds(new Set([node.id]));
      actions.setCurrentScopeId(node.parentId || null);
      actions.setViewTransform({
        ...state.viewTransform,
        x: state.viewTransform.x + 100,
        y: state.viewTransform.y + 100,
      });
    },
    [actions, state.viewTransform]
  );

  const handleUpdateNode = useCallback(
    (id: string, updates: Partial<GraphNode>) => {
      actions.setNodes((prev) =>
        prev.map((n) => n.id === id ? { ...n, ...updates } : n)
      );
    },
    [actions]
  );

  const handleCut = useCallback(
    (nodeId: string) => {
      const node = state.nodes.find((n) => n.id === nodeId);
      if (node) {
        actions.setCutNodeId(nodeId);
        actions.showToast(`Node '${node.content}' cut.`, () => actions.setCutNodeId(null));
      }
    },
    [state.nodes, actions]
  );

  const handlePaste = useCallback(
    (position: { x: number; y: number }) => {
      if (state.cutNodeId) {
        const nodeToPaste = state.nodes.find((n) => n.id === state.cutNodeId);
        if (nodeToPaste) {
          const newNode: GraphNode = {
            ...nodeToPaste,
            id: uuidv4(),
            x: position.x,
            y: position.y,
          };
          handleCreateNode(newNode);
          actions.setCutNodeId(null);
          actions.showToast(`Node '${newNode.content}' pasted.`);
        }
      } else {
        actions.showToast("No node cut to paste.");
      }
    },
    [state.cutNodeId, state.nodes, handleCreateNode, actions]
  );

  const confirmDeleteNode = useCallback(
    async (ids: string[]) => {
      const nodesToDelete = state.nodes.filter((n) => ids.includes(n.id));
      if (nodesToDelete.length === 0) return;

      const edgesToDelete = state.edges.filter(
        (e) => ids.includes(e.source) || ids.includes(e.target)
      );

      if (refs.deletedNodeRef.current?.timer) {
        clearTimeout(refs.deletedNodeRef.current.timer);
      }

      const idsSet = new Set(ids);

      actions.setNodes((prev) => prev.filter((node) => !ids.includes(node.id)));
      actions.setEdges((prev) =>
        prev.filter((edge) => !ids.includes(edge.source) && !ids.includes(edge.target))
      );

      if (services.removeNodesFromState) {
        services.removeNodesFromState(ids);
      }

      if (state.cutNodeId && ids.includes(state.cutNodeId)) {
        actions.setCutNodeId(null);
      }

      actions.setSidePanes((prev) =>
        prev.filter((pane) => !(pane.type === "node" && idsSet.has(pane.data)))
      );

      actions.setSelectedNodeIds(new Set());

      const timer = window.setTimeout(async () => {
        for (const id of ids) {
          await services.deleteNode(id);
        }
        refs.deletedNodeRef.current = null;
      }, 5000);

      refs.deletedNodeRef.current = {
        nodes: nodesToDelete,
        edges: edgesToDelete,
        timer,
      };

      actions.showToast(`${nodesToDelete.length} node(s) deleted`, () => {
        if (refs.deletedNodeRef.current) {
          const { nodes: restoredNodes, edges: restoredEdges, timer } = refs.deletedNodeRef.current;

          if (timer) clearTimeout(timer);

          actions.setNodes((prev) => [...prev, ...restoredNodes]);
          actions.setEdges((prev) => [...prev, ...restoredEdges]);

          if (services.restoreNodesToState) {
            services.restoreNodesToState(restoredNodes, restoredEdges);
          }

          refs.deletedNodeRef.current = null;
        }
      });
    },
    [state.nodes, state.edges, state.cutNodeId, actions, services, refs]
  );

  const handleDeleteNode = useCallback(
    (id: string) => {
      confirmDeleteNode([id]);
    },
    [confirmDeleteNode]
  );

  const handleConnectEnd = useCallback(
    (sourceId: string, targetId: string) => {
      if (sourceId === targetId) return;
      actions.setEdges((prev) => {
        if (prev.some((e) => e.source === sourceId && e.target === targetId)) return prev;
        return [
          ...prev,
          {
            id: crypto.randomUUID(),
            source: sourceId,
            target: targetId,
            label: "related",
            scopeId: state.currentScopeId || undefined,
          },
        ];
      });
    },
    [state.currentScopeId, actions]
  );

  const handleCreateFromSelection = useCallback(
    async (type: NodeType, selectionTooltip: any) => {
      if (!selectionTooltip) return;
      let newNodeX = 0, newNodeY = 0;
      const sourceNode = state.nodes.find((n) => n.id === selectionTooltip.sourceId);
      if (sourceNode) {
        newNodeX = sourceNode.x + (sourceNode.width || DEFAULT_NODE_WIDTH) + 50;
        newNodeY = sourceNode.y;
      } else {
        const vpW = window.innerWidth;
        const vpH = window.innerHeight;
        newNodeX = -state.viewTransform.x / state.viewTransform.k + vpW / 2 / state.viewTransform.k - DEFAULT_NODE_WIDTH / 2;
        newNodeY = -state.viewTransform.y / state.viewTransform.k + vpH / 2 / state.viewTransform.k - DEFAULT_NODE_HEIGHT / 2;
      }

      const promptTemplate = geminiService.getTopicSummaryPrompt(selectionTooltip.text);

      let initialContent: string;
      if (type === NodeType.CHAT) {
        initialContent = formatChatContent([
          { role: 'user', text: selectionTooltip.text },
          { role: 'assistant', text: '' }
        ]);
      } else {
        initialContent = `# ${selectionTooltip.text.length > 50 ? selectionTooltip.text.substring(0, 50) + '...' : selectionTooltip.text}\n\n${selectionTooltip.text}`;
      }

      const duplicateNode = findDuplicateNoteNode(state.nodes, { content: initialContent });
      if (duplicateNode) {
        actions.setSelectedNodeIds(new Set([duplicateNode.id]));
        if (selectionTooltip.sourceId && selectionTooltip.sourceId !== duplicateNode.id) {
          const labelText = selectionTooltip.text.length > 20
            ? selectionTooltip.text.substring(0, 20) + "..."
            : selectionTooltip.text;
          actions.setEdges((prev) => {
            const hasEdge = prev.some(
              (edge) =>
                edge.source === selectionTooltip.sourceId &&
                edge.target === duplicateNode.id
            );
            if (hasEdge) return prev;
            return [
              ...prev,
              {
                id: crypto.randomUUID(),
                source: selectionTooltip.sourceId!,
                target: duplicateNode.id,
                label: labelText,
                scopeId: state.currentScopeId || undefined,
              },
            ];
          });
        }
        actions.showToast("Skipped duplicate note.");
        return;
      }

      const newNode: GraphNode = {
        id: crypto.randomUUID(),
        type,
        x: newNodeX,
        y: newNodeY,
        content: initialContent,
        width: DEFAULT_NODE_WIDTH,
        height: DEFAULT_NODE_HEIGHT,
        parentId: state.currentScopeId || undefined,
        scopeId: state.currentScopeId || undefined,
      };

      actions.setNodes((prev) => [...prev, newNode]);
      actions.setSelectedNodeIds(new Set([newNode.id]));

      if (selectionTooltip.sourceId) {
        const labelText = selectionTooltip.text.length > 20
          ? selectionTooltip.text.substring(0, 20) + "..."
          : selectionTooltip.text;
        actions.setEdges((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            source: selectionTooltip.sourceId!,
            target: newNode.id,
            label: labelText,
            scopeId: state.currentScopeId || undefined,
          },
        ]);
      }

      if (type === NodeType.CHAT) {
        try {
          let currentText = "";
          const result = await (state.aiProvider === "huggingface" ? hfService : geminiService)
            .sendChatMessage([], promptTemplate, (chunk) => {
              currentText += chunk;
              actions.setNodes((prev) =>
                prev.map((n) =>
                  n.id === newNode.id
                    ? { ...n, content: updateLastAssistantMessage(n.content, currentText) }
                    : n
                )
              );
            });
          actions.setNodes((prev) =>
            prev.map((n) =>
              n.id === newNode.id
                ? { ...n, content: updateLastAssistantMessage(n.content, result.text) }
                : n
            )
          );
        } catch (e) {
          console.error("Failed to generate initial response", e);
        }
      }
    },
    [state.nodes, state.viewTransform, state.currentScopeId, state.aiProvider, actions]
  );

  const handleSearchSelect = useCallback(
    (topic: string, shouldExpand: boolean, isWiki: boolean = true) => {
      const duplicateNode = findDuplicateNoteByTitle(state.nodes, topic);
      if (duplicateNode) {
        actions.setSelectedNodeIds(new Set([duplicateNode.id]));

        const k = 1;
        const nodeCenterX = duplicateNode.x + (duplicateNode.width || DEFAULT_NODE_WIDTH) / 2;
        const nodeCenterY = duplicateNode.y + (duplicateNode.height || DEFAULT_NODE_HEIGHT) / 2;
        actions.setViewTransform({
          x: window.innerWidth / 2 - nodeCenterX * k,
          y: window.innerHeight / 2 - nodeCenterY * k,
          k,
        });

        if (shouldExpand) {
          callbacks.handleExpandNode(duplicateNode.id, topic, duplicateNode);
        }

        actions.showToast(`Skipped duplicate note "${topic}".`);
        return;
      }

      const vpW = window.innerWidth;
      const vpH = window.innerHeight;
      const centerX = -state.viewTransform.x / state.viewTransform.k + vpW / 2 / state.viewTransform.k - DEFAULT_NODE_WIDTH / 2;
      const centerY = -state.viewTransform.y / state.viewTransform.k + vpH / 2 / state.viewTransform.k - DEFAULT_NODE_HEIGHT / 2;

      const newNodeId = crypto.randomUUID();

      let initialContent: string;
      if (isWiki) {
        const wikiUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(topic.replace(/ /g, "_"))}`;
        initialContent = `# ${topic}\n\n**assistant**: Topic: ${topic}\n\n[Wikipedia](${wikiUrl})`;
      } else {
        initialContent = formatChatContent([
          { role: 'user', text: topic },
          { role: 'assistant', text: '' }
        ], topic);
      }

      const newNode: GraphNode = {
        id: newNodeId,
        type: NodeType.CHAT,
        x: centerX,
        y: centerY,
        content: initialContent,
        width: DEFAULT_NODE_WIDTH,
        height: DEFAULT_NODE_HEIGHT,
        color: isWiki ? "slate" : "green",
        parentId: state.currentScopeId || undefined,
      };

      actions.setNodes((prev) => [...prev, newNode]);

      if (shouldExpand) {
        callbacks.handleExpandNode(newNodeId, topic, newNode);
      }

      actions.setSelectedNodeIds(new Set([newNodeId]));

      const k = 1;
      const nodeCenterX = newNode.x + (newNode.width || DEFAULT_NODE_WIDTH) / 2;
      const nodeCenterY = newNode.y + (newNode.height || DEFAULT_NODE_HEIGHT) / 2;
      const newX = window.innerWidth / 2 - nodeCenterX * k;
      const newY = window.innerHeight / 2 - nodeCenterY * k;

      actions.setViewTransform({ x: newX, y: newY, k });

      if (!isWiki) {
        const prompt = geminiService.getTopicSummaryPrompt(topic);
        let currentText = "";

        const updateNodeContent = (text: string) => {
          actions.setNodes((prev) =>
            prev.map((n) =>
              n.id === newNodeId
                ? { ...n, content: updateLastAssistantMessage(n.content, text) }
                : n
            )
          );
        };

        (state.aiProvider === "huggingface" ? hfService : geminiService)
          .sendChatMessage([], prompt, (chunk) => {
            currentText += chunk;
            updateNodeContent(currentText);
          })
          .then((result) => {
            updateNodeContent(result.text);
          })
          .catch((err: any) => {
            if (err.message === "LIMIT_REACHED") {
              actions.showLimitModal();
              updateNodeContent("Limit reached.");
            } else {
              updateNodeContent("Error generating content.");
            }
          });
      }
    },
    [state.nodes, state.viewTransform, state.currentScopeId, state.aiProvider, callbacks, actions]
  );

  return useMemo(() => ({
    handleCreateNode,
    handleUpdateNode,
    handleDeleteNode,
    confirmDeleteNode,
    handleCut,
    handlePaste,
    handleConnectStart: useCallback(() => {}, []),
    handleConnectEnd,
    handleCreateFromSelection,
    handleSearchSelect,
  }), [
    handleCreateNode, handleUpdateNode, handleDeleteNode, confirmDeleteNode,
    handleCut, handlePaste, handleConnectEnd, handleCreateFromSelection, handleSearchSelect
  ]);
};

// --- Legacy interface for backward compatibility with App.tsx ---
// This will be removed once we migrate to GraphModeContainer

export const useGraphOperations = (
  nodes: GraphNode[],
  edges: GraphEdge[],
  setNodesCallback: (newNodes: GraphNode[] | ((prev: GraphNode[]) => GraphNode[])) => void,
  setEdgesCallback: (newEdges: GraphEdge[] | ((prev: GraphEdge[]) => GraphEdge[])) => void,
  currentScopeId: string | null,
  setCurrentScopeId: (id: string | null) => void,
  selectedNodeIds: Set<string>,
  setSelectedNodeIds: (ids: Set<string>) => void,
  viewTransform: ViewportTransform,
  setViewTransform: (t: ViewportTransform) => void,
  setToast: (toast: { visible: boolean; message: string; action?: () => void }) => void,
  setCutNodeId: (id: string | null) => void,
  cutNodeId: string | null,
  dirHandle: FileSystemDirectoryHandle | null,
  user: any,
  setShowLimitModal: (show: boolean) => void,
  aiProvider: 'gemini' | 'huggingface',
  handleExpandNode: (id: string, topic: string, node?: GraphNode) => void,
  deletedNodeRef: React.MutableRefObject<{ nodes: GraphNode[]; edges: GraphEdge[]; timer: number | null; } | null>,
  setActiveSidePanes: React.Dispatch<React.SetStateAction<any[]>>,
  startSimulation?: (trigger: SimulationTrigger, subtreeRootId?: string) => void,
  viewportStorageDeleteNode?: (nodeId: string) => Promise<void>,
  viewportRemoveNodesFromState?: (nodeIds: string[]) => void,
  viewportRestoreNodesToState?: (nodes: GraphNode[], edges: GraphEdge[]) => void
) => {
  // Get storage context for proper delete handling (fallback if viewportStorageDeleteNode not provided)
  const { deleteNode: contextDeleteNode } = useStorage();
  const storageDeleteNode = viewportStorageDeleteNode || contextDeleteNode;

  const handleCreateNode = useCallback(
    (node: GraphNode) => {
      setNodesCallback((prevNodes) => [...prevNodes, node]);
      setSelectedNodeIds(new Set([node.id]));
      setCurrentScopeId(node.parentId || null);
      // Pan view slightly when creating a node
      setViewTransform({
        ...viewTransform,
        x: viewTransform.x + 100,
        y: viewTransform.y + 100,
      });
    },
    [setNodesCallback, setSelectedNodeIds, setCurrentScopeId, setViewTransform, viewTransform]
  );

  const handleUpdateNode = useCallback(
    (id: string, updates: Partial<GraphNode>) => {
      setNodesCallback((prev) =>
        prev.map((n) => {
          if (n.id === id) {
            return { ...n, ...updates };
          }
          return n;
        })
      );
    },
    [setNodesCallback]
  );

  const handleCut = useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (node) {
        setCutNodeId(nodeId);
        setToast({
          visible: true,
          message: `Node '${node.content}' cut.`,
          action: () => setCutNodeId(null),
        });
      }
    },
    [nodes, setCutNodeId, setToast]
  );

  const handlePaste = useCallback(
    (position: { x: number; y: number }) => {
      if (cutNodeId) {
        const nodeToPaste = nodes.find((n) => n.id === cutNodeId);
        if (nodeToPaste) {
          const newNode: GraphNode = {
            ...nodeToPaste,
            id: uuidv4(),
            x: position.x,
            y: position.y,
          };

          handleCreateNode(newNode);
          setCutNodeId(null);
          setToast({
            visible: true,
            message: `Node '${newNode.content}' pasted.`,
          });
        }
      } else {
        setToast({ visible: true, message: "No node cut to paste." });
      }
    },
    [cutNodeId, nodes, handleCreateNode, setCutNodeId, setToast]
  );

  const confirmDeleteNode = useCallback(
    async (ids: string[]) => {
      const nodesToDelete = nodes.filter((n) => ids.includes(n.id));
      if (nodesToDelete.length === 0) return;

      const edgesToDelete = edges.filter(
        (e) => ids.includes(e.source) || ids.includes(e.target)
      );

      if (deletedNodeRef.current && deletedNodeRef.current.timer) {
        clearTimeout(deletedNodeRef.current.timer);
      }

      const idsSet = new Set(ids);

      // Update main state immediately
      setNodesCallback((prev) => prev.filter((node) => !ids.includes(node.id)));
      setEdgesCallback((prev) =>
        prev.filter(
          (edge) => !ids.includes(edge.source) && !ids.includes(edge.target)
        )
      );

      // Also update viewport storage state immediately (prevents sync effect from restoring deleted nodes)
      if (viewportRemoveNodesFromState) {
        viewportRemoveNodesFromState(ids);
      }

      // Physics simulation disabled - user can trigger manually via node menu
      // if (startSimulation) {
      //   setTimeout(() => {
      //     startSimulation('node-deletion');
      //   }, 0);
      // }

      if (cutNodeId && ids.includes(cutNodeId)) {
        setCutNodeId(null);
      }

      setActiveSidePanes((prev) =>
        prev.filter((pane) => !(pane.type === "node" && idsSet.has(pane.data)))
      );

      setSelectedNodeIds(new Set());

      const timer = window.setTimeout(async () => {
        // Use UnifiedStorageService for proper deletion across all storage backends
        for (const id of ids) {
          await storageDeleteNode(id);
        }
        deletedNodeRef.current = null;
      }, 5000);

      deletedNodeRef.current = {
        nodes: nodesToDelete,
        edges: edgesToDelete,
        timer,
      };

      setToast({
        visible: true,
        message: `${nodesToDelete.length} node(s) deleted`,
        action: () => {
          if (deletedNodeRef.current) {
            const {
              nodes: restoredNodes,
              edges: restoredEdges,
              timer,
            } = deletedNodeRef.current;

            if (timer) {
              clearTimeout(timer);
            }

            // Restore to main state
            setNodesCallback((prev) => [...prev, ...restoredNodes]);
            setEdgesCallback((prev) => [...prev, ...restoredEdges]);

            // Also restore to viewport storage state
            if (viewportRestoreNodesToState) {
              viewportRestoreNodesToState(restoredNodes, restoredEdges);
            }

            deletedNodeRef.current = null;
            setToast({ visible: false, message: "" });
          }
        },
      });
    },
    [nodes, edges, setNodesCallback, setEdgesCallback, cutNodeId, setCutNodeId, setActiveSidePanes, setSelectedNodeIds, deletedNodeRef, setToast, storageDeleteNode, viewportRemoveNodesFromState, viewportRestoreNodesToState]
  );

  const handleDeleteNode = useCallback(
    (id: string) => {
      // Always delete only the specific node that was requested
      // Multi-select delete should be explicit (e.g., via a separate "Delete All Selected" action)
      confirmDeleteNode([id]);
    },
    [confirmDeleteNode]
  );

  const handleConnectStart = useCallback((id: string) => {
    // This state is managed in App.tsx
  }, []);

  const handleConnectEnd = useCallback(
    (sourceId: string, targetId: string) => {
      if (sourceId === targetId) return;
      setEdgesCallback((prev) => {
        if (prev.some((e) => e.source === sourceId && e.target === targetId))
          return prev;
        return [
          ...prev,
          {
            id: crypto.randomUUID(),
            source: sourceId,
            target: targetId,
            label: "related",
            scopeId: currentScopeId || undefined,
          },
        ];
      });
    },
    [currentScopeId, setEdgesCallback]
  );

  const handleCreateFromSelection = useCallback(
    async (type: NodeType, selectionTooltip: any) => {
      if (!selectionTooltip) return;
      let newNodeX = 0,
        newNodeY = 0;
      const sourceNode = nodes.find((n) => n.id === selectionTooltip.sourceId);
      if (sourceNode) {
        newNodeX = sourceNode.x + (sourceNode.width || DEFAULT_NODE_WIDTH) + 50;
        newNodeY = sourceNode.y;
      } else {
        // Center in viewport
        const vpW = window.innerWidth;
        const vpH = window.innerHeight;
        newNodeX = -viewTransform.x / viewTransform.k + vpW / 2 / viewTransform.k - DEFAULT_NODE_WIDTH / 2;
        newNodeY = -viewTransform.y / viewTransform.k + vpH / 2 / viewTransform.k - DEFAULT_NODE_HEIGHT / 2;
      }

      const promptTemplate = geminiService.getTopicSummaryPrompt(selectionTooltip.text);

      // Build initial content based on node type
      let initialContent: string;
      if (type === NodeType.CHAT) {
        // Chat content: starts with user message and empty assistant response
        initialContent = formatChatContent([
          { role: 'user', text: selectionTooltip.text },
          { role: 'assistant', text: '' }
        ]);
      } else {
        // Note content: the selected text with a title
        initialContent = `# ${selectionTooltip.text.length > 50 ? selectionTooltip.text.substring(0, 50) + '...' : selectionTooltip.text}\n\n${selectionTooltip.text}`;
      }

      const duplicateNode = findDuplicateNoteNode(nodes, { content: initialContent });
      if (duplicateNode) {
        setSelectedNodeIds(new Set([duplicateNode.id]));
        if (selectionTooltip.sourceId && selectionTooltip.sourceId !== duplicateNode.id) {
          const labelText =
            selectionTooltip.text.length > 20
              ? selectionTooltip.text.substring(0, 20) + "..."
              : selectionTooltip.text;
          setEdgesCallback((prev) => {
            const hasEdge = prev.some(
              (edge) =>
                edge.source === selectionTooltip.sourceId &&
                edge.target === duplicateNode.id
            );
            if (hasEdge) return prev;
            return [
              ...prev,
              {
                id: crypto.randomUUID(),
                source: selectionTooltip.sourceId!,
                target: duplicateNode.id,
                label: labelText,
                scopeId: currentScopeId || undefined,
              },
            ];
          });
        }
        setToast({
          visible: true,
          message: "Skipped duplicate note.",
        });
        return;
      }

      const newNode: GraphNode = {
        id: crypto.randomUUID(),
        type,
        x: newNodeX,
        y: newNodeY,
        content: initialContent,
        width: DEFAULT_NODE_WIDTH,
        height: DEFAULT_NODE_HEIGHT,
        parentId: currentScopeId || undefined,
        scopeId: currentScopeId || undefined,
      };

      setNodesCallback((prev) => [...prev, newNode]);
      setSelectedNodeIds(new Set([newNode.id]));

      if (selectionTooltip.sourceId) {
        const labelText =
          selectionTooltip.text.length > 20
            ? selectionTooltip.text.substring(0, 20) + "..."
            : selectionTooltip.text;
        setEdgesCallback((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            source: selectionTooltip.sourceId!,
            target: newNode.id,
            label: labelText,
            scopeId: currentScopeId || undefined,
          },
        ]);
      }

      if (type === NodeType.CHAT) {
        try {
          let currentText = "";
          const result = await (aiProvider === "huggingface"
            ? hfService
            : geminiService
          ).sendChatMessage([], promptTemplate, (chunk) => {
            currentText += chunk;
            setNodesCallback((prev) =>
              prev.map((n) =>
                n.id === newNode.id
                  ? { ...n, content: updateLastAssistantMessage(n.content, currentText) }
                  : n
              )
            );
          });
          setNodesCallback((prev) =>
            prev.map((n) =>
              n.id === newNode.id
                ? { ...n, content: updateLastAssistantMessage(n.content, result.text) }
                : n
            )
          );
        } catch (e) {
          console.error("Failed to generate initial response", e);
        }
      }
    },
    [nodes, viewTransform, setNodesCallback, setEdgesCallback, currentScopeId, setSelectedNodeIds, aiProvider, setToast]
  );

  const handleSearchSelect = useCallback(
    (topic: string, shouldExpand: boolean, isWiki: boolean = true) => {
      const duplicateNode = findDuplicateNoteByTitle(nodes, topic);
      if (duplicateNode) {
        setSelectedNodeIds(new Set([duplicateNode.id]));

        const k = 1;
        const nodeCenterX = duplicateNode.x + (duplicateNode.width || DEFAULT_NODE_WIDTH) / 2;
        const nodeCenterY = duplicateNode.y + (duplicateNode.height || DEFAULT_NODE_HEIGHT) / 2;
        setViewTransform({
          x: window.innerWidth / 2 - nodeCenterX * k,
          y: window.innerHeight / 2 - nodeCenterY * k,
          k,
        });

        if (shouldExpand) {
          handleExpandNode(duplicateNode.id, topic, duplicateNode);
        }

        setToast({
          visible: true,
          message: `Skipped duplicate note "${topic}".`,
        });
        return;
      }

      const vpW = window.innerWidth;
      const vpH = window.innerHeight;
      const centerX = -viewTransform.x / viewTransform.k + vpW / 2 / viewTransform.k - DEFAULT_NODE_WIDTH / 2;
      const centerY = -viewTransform.y / viewTransform.k + vpH / 2 / viewTransform.k - DEFAULT_NODE_HEIGHT / 2;

      const newNodeId = crypto.randomUUID();

      // Build content based on type
      let initialContent: string;
      if (isWiki) {
        // Wiki topic: include link in body
        const wikiUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(topic.replace(/ /g, "_"))}`;
        initialContent = `# ${topic}\n\n**assistant**: Topic: ${topic}\n\n[Wikipedia](${wikiUrl})`;
      } else {
        // Chat: user message + empty assistant response
        initialContent = formatChatContent([
          { role: 'user', text: topic },
          { role: 'assistant', text: '' }
        ], topic);
      }

      const newNode: GraphNode = {
        id: newNodeId,
        type: NodeType.CHAT,
        x: centerX,
        y: centerY,
        content: initialContent,
        width: DEFAULT_NODE_WIDTH,
        height: DEFAULT_NODE_HEIGHT,
        color: isWiki ? "slate" : "green",
        parentId: currentScopeId || undefined,
      };

      setNodesCallback((prev) => [...prev, newNode]);

      if (shouldExpand) {
        handleExpandNode(newNodeId, topic, newNode);
      }

      setSelectedNodeIds(new Set([newNodeId]));

      const k = 1;
      const nodeCenterX = newNode.x + (newNode.width || DEFAULT_NODE_WIDTH) / 2;
      const nodeCenterY = newNode.y + (newNode.height || DEFAULT_NODE_HEIGHT) / 2;
      const newX = window.innerWidth / 2 - nodeCenterX * k;
      const newY = window.innerHeight / 2 - nodeCenterY * k;

      setViewTransform({ x: newX, y: newY, k });

      if (!isWiki) {
        const prompt = geminiService.getTopicSummaryPrompt(topic);
        let currentText = "";

        const updateNodeContent = (text: string) => {
          setNodesCallback((prev) =>
            prev.map((n) =>
              n.id === newNodeId
                ? { ...n, content: updateLastAssistantMessage(n.content, text) }
                : n
            )
          );
        };

        (aiProvider === "huggingface" ? hfService : geminiService)
          .sendChatMessage([], prompt, (chunk) => {
            currentText += chunk;
            updateNodeContent(currentText);
          })
          .then((result) => {
            updateNodeContent(result.text);
          })
          .catch((err: any) => {
            if (err.message === "LIMIT_REACHED") {
              setShowLimitModal(true);
              updateNodeContent("Limit reached.");
            } else {
              updateNodeContent("Error generating content.");
            }
          });
      }
    },
    [nodes, viewTransform, handleExpandNode, currentScopeId, setNodesCallback, setSelectedNodeIds, setViewTransform, aiProvider, setShowLimitModal, setToast]
  );

  return {
    handleCreateNode,
    handleUpdateNode,
    handleDeleteNode,
    confirmDeleteNode,
    handleCut,
    handlePaste,
    handleConnectStart,
    handleConnectEnd,
    handleCreateFromSelection,
    handleSearchSelect,
  };
};
