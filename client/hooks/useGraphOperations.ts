import { useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import { GraphNode, GraphEdge, NodeType, ChatMessage, ViewportTransform } from "../types";
import { DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT } from "../constants";
import * as geminiService from "../services/geminiService";
import * as hfService from "../services/huggingfaceService";
import { deleteNodeFile } from "../services/storageService";
import { deleteNodeFromApi } from "../services/apiStorageService";

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
  setActiveSidePanes: React.Dispatch<React.SetStateAction<any[]>>
) => {

  const handleCreateNode = useCallback(
    (node: GraphNode) => {
      setNodesCallback((prevNodes) => [...prevNodes, node]);
      setSelectedNodeIds(new Set([node.id]));
      setCurrentScopeId(node.parentId || null);
      setViewTransform((prevTransform) => ({
        ...prevTransform,
        x: prevTransform.x + 100,
        y: prevTransform.y + 100,
      }));
    },
    [setNodesCallback, setSelectedNodeIds, setCurrentScopeId, setViewTransform]
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

      setNodesCallback((prev) => prev.filter((node) => !ids.includes(node.id)));
      setEdgesCallback((prev) =>
        prev.filter(
          (edge) => !ids.includes(edge.source) && !ids.includes(edge.target)
        )
      );
      
      if (cutNodeId && ids.includes(cutNodeId)) {
        setCutNodeId(null);
      }

      setActiveSidePanes((prev) =>
        prev.filter((pane) => !(pane.type === "node" && idsSet.has(pane.data)))
      );

      setSelectedNodeIds(new Set());

      const timer = window.setTimeout(async () => {
        if (dirHandle) {
          for (const id of ids) {
            await deleteNodeFile(dirHandle, id);
          }
        } else if (user) {
          for (const id of ids) {
            await deleteNodeFromApi(id);
          }
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

            setNodesCallback((prev) => [...prev, ...restoredNodes]);
            setEdgesCallback((prev) => [...prev, ...restoredEdges]);

            deletedNodeRef.current = null;
            setToast({ visible: false, message: "" });
          }
        },
      });
    },
    [nodes, edges, setNodesCallback, setEdgesCallback, cutNodeId, setCutNodeId, setActiveSidePanes, setSelectedNodeIds, dirHandle, user, deletedNodeRef, setToast]
  );

  const handleDeleteNode = useCallback(
    (id: string) => {
      if (selectedNodeIds.has(id)) {
        confirmDeleteNode(Array.from(selectedNodeIds));
      } else {
        confirmDeleteNode([id]);
      }
    },
    [confirmDeleteNode, selectedNodeIds]
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
            parentId: currentScopeId || undefined,
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
        const canvasX = (selectionTooltip.x - viewTransform.x) / viewTransform.k;
        const canvasY = (selectionTooltip.y - viewTransform.y) / viewTransform.k;
        newNodeX = canvasX + 100;
        newNodeY = canvasY + 50;
      }

      const promptTemplate = geminiService.getTopicSummaryPrompt(selectionTooltip.text);
      const initialMessages: ChatMessage[] =
        type === NodeType.CHAT
          ? [
              {
                role: "user",
                text: selectionTooltip.text,
                timestamp: Date.now(),
              },
            ]
          : [];
      const initialModelMsg: ChatMessage | undefined =
        type === NodeType.CHAT
          ? { role: "model", text: "", timestamp: Date.now() }
          : undefined;
      const startMessages =
        type === NodeType.CHAT && initialModelMsg
          ? [...initialMessages, initialModelMsg]
          : initialMessages;

      const newNode: GraphNode = {
        id: crypto.randomUUID(),
        type,
        x: newNodeX,
        y: newNodeY,
        content:
          type === NodeType.NOTE
            ? selectionTooltip.text
            : selectionTooltip.text.length > 30
            ? selectionTooltip.text.substring(0, 30) + "..."
            : selectionTooltip.text,
        messages: startMessages,
        width: DEFAULT_NODE_WIDTH,
        height: DEFAULT_NODE_HEIGHT,
        parentId: currentScopeId || undefined,
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
            parentId: currentScopeId || undefined,
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
                n.id === newNode.id && n.messages
                  ? {
                      ...n,
                      messages: [
                        ...n.messages.slice(0, -1),
                        {
                          ...n.messages[n.messages.length - 1],
                          text: currentText,
                        },
                      ],
                    }
                  : n
              )
            );
          });
          setNodesCallback((prev) =>
            prev.map((n) =>
              n.id === newNode.id && n.messages
                ? {
                    ...n,
                    messages: [
                      ...n.messages.slice(0, -1),
                      {
                        ...n.messages[n.messages.length - 1],
                        text: result.text,
                      },
                    ],
                  }
                : n
            )
          );
        } catch (e) {
          console.error("Failed to generate initial response", e);
        }
      }
    },
    [nodes, viewTransform, setNodesCallback, setEdgesCallback, currentScopeId, setSelectedNodeIds, aiProvider]
  );

  const handleSearchSelect = useCallback(
    (topic: string, shouldExpand: boolean, isWiki: boolean = true) => {
      const vpW = window.innerWidth;
      const vpH = window.innerHeight;
      const centerX = -viewTransform.x / viewTransform.k + vpW / 2 / viewTransform.k - DEFAULT_NODE_WIDTH / 2;
      const centerY = -viewTransform.y / viewTransform.k + vpH / 2 / viewTransform.k - DEFAULT_NODE_HEIGHT / 2;

      const newNodeId = crypto.randomUUID();

      const initialMessages: ChatMessage[] = isWiki
        ? [{ role: "model", text: `Topic: ${topic}`, timestamp: Date.now() }]
        : [
            { role: "user", text: topic, timestamp: Date.now() },
            { role: "model", text: "", timestamp: Date.now() },
          ];

      const newNode: GraphNode = {
        id: newNodeId,
        type: NodeType.CHAT,
        x: centerX,
        y: centerY,
        content: topic,
        width: DEFAULT_NODE_WIDTH,
        height: DEFAULT_NODE_HEIGHT,
        link: isWiki
          ? `https://en.wikipedia.org/wiki/${encodeURIComponent(topic.replace(/ /g, "_"))}`
          : undefined,
        color: isWiki ? "slate" : "green",
        messages: initialMessages,
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

        const updateNodeMessage = (text: string) => {
          setNodesCallback((prev) =>
            prev.map((n) => {
              if (n.id === newNodeId && n.messages) {
                const newMsgs = [...n.messages];
                const lastMsg = newMsgs[newMsgs.length - 1];
                if (lastMsg.role === "model") {
                  newMsgs[newMsgs.length - 1] = { ...lastMsg, text };
                }
                return { ...n, messages: newMsgs };
              }
              return n;
            })
          );
        };

        (aiProvider === "huggingface" ? hfService : geminiService)
          .sendChatMessage([], prompt, (chunk) => {
            currentText += chunk;
            updateNodeMessage(currentText);
          })
          .then((result) => {
            updateNodeMessage(result.text);
          })
          .catch((err: any) => {
            if (err.message === "LIMIT_REACHED") {
              setShowLimitModal(true);
              updateNodeMessage("Limit reached.");
            } else {
              updateNodeMessage("Error generating content.");
            }
          });
      }
    },
    [viewTransform, handleExpandNode, currentScopeId, setNodesCallback, setSelectedNodeIds, setViewTransform, aiProvider, setShowLimitModal]
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

