import React, { useState, useEffect, useRef, useCallback } from "react";
import { Canvas } from "./components/Canvas";
import { SidePanel, WebContent } from "./components/SidePanel";
import { GraphNodeComponent } from "./components/GraphNode";
import { SearchBar } from "./components/SearchBar";
import { NodeListDrawer } from "./components/NodeListDrawer";
import { AuthPage } from "./components/AuthPage";
import { LimitModal } from "./components/LimitModal";
import { UpgradeModal } from "./components/UpgradeModal";
import { ProfilePage } from "./components/ProfilePage";
import { Toast } from "./components/Toast";
import { ErrorBoundary } from "./components/ErrorBoundary";
import {
  GraphEdge,
  GraphNode,
  NodeType,
  ViewportTransform,
  ChatMessage,
} from "./types";
import { DEFAULT_NODE_HEIGHT, DEFAULT_NODE_WIDTH } from "./constants";
import {
  pickDirectory,
  loadGraphFromDirectory,
  saveNodeToFile,
  deleteNodeFile,
  saveEdgesToFile,
} from "./services/storageService";
import {
  pickServerDirectory,
  updateUserSettings,
  loadGraphFromApi,
  saveNodeToApi,
  deleteNodeFromApi,
  saveEdgesToApi,
} from "./services/apiStorageService";
import {
  expandNodeTopic,
  sendChatMessage,
  getTopicSummaryPrompt,
  findRelationships,
} from "./services/geminiService";
import { fetchWikidataSubtopics } from "./services/wikidataService";

const LOCAL_STORAGE_KEY = "wiki-graph-data";
const WIKIDATA_SUBTOPIC_LIMIT = 12;
const WIKIDATA_MAX_RECURSIVE_NODES_PER_LEVEL = 5;

// Helper to parse text into nodes locally without API call
const parseTextToNodes = (text: string) => {
  const subNodes: { name: string; description: string; indent: number }[] = [];

  const lines = text.split("\n");
  // Check if it looks like a list (heuristic: has bullet points or numbers)
  const listLines = lines.filter((l) => /^\s*([-*•]|\d+\.)/.test(l));
  const isList =
    listLines.length > 0 &&
    listLines.length > lines.filter((l) => l.trim()).length * 0.3;

  if (isList) {
    lines.forEach((line) => {
      // Match indentation group (1), bullet group (2), content group (3)
      const match = line.match(/^(\s*)([-*•]|\d+\.)\s+(.*)/);
      if (match) {
        const rawIndent = match[1];
        // Normalize tabs to 4 spaces for calculation
        const indent = rawIndent.replace(/\t/g, "    ").length;
        const content = match[3].trim();
        if (content) {
          subNodes.push({
            name: content.substring(0, 30) + (content.length > 30 ? "..." : ""),
            description: content,
            indent: indent,
          });
        }
      }
    });
  } else {
    // Fallback: split by paragraphs
    const paragraphs = text.split(/\n\s*\n/);
    paragraphs.forEach((p) => {
      const clean = p.trim();
      if (!clean) return;
      // Try to extract a "bold" title **Title**
      const boldMatch = clean.match(/^\*\*(.*?)\*\*/);
      let name = boldMatch ? boldMatch[1] : clean.split(".")[0];
      if (name.length > 40) name = name.substring(0, 40) + "...";

      subNodes.push({ name, description: clean, indent: 0 });
    });
  }
  return subNodes;
};

const App: React.FC = () => {
  // Initial State with LocalStorage check
  const [nodes, setNodes] = useState<GraphNode[]>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.nodes && Array.isArray(parsed.nodes)) return parsed.nodes;
      }
    } catch (e) {
      console.error("Failed to load from local storage", e);
    }

    // Default Welcome Node
    return [
      {
        id: "1",
        type: NodeType.CHAT,
        x: window.innerWidth / 2 - DEFAULT_NODE_WIDTH / 2,
        y: window.innerHeight / 2 - DEFAULT_NODE_HEIGHT / 2,
        content: "Infoverse",
        messages: [
          {
            role: "model",
            text: "Welcome to Infoverse! \n\nI am an infinite, AI-powered knowledge canvas. \n\nAsk me anything to visualize a topic, or click the expand icon (top right) to discover related concepts.",
            timestamp: Date.now(),
          },
        ],
        width: DEFAULT_NODE_WIDTH,
        height: DEFAULT_NODE_HEIGHT,
      },
    ];
  });

  const [edges, setEdges] = useState<GraphEdge[]>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.edges && Array.isArray(parsed.edges)) return parsed.edges;
      }
    } catch (e) {
      console.error("Failed to load edges from local storage", e);
    }
    return [];
  });

  const [autoGraphEnabled, setAutoGraphEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return parsed.autoGraphEnabled !== undefined
          ? !!parsed.autoGraphEnabled
          : true;
      }
    } catch (e) {}
    return true;
  });

  // Viewport State (lifted from Canvas)
  const [viewTransform, setViewTransform] = useState<ViewportTransform>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.viewTransform) return parsed.viewTransform;
      }
    } catch (e) {
      console.error("Failed to load viewTransform from local storage", e);
    }
    return { x: 0, y: 0, k: 1 };
  });

  // UI State
  const [currentScopeId, setCurrentScopeId] = useState<string | null>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return parsed.currentScopeId || null;
      }
    } catch (e) {}
    return null;
  });

  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Migration: Check for old selectedNodeId (string) or new selectedNodeIds (array)
        if (parsed.selectedNodeIds && Array.isArray(parsed.selectedNodeIds)) {
          return new Set(parsed.selectedNodeIds);
        }
        if (parsed.selectedNodeId) {
          return new Set([parsed.selectedNodeId]);
        }
      }
    } catch (e) {}
    return new Set();
  });

  const selectedNodeId =
    selectedNodeIds.size === 1 ? Array.from(selectedNodeIds)[0] : null;
  const setSelectedNodeId = useCallback((id: string | null) => {
    if (id === null) setSelectedNodeIds(new Set());
    else setSelectedNodeIds(new Set([id]));
  }, []);

  const [activeSidePane, setActiveSidePane] = useState<{
    type: "web" | "node";
    data: string;
  } | null>(null);
  const [expandingNodeIds, setExpandingNodeIds] = useState<string[]>([]);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [connectingNodeId, setConnectingNodeId] = useState<string | null>(null);

  // Undo/Toast State
  const [toast, setToast] = useState<{
    visible: boolean;
    message: string;
    action?: () => void;
  }>({ visible: false, message: "" });

  const wikidataExpansionInFlightRef = useRef<Set<string>>(new Set());

  const deletedNodeRef = useRef<{
    nodes: GraphNode[];
    edges: GraphEdge[];
    timer: number | null;
  } | null>(null);

  // File System State
  const [dirHandle, setDirHandle] = useState<FileSystemDirectoryHandle | null>(
    null
  );
  const [dirName, setDirName] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isGraphLoaded, setIsGraphLoaded] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  // --- Auth State ---
  const [user, setUser] = useState<{
    id: string;
    username: string;
    email?: string;
    storagePath?: string;
    isPaid?: boolean;
  } | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [showProfile, setShowProfile] = useState(false);
  const [usageNotification, setUsageNotification] = useState<{
    message: string;
    visible: boolean;
  }>({ message: "", visible: false });

  // Usage check function
  const checkUsage = useCallback((currentCount: number) => {
    const limit = 100;
    const percentage = (currentCount / limit) * 100;
    let message = "";

    if (currentCount >= limit) {
      message =
        "100% Storage Used (100/100 nodes). Upgrade to unlimited for $8/mo.";
    } else if (percentage >= 80) {
      message = `80% Storage Used (${currentCount}/${limit} nodes). Upgrade for unlimited storage.`;
    } else if (percentage >= 50 && percentage < 51) {
      // Show only once around 50
      message = `50% Storage Used (${currentCount}/${limit} nodes).`;
    } else if (percentage >= 20 && percentage < 21) {
      // Show only once around 20
      message = `20% Storage Used (${currentCount}/${limit} nodes).`;
    }

    // Simple logic to show notification if we hit thresholds
    // A better way would be to track 'lastNotifiedPercentage' in state
    // For now, we will rely on the server response count

    if (message) {
      setUsageNotification({ message, visible: true });
      // Auto hide after 5s
      setTimeout(
        () => setUsageNotification((prev) => ({ ...prev, visible: false })),
        5000
      );
    }
  }, []);

  const [showLimitModal, setShowLimitModal] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  const prevNodesRef = useRef<GraphNode[]>(nodes);
  const prevEdgesRef = useRef<GraphEdge[]>(edges);

  // --- Check Auth on Mount ---
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const apiBase = (import.meta as any).env.VITE_API_URL || "";
        const res = await fetch(`${apiBase}/api/auth/check`, {
          credentials: "include",
        });
        const data = await res.json();
        if (data.isAuthenticated) {
          setUser(data.user);

          // Cloud User (Paid OR Free): Auto-connect
          if (data.user) {
            setDirName("Cloud Storage");
            // Load graph
            loadGraphFromApi()
              .then(({ nodes, edges }) => {
                if (nodes && nodes.length > 0) {
                  setNodes(nodes);
                  setEdges(edges);

                  // Initial usage check for free users
                  if (!data.user.isPaid) {
                    // Count nodes
                    // Since we just loaded, we know the count
                    // But we need a persistent way to track if we already notified for 20/50/80%
                    // For simplicity, the server only sends notifications on SAVE.
                    // But we can check here too.
                  }
                }
                setIsGraphLoaded(true);
              })
              .catch((e) => {
                console.error("Cloud load failed", e);
                setIsGraphLoaded(true);
              });
          } else {
            setIsGraphLoaded(true);
          }

          // Redirect to app.infoverse.ai if on root domain
          if (
            window.location.hostname === "infoverse.ai" &&
            !window.location.hostname.startsWith("app.")
          ) {
            window.location.href = `https://app.infoverse.ai${window.location.pathname}`;
          }
        } else {
          setIsGraphLoaded(true);
          // Redirect to infoverse.ai if on app subdomain and NOT authenticated
          if (window.location.hostname === "app.infoverse.ai") {
            window.location.href = `https://infoverse.ai${window.location.pathname}`;
          }
        }
      } catch (err) {
        console.error("Auth check failed", err);
        setIsGraphLoaded(true);
      }
    };
    checkAuth();
  }, []);

  const handleLogout = async () => {
    try {
      const apiBase = (import.meta as any).env.VITE_API_URL || "";
      await fetch(`${apiBase}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
      setUser(null);
      setDirHandle(null);
      setDirName(null);
      // Optional: clear graph?
      // setNodes([]);
      // setEdges([]);
    } catch (err) {
      console.error("Logout failed", err);
    }
  };

  // --- Automatic Connection Discovery ---
  useEffect(() => {
    // Only trigger if node count increased (new node added)
    if (nodes.length <= prevNodesRef.current.length) return;

    const newNode = nodes[nodes.length - 1];
    if (!newNode.content || newNode.content.length < 3) return;

    const potentialTargets = nodes
      .filter(
        (n) =>
          n.id !== newNode.id &&
          n.content.length > 3 &&
          n.parentId === currentScopeId
      )
      .slice(-10);

    const discoverConnections = async () => {
      try {
        const relationships = await findRelationships(
          { id: newNode.id, content: newNode.content },
          potentialTargets.map((n) => ({ id: n.id, content: n.content }))
        );

        if (relationships.length > 0) {
          setEdges((prev) => {
            const newEdges = [...prev];
            relationships.forEach((rel) => {
              const exists = newEdges.some(
                (e) =>
                  (e.source === newNode.id && e.target === rel.targetId) ||
                  (e.source === rel.targetId && e.target === newNode.id)
              );

              if (!exists) {
                newEdges.push({
                  id: crypto.randomUUID(),
                  source: newNode.id,
                  target: rel.targetId,
                  label: rel.relationship,
                  parentId: currentScopeId || undefined,
                });
              }
            });
            return newEdges;
          });
        }
      } catch (e: any) {
        if (e.message === "LIMIT_REACHED") {
          // Silently fail for background auto-discovery or show modal?
          // Usually annoying to show modal for background task, but user might want to know
          // Let's just log it for now to avoid interrupting if they are just typing
          console.log("Limit reached during background relationship discovery");
        } else {
          console.error("Failed to discover connections", e);
        }
      }
    };

    const timer = setTimeout(discoverConnections, 2000);
    return () => clearTimeout(timer);
  }, [nodes.length, currentScopeId]);

  // --- Local Storage Auto-Save ---
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      const data = {
        nodes,
        edges,
        viewTransform,
        autoGraphEnabled,
        currentScopeId,
        selectedNodeIds: Array.from(selectedNodeIds),
      };
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
    }, 1000);

    return () => clearTimeout(timeoutId);
  }, [
    nodes,
    edges,
    viewTransform,
    autoGraphEnabled,
    currentScopeId,
    selectedNodeIds,
  ]);

  // --- File System Sync Effects ---

  useEffect(() => {
    // If using cloud storage (user) or browser FS handle
    if (!dirHandle && !user) return;
    if (!isGraphLoaded) return;

    // Save all edges when they change
    const timeout = setTimeout(async () => {
      setIsSaving(true);
      try {
        if (dirHandle) {
          await saveEdgesToFile(dirHandle, edges);
        } else if (user) {
          // Cloud Storage (for all users)
          await saveEdgesToApi(edges);
        }
      } catch (e) {
        console.error("Failed to sync edges", e);
      } finally {
        setIsSaving(false);
      }
    }, 2000);
    return () => clearTimeout(timeout);
  }, [edges, dirHandle, user, isGraphLoaded]);

  const saveNodeToDisk = useCallback(
    async (node: GraphNode) => {
      if (!dirHandle && !user) return;
      if (!isGraphLoaded) return;
      setIsSaving(true);
      try {
        if (dirHandle) {
          await saveNodeToFile(dirHandle, node);
        } else if (user) {
          const res = await saveNodeToApi(node);
          if (res.count !== undefined) {
            checkUsage(res.count);
          }
          if (res.code === "STORAGE_LIMIT") {
            setUsageNotification({ message: res.message, visible: true });
            setShowUpgradeModal(true);
          }
        }
      } catch (e) {
        console.error("Failed to save node", node.id, e);
      } finally {
        setIsSaving(false);
      }
    },
    [dirHandle, user, isGraphLoaded, checkUsage]
  );

  const deleteNodeFromDisk = useCallback(
    async (id: string) => {
      if (!dirHandle && !user) return;
      if (!isGraphLoaded) return;
      setIsSaving(true);
      try {
        if (dirHandle) {
          await deleteNodeFile(dirHandle, id);
        } else if (user) {
          await deleteNodeFromApi(id);
        }
      } catch (e) {
        console.error("Failed to delete node", id, e);
      } finally {
        setIsSaving(false);
      }
    },
    [dirHandle, user, isGraphLoaded]
  );

  // --- Initial Center on Selected Node ---
  useEffect(() => {
    // If we have a selected node from storage, center on it
    if (selectedNodeIds.size > 0) {
      const primaryId = Array.from(selectedNodeIds)[0];
      const node = nodes.find((n) => n.id === primaryId);
      if (node) {
        // Use k=1 for focus view
        const k = 1;
        const nodeW = node.width || DEFAULT_NODE_WIDTH;
        const nodeH = node.height || DEFAULT_NODE_HEIGHT;

        const nodeCenterX = node.x + nodeW / 2;
        const nodeCenterY = node.y + nodeH / 2;

        const newX = window.innerWidth / 2 - nodeCenterX * k;
        const newY = window.innerHeight / 2 - nodeCenterY * k;

        setViewTransform({ x: newX, y: newY, k });
      }
    }
  }, []); // Run once on mount

  // --- Node Operations ---
  const handleNodeSelect = useCallback(
    (id: string | null, multi: boolean = false) => {
      if (id === null) {
        if (!multi) setSelectedNodeIds(new Set());
        return;
      }

      setSelectedNodeIds((prev) => {
        if (!multi) return new Set([id]);

        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    []
  );

  const handleBoxSelect = useCallback(
    (ids: string[], multi: boolean = false) => {
      setSelectedNodeIds((prev) => {
        if (!multi) return new Set(ids);
        const next = new Set(prev);
        ids.forEach((id) => next.add(id));
        return next;
      });
    },
    []
  );

  const handleUpdateNode = useCallback(
    (id: string, updates: Partial<GraphNode>) => {
      setNodes((prev) =>
        prev.map((n) => {
          if (n.id === id) {
            const updated = { ...n, ...updates };
            // Sync to disk if folder open
            if (dirHandle || user?.storagePath) saveNodeToDisk(updated);
            return updated;
          }
          return n;
        })
      );
    },
    [dirHandle, user, saveNodeToDisk]
  );

  const confirmDeleteNode = useCallback(
    async (ids: string[]) => {
      // 1. Snapshot state for Undo
      const nodesToDelete = nodes.filter((n) => ids.includes(n.id));
      if (nodesToDelete.length === 0) return;

      const edgesToDelete = edges.filter(
        (e) => ids.includes(e.source) || ids.includes(e.target)
      );

      // Clear any pending deletion timer
      if (deletedNodeRef.current && deletedNodeRef.current.timer) {
        clearTimeout(deletedNodeRef.current.timer);
      }

      const idsSet = new Set(ids);

      // 2. Optimistic Update (Remove from UI)
      setNodes((prev) => prev.filter((n) => !idsSet.has(n.id)));
      setEdges((prev) =>
        prev.filter((e) => !idsSet.has(e.source) && !idsSet.has(e.target))
      );

      if (activeSidePane?.type === "node" && idsSet.has(activeSidePane.data)) {
        setActiveSidePane(null);
      }

      setSelectedNodeIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });

      // 3. Set up Soft Delete / Undo Timer
      // We wait 5 seconds before actually deleting from disk/API
      const timer = window.setTimeout(async () => {
        if (dirHandle || user?.storagePath) {
          for (const id of ids) {
            await deleteNodeFromDisk(id);
          }
        }
        deletedNodeRef.current = null; // Clear undo history
      }, 5000);

      deletedNodeRef.current = {
        nodes: nodesToDelete,
        edges: edgesToDelete,
        timer,
      };

      // 4. Show Toast
      setToast({
        visible: true,
        message: `${nodesToDelete.length} node(s) deleted`,
        action: () => {
          // Undo Logic
          if (deletedNodeRef.current) {
            const {
              nodes: restoredNodes,
              edges: restoredEdges,
              timer,
            } = deletedNodeRef.current;

            if (timer) {
              clearTimeout(timer);
            }

            setNodes((prev) => [...prev, ...restoredNodes]);
            setEdges((prev) => [...prev, ...restoredEdges]);

            deletedNodeRef.current = null;
            setToast((prev) => ({ ...prev, visible: false }));
          }
        },
      });
    },
    [nodes, edges, activeSidePane, dirHandle, user, deleteNodeFromDisk]
  );

  const handleDeleteNode = useCallback(
    (id: string) => {
      // If the target node is part of the selection, delete ALL selected nodes.
      // Otherwise, just delete the target node.
      if (selectedNodeIds.has(id)) {
        confirmDeleteNode(Array.from(selectedNodeIds));
      } else {
        confirmDeleteNode([id]);
      }
    },
    [confirmDeleteNode, selectedNodeIds]
  );

  // Keyboard Shortcuts (Undo, Delete)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement as HTMLElement;
      const isInputActive =
        activeEl &&
        (["INPUT", "TEXTAREA"].includes(activeEl.tagName) ||
          activeEl.isContentEditable);

      // Undo (Ctrl+Z / Cmd+Z)
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        if (toast.visible && toast.action) {
          e.preventDefault();
          toast.action();
        }
      }

      // Delete (Delete / Backspace)
      if ((e.key === "Delete" || e.key === "Backspace") && !isInputActive) {
        if (selectedNodeIds.size > 0) {
          e.preventDefault();
          confirmDeleteNode(Array.from(selectedNodeIds));
        }
      }

      // Search (Ctrl+F / Cmd+F)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setIsSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toast, selectedNodeIds, handleDeleteNode, confirmDeleteNode]);

  const handleExpandNode = useCallback(
    async (
      id: string,
      topic: string,
      nodeOverride?: GraphNode,
      depth?: number
    ) => {
      setExpandingNodeIds((prev) => [...prev, id]);

      const sourceNode = nodeOverride || nodes.find((n) => n.id === id);
      if (!sourceNode) {
        setExpandingNodeIds((prev) => prev.filter((nId) => nId !== id));
        return;
      }

      const depthToUse =
        depth !== undefined ? depth : sourceNode.autoExpandDepth || 1;

      try {
        const isSelfExpansion =
          sourceNode.content.trim().toLowerCase() ===
          topic.trim().toLowerCase();
        // Improved heuristic for local breakdown vs knowledge expansion
        const isList = /^\s*[-*•]|\d+\./m.test(topic);
        const isContentBreakdown =
          topic.length > 100 || topic.includes("\n") || isList;

        let parentNodeId = id;
        let parentNodeX = sourceNode.x;
        let parentNodeY = sourceNode.y;

        const nodesToAdd: GraphNode[] = [];
        const edgesToAdd: GraphEdge[] = [];
        let topicNode: GraphNode | null = null;
        let nextNodesToExpand: GraphNode[] = [];

        if (!isSelfExpansion && !isContentBreakdown) {
          const topicNodeId = crypto.randomUUID();
          const angle = Math.random() * 2 * Math.PI;
          const offset = 500; // Standardized Edge Length

          parentNodeX = sourceNode.x + offset * Math.cos(angle);
          parentNodeY = sourceNode.y + offset * Math.sin(angle);

          topicNode = {
            id: topicNodeId,
            type: NodeType.CHAT,
            x: parentNodeX,
            y: parentNodeY,
            content: topic,
            width: DEFAULT_NODE_WIDTH,
            height: DEFAULT_NODE_HEIGHT,
            parentId: currentScopeId || undefined,
            autoExpandDepth: sourceNode.autoExpandDepth, // Inherit expansion settings
            messages: [
              {
                role: "model",
                text: `Expanded topic from "${sourceNode.content}".`,
                timestamp: Date.now(),
              },
            ],
          };

          nodesToAdd.push(topicNode);
          edgesToAdd.push({
            id: crypto.randomUUID(),
            source: id,
            target: topicNodeId,
            label: "includes",
            parentId: currentScopeId || undefined,
          });

          parentNodeId = topicNodeId;
        }

        if (isContentBreakdown) {
          // --- Local Parsing Mode with Hierarchical Logic ---
          const subItems = parseTextToNodes(topic);

          // Stack to manage parent context based on indentation
          // Initial context is the source node (or topic node)
          const stack = [
            { indent: -1, id: parentNodeId, x: parentNodeX, y: parentNodeY },
          ];

          subItems.forEach((item, i) => {
            // Algorithm:
            // 1. Find the correct parent. The parent is the node on the stack with indentation strictly less than current item.
            //    If stack top indent >= item indent, pop stack (we are ending that child's scope).
            while (
              stack.length > 1 &&
              stack[stack.length - 1].indent >= item.indent
            ) {
              stack.pop();
            }

            const parent = stack[stack.length - 1];

            const newNodeId = crypto.randomUUID();

            // Place node relative to its specific parent
            // Random angle and distance for organic tree feel
            const angle = Math.random() * 2 * Math.PI;
            const dist = 500; // Standardized Edge Length

            const newNodeX = parent.x + dist * Math.cos(angle);
            const newNodeY = parent.y + dist * Math.sin(angle);

            const newNode: GraphNode = {
              id: newNodeId,
              type: NodeType.CHAT,
              x: newNodeX,
              y: newNodeY,
              content: item.name,
              width: DEFAULT_NODE_WIDTH,
              height: DEFAULT_NODE_HEIGHT,
              parentId: currentScopeId || undefined,
              summary: item.description,
              autoExpandDepth: sourceNode.autoExpandDepth,
              messages: [
                {
                  role: "model",
                  text: item.description,
                  timestamp: Date.now(),
                },
              ],
            };

            nodesToAdd.push(newNode);

            edgesToAdd.push({
              id: crypto.randomUUID(),
              source: parent.id,
              target: newNodeId,
              label: item.indent > parent.indent ? "sub-item" : "related",
              parentId: currentScopeId || undefined,
            });

            // Push current node to stack as a potential parent for subsequent items
            stack.push({
              indent: item.indent,
              id: newNodeId,
              x: newNodeX,
              y: newNodeY,
            });
          });
        } else {
          // --- Gemini API Mode ---
          const existingNodeNames = nodes
            .filter((n) => n.parentId === currentScopeId)
            .map((n) => n.content);
          const result = await expandNodeTopic(topic, existingNodeNames);

          if (topicNode && result.mainTopic) {
            topicNode.content = result.mainTopic;
          }

          if (result.nodes.length > 0) {
            // Standardized Circular Placement
            const fixedRadius = 500; // Standardized Edge Length
            const startAngle = Math.random() * Math.PI;

            const subNodes: GraphNode[] = result.nodes.map((n, i) => {
              // Distribute evenly in a circle to maintain roughly equal edge length
              const angle =
                startAngle + (i / result.nodes.length) * 2 * Math.PI;

              return {
                id: crypto.randomUUID(),
                type: NodeType.CHAT,
                x: parentNodeX + fixedRadius * Math.cos(angle),
                y: parentNodeY + fixedRadius * Math.sin(angle),
                content: n.name,
                width: DEFAULT_NODE_WIDTH,
                height: DEFAULT_NODE_HEIGHT,
                link: n.wikiLink,
                parentId: currentScopeId || undefined,
                summary: n.description, // Store description for semantic zoom
                autoExpandDepth: sourceNode.autoExpandDepth,
                messages: [
                  {
                    role: "model",
                    text: n.description,
                    timestamp: Date.now(),
                  },
                ],
              };
            });

            nodesToAdd.push(...subNodes);
            nextNodesToExpand = subNodes; // Mark these for potential recursion

            // Connect edges
            result.edges.forEach((e) => {
              const targetSubNode = subNodes.find(
                (sn) => sn.content === e.targetName
              );
              const targetExistingNode = nodes.find(
                (n) =>
                  n.content === e.targetName && n.parentId === currentScopeId
              );

              if (targetSubNode) {
                edgesToAdd.push({
                  id: crypto.randomUUID(),
                  source: parentNodeId,
                  target: targetSubNode.id,
                  label: e.relationship,
                  parentId: currentScopeId || undefined,
                });
              } else if (targetExistingNode) {
                edgesToAdd.push({
                  id: crypto.randomUUID(),
                  source: parentNodeId,
                  target: targetExistingNode.id,
                  label: e.relationship,
                  parentId: currentScopeId || undefined,
                });
              }
            });

            // Fallback connectivity
            subNodes.forEach((sn) => {
              const isConnected = edgesToAdd.some((e) => e.target === sn.id);
              if (!isConnected) {
                edgesToAdd.push({
                  id: crypto.randomUUID(),
                  source: parentNodeId,
                  target: sn.id,
                  label: "related",
                  parentId: currentScopeId || undefined,
                });
              }
            });
          }
        }

        setNodes((prev) => [...prev, ...nodesToAdd]);
        setEdges((prev) => [...prev, ...edgesToAdd]);

        // Sync new nodes/edges to disk
        if (dirHandle || user?.storagePath) {
          nodesToAdd.forEach((n) => saveNodeToDisk(n));
          // Edges are handled by the useEffect hook
        }

        // --- Auto-Fit Viewport to New Nodes ---
        if (nodesToAdd.length > 0) {
          // Calculate bounds of the new cluster + parent
          let minX = sourceNode.x;
          let maxX = sourceNode.x + (sourceNode.width || DEFAULT_NODE_WIDTH);
          let minY = sourceNode.y;
          let maxY = sourceNode.y + (sourceNode.height || DEFAULT_NODE_HEIGHT);

          nodesToAdd.forEach((n) => {
            minX = Math.min(minX, n.x);
            maxX = Math.max(maxX, n.x + (n.width || DEFAULT_NODE_WIDTH));
            minY = Math.min(minY, n.y);
            maxY = Math.max(maxY, n.y + (n.height || DEFAULT_NODE_HEIGHT));
          });

          const padding = 200; // Increased padding for larger graph
          const width = maxX - minX + padding * 2;
          const height = maxY - minY + padding * 2;

          const centerX = (minX + maxX) / 2;
          const centerY = (minY + maxY) / 2;

          // Calculate zoom to fit
          const scaleX = window.innerWidth / width;
          const scaleY = window.innerHeight / height;
          let newK = Math.min(scaleX, scaleY, 1); // Cap at 1.0 zoom (don't zoom in too close)
          newK = Math.max(newK, 0.1); // Cap minimum zoom

          // Smooth transition
          setViewTransform({
            x: window.innerWidth / 2 - centerX * newK,
            y: window.innerHeight / 2 - centerY * newK,
            k: newK,
          });
        }

        // Recursive Expansion
        if (depthToUse > 1 && nextNodesToExpand.length > 0) {
          // We process these asynchronously without blocking UI
          Promise.all(
            nextNodesToExpand.map((node) =>
              handleExpandNode(node.id, node.content, node, depthToUse - 1)
            )
          );
        }
      } catch (e: any) {
        if (e.message === "LIMIT_REACHED") {
          setShowLimitModal(true);
        } else {
          console.error("Failed to expand:", e);
        }
      } finally {
        setExpandingNodeIds((prev) => prev.filter((nId) => nId !== id));
      }
    },
    [nodes, currentScopeId, dirHandle, user, saveNodeToDisk]
  );

  const handleExpandNodeFromWikidata = useCallback(
    async (
      id: string,
      topic: string,
      nodeOverride?: GraphNode,
      depth?: number
    ) => {
      if (wikidataExpansionInFlightRef.current.has(id)) return;
      wikidataExpansionInFlightRef.current.add(id);

      setExpandingNodeIds((prev) => (prev.includes(id) ? prev : [...prev, id]));

      const sourceNode = nodeOverride || nodes.find((n) => n.id === id);
      if (!sourceNode) {
        setExpandingNodeIds((prev) => prev.filter((nId) => nId !== id));
        wikidataExpansionInFlightRef.current.delete(id);
        return;
      }

      const depthToUse =
        depth !== undefined ? depth : sourceNode.autoExpandDepth || 1;

      try {
        const subtopics = await fetchWikidataSubtopics(topic, {
          language: "en",
          resultLimit: WIKIDATA_SUBTOPIC_LIMIT,
        });

        if (subtopics.length === 0) {
          setToast({
            visible: true,
            message: `No Wikidata subtopics found for "${topic}".`,
          });
          return;
        }

        const parentNodeId = id;
        const parentNodeX = sourceNode.x;
        const parentNodeY = sourceNode.y;

        const nodesToAdd: GraphNode[] = [];
        const edgesToAdd: GraphEdge[] = [];

        const existingNodesInScope = nodes.filter(
          (n) => n.parentId == currentScopeId
        );

        const existingByLowerLabel = new Map<string, GraphNode>();
        for (const existingNode of existingNodesInScope) {
          existingByLowerLabel.set(
            existingNode.content.trim().toLowerCase(),
            existingNode
          );
        }

        const subtopicsToCreate = subtopics.filter((st) => {
          const lower = st.label.trim().toLowerCase();
          return !existingByLowerLabel.has(lower);
        });

        const fixedRadius = 500; // Standardized Edge Length
        const startAngle = Math.random() * Math.PI;

        const createdNodes: GraphNode[] = subtopicsToCreate.map((st, i) => {
          const angle =
            startAngle +
            (i / Math.max(subtopicsToCreate.length, 1)) * 2 * Math.PI;

          return {
            id: crypto.randomUUID(),
            type: NodeType.CHAT,
            x: parentNodeX + fixedRadius * Math.cos(angle),
            y: parentNodeY + fixedRadius * Math.sin(angle),
            content: st.label,
            width: DEFAULT_NODE_WIDTH,
            height: DEFAULT_NODE_HEIGHT,
            link: st.wikidataUrl,
            parentId: currentScopeId || undefined,
            summary: st.description,
            autoExpandDepth: sourceNode.autoExpandDepth,
            messages: st.description
              ? [
                  {
                    role: "model",
                    text: st.description,
                    timestamp: Date.now(),
                  },
                ]
              : [],
          };
        });

        nodesToAdd.push(...createdNodes);

        for (const newNode of createdNodes) {
          edgesToAdd.push({
            id: crypto.randomUUID(),
            source: parentNodeId,
            target: newNode.id,
            label: "subtopic",
            parentId: currentScopeId || undefined,
          });
        }

        for (const st of subtopics) {
          const lower = st.label.trim().toLowerCase();
          const existingNode = existingByLowerLabel.get(lower);
          if (!existingNode) continue;

          edgesToAdd.push({
            id: crypto.randomUUID(),
            source: parentNodeId,
            target: existingNode.id,
            label: "subtopic",
            parentId: currentScopeId || undefined,
          });
        }

        setNodes((prev) => [...prev, ...nodesToAdd]);
        setEdges((prev) => [...prev, ...edgesToAdd]);

        if (dirHandle || user?.storagePath) {
          nodesToAdd.forEach((n) => saveNodeToDisk(n));
        }

        if (nodesToAdd.length > 0) {
          let minX = sourceNode.x;
          let maxX = sourceNode.x + (sourceNode.width || DEFAULT_NODE_WIDTH);
          let minY = sourceNode.y;
          let maxY = sourceNode.y + (sourceNode.height || DEFAULT_NODE_HEIGHT);

          nodesToAdd.forEach((n) => {
            minX = Math.min(minX, n.x);
            maxX = Math.max(maxX, n.x + (n.width || DEFAULT_NODE_WIDTH));
            minY = Math.min(minY, n.y);
            maxY = Math.max(maxY, n.y + (n.height || DEFAULT_NODE_HEIGHT));
          });

          const padding = 200;
          const width = maxX - minX + padding * 2;
          const height = maxY - minY + padding * 2;

          const centerX = (minX + maxX) / 2;
          const centerY = (minY + maxY) / 2;

          const scaleX = window.innerWidth / width;
          const scaleY = window.innerHeight / height;
          let newK = Math.min(scaleX, scaleY, 1);
          newK = Math.max(newK, 0.1);

          setViewTransform({
            x: window.innerWidth / 2 - centerX * newK,
            y: window.innerHeight / 2 - centerY * newK,
            k: newK,
          });
        }

        if (depthToUse > 1 && createdNodes.length > 0) {
          const nodesForRecursion = createdNodes.slice(
            0,
            WIKIDATA_MAX_RECURSIVE_NODES_PER_LEVEL
          );
          Promise.all(
            nodesForRecursion.map((node) =>
              handleExpandNodeFromWikidata(
                node.id,
                node.content,
                node,
                depthToUse - 1
              )
            )
          );
        }
      } catch (e: any) {
        console.error("Failed to expand from Wikidata:", e);
        setToast({
          visible: true,
          message: `Wikidata request failed for "${topic}".`,
        });
      } finally {
        setExpandingNodeIds((prev) => prev.filter((nId) => nId !== id));
        wikidataExpansionInFlightRef.current.delete(id);
      }
    },
    [nodes, currentScopeId, dirHandle, user, saveNodeToDisk]
  );

  const handleMaximizeNode = useCallback(
    (id: string) => {
      if (activeSidePane?.type === "node" && activeSidePane.data === id) {
        setActiveSidePane(null);
      } else {
        setActiveSidePane({ type: "node", data: id });
      }
    },
    [activeSidePane]
  );

  const handleOpenLink = useCallback((url: string) => {
    setActiveSidePane({ type: "web", data: url });
  }, []);

  const handleCloseSidePane = useCallback(() => {
    setActiveSidePane(null);
  }, []);

  const handleFocusNode = useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return;

      // Reset scope if needed
      if (node.parentId !== currentScopeId) {
        setCurrentScopeId(node.parentId || null);
      }

      setSelectedNodeIds(new Set([nodeId]));

      const k = 1;
      const nodeCenterX = node.x + (node.width || DEFAULT_NODE_WIDTH) / 2;
      const nodeCenterY = node.y + (node.height || DEFAULT_NODE_HEIGHT) / 2;
      const newX = window.innerWidth / 2 - nodeCenterX * k;
      const newY = window.innerHeight / 2 - nodeCenterY * k;

      setViewTransform({ x: newX, y: newY, k });
      setIsMenuOpen(false);
    },
    [nodes, currentScopeId]
  );

  const handleConnectStart = useCallback((id: string) => {
    setConnectingNodeId(id);
  }, []);

  const handleConnectEnd = useCallback(
    (sourceId: string, targetId: string) => {
      if (sourceId === targetId) {
        setConnectingNodeId(null);
        return;
      }
      setEdges((prev) => {
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
      setConnectingNodeId(null);
    },
    [currentScopeId]
  );

  const handleSearchSelect = useCallback(
    (topic: string, shouldExpand: boolean, isWiki: boolean = true) => {
      const vpW = window.innerWidth;
      const vpH = window.innerHeight;
      const centerX =
        -viewTransform.x / viewTransform.k +
        vpW / 2 / viewTransform.k -
        DEFAULT_NODE_WIDTH / 2;
      const centerY =
        -viewTransform.y / viewTransform.k +
        vpH / 2 / viewTransform.k -
        DEFAULT_NODE_HEIGHT / 2;

      const newNodeId = crypto.randomUUID();

      const initialMessages: ChatMessage[] = isWiki
        ? [
            {
              role: "model",
              text: `Topic: ${topic}`,
              timestamp: Date.now(),
            },
          ]
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
          ? `https://en.wikipedia.org/wiki/${encodeURIComponent(
              topic.replace(/ /g, "_")
            )}`
          : undefined,
        color: isWiki ? "slate" : "green",
        messages: initialMessages,
        parentId: currentScopeId || undefined,
      };

      setNodes((prev) => [...prev, newNode]);

      if (dirHandle || user?.storagePath) saveNodeToDisk(newNode);

      if (shouldExpand) {
        handleExpandNode(newNodeId, topic, newNode);
      }

      setSelectedNodeIds(new Set([newNodeId]));

      // Focus on the new node
      const k = 1;
      const nodeCenterX = newNode.x + (newNode.width || DEFAULT_NODE_WIDTH) / 2;
      const nodeCenterY =
        newNode.y + (newNode.height || DEFAULT_NODE_HEIGHT) / 2;

      const newX = window.innerWidth / 2 - nodeCenterX * k;
      const newY = window.innerHeight / 2 - nodeCenterY * k;

      setViewTransform({ x: newX, y: newY, k });

      if (!isWiki) {
        const prompt = getTopicSummaryPrompt(topic);
        let currentText = "";

        const updateNodeMessage = (text: string) => {
          setNodes((prev) =>
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

        sendChatMessage([], prompt, (chunk) => {
          currentText += chunk;
          updateNodeMessage(currentText);
        })
          .then((result) => {
            updateNodeMessage(result.text);
            // Save final state
            const updatedNode = { ...newNode };
            if (updatedNode.messages) {
              const lastMsg =
                updatedNode.messages[updatedNode.messages.length - 1];
              if (lastMsg.role === "model") lastMsg.text = result.text;
            }
            if (dirHandle || user?.storagePath) saveNodeToDisk(updatedNode);
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
    [
      viewTransform,
      handleExpandNode,
      currentScopeId,
      dirHandle,
      user,
      saveNodeToDisk,
    ]
  );

  const handleNavigateDown = useCallback((nodeId: string) => {
    setCurrentScopeId(nodeId);
    setSelectedNodeIds(new Set());
    // Center view? Optional, but Fractal Zoom usually handles transform
  }, []);

  const handleNavigateUp = useCallback(
    (exitingScopeId?: string) => {
      // Find the node that corresponds to the exiting scope (the node we were just inside)
      if (exitingScopeId) {
        const exitingNode = nodes.find((n) => n.id === exitingScopeId);
        if (exitingNode) {
          // We are going to the parent of the exiting node
          setCurrentScopeId(exitingNode.parentId || null);

          // Select the node we just exited from
          setSelectedNodeIds(new Set([exitingNode.id]));

          // Center camera on the exiting node in the parent view
          // Set zoom to 1.0 (Detail View) so we can see the "Topic Node" clearly
          const k = 1.0;
          const nodeCenterX =
            exitingNode.x + (exitingNode.width || DEFAULT_NODE_WIDTH) / 2;
          const nodeCenterY =
            exitingNode.y + (exitingNode.height || DEFAULT_NODE_HEIGHT) / 2;
          const newX = window.innerWidth / 2 - nodeCenterX * k;
          const newY = window.innerHeight / 2 - nodeCenterY * k;

          setViewTransform({ x: newX, y: newY, k });
          return;
        }
      }

      // Fallback
      if (currentScopeId) {
        const currentNode = nodes.find((n) => n.id === currentScopeId);
        setCurrentScopeId(currentNode?.parentId || null);
        if (currentNode) setSelectedNodeIds(new Set([currentNode.id]));
      }
    },
    [currentScopeId, nodes]
  );

  const handleCloseFolder = useCallback(async () => {
    if ((user as any)?.isPaid) {
      // Logout acts as "Close Folder" for cloud
      // But user might want to stay logged in?
      // For now, just disconnect storage UI
      setDirName(null);
      setNodes([]);
      setEdges([]);
      return;
    }

    if (user?.storagePath) {
      try {
        await updateUserSettings("");
        setUser((prev) => (prev ? { ...prev, storagePath: undefined } : null));
      } catch (e) {
        console.error("Failed to clear user settings", e);
      }
    }
    setDirHandle(null);
    setDirName(null);
    setNodes([]); // Clear?
    setEdges([]);
    window.location.reload();
  }, [user]);

  // Breadcrumbs: Use BFS to find shortest path from Root to Selected Node
  const getBreadcrumbs = () => {
    // 1. Build Scope Path (Vertical Hierarchy)
    const crumbs = [];
    let currScope = currentScopeId;
    while (currScope) {
      const node = nodes.find((n) => n.id === currScope);
      if (node) {
        crumbs.unshift({ id: node.id, name: node.content, type: "scope" });
        currScope = node.parentId || null;
      } else {
        break;
      }
    }

    const rootName = dirName || "Home";
    const combinedCrumbs: { id: string | null; name: string; type: string }[] =
      [{ id: null, name: rootName, type: "root" }, ...crumbs];

    // 2. Build Graph Path (Horizontal Connections within Scope)
    const activeId =
      selectedNodeIds.size > 0 ? Array.from(selectedNodeIds)[0] : null;

    if (activeId) {
      const currentNodes = nodes.filter((n) => n.parentId == currentScopeId);
      const currentEdges = edges.filter((e) => e.parentId == currentScopeId);

      if (currentNodes.length > 0) {
        // Heuristic: The "Root" of this scope is usually the first node created (index 0)
        // or the node that has the currentScopeId (if we are in root scope, it's just index 0)
        const rootNode = currentNodes[0];

        // If selected node IS the root, just show it
        if (activeId === rootNode.id) {
          combinedCrumbs.push({
            id: rootNode.id,
            name: rootNode.content,
            type: "node",
          });
        } else {
          // Run BFS to find path from Root -> Selected
          const adjacency: Record<string, string[]> = {};
          currentNodes.forEach((n) => (adjacency[n.id] = []));

          // Build Undirected Graph to handle any edge direction
          currentEdges.forEach((e) => {
            if (adjacency[e.source]) adjacency[e.source].push(e.target);
            if (adjacency[e.target]) adjacency[e.target].push(e.source);
          });

          const queue: string[] = [rootNode.id];
          const visited = new Set<string>([rootNode.id]);
          const parentMap = new Map<string, string>(); // child -> parent (for path reconstruction)

          let found = false;
          while (queue.length > 0) {
            const curr = queue.shift()!;
            if (curr === activeId) {
              found = true;
              break;
            }
            for (const neighbor of adjacency[curr] || []) {
              if (!visited.has(neighbor)) {
                visited.add(neighbor);
                parentMap.set(neighbor, curr);
                queue.push(neighbor);
              }
            }
          }

          if (found) {
            const path: { id: string; name: string; type: string }[] = [];
            let curr: string | undefined = activeId;
            while (curr) {
              const n = currentNodes.find((node) => node.id === curr);
              if (n) path.unshift({ id: n.id, name: n.content, type: "node" });
              curr = parentMap.get(curr);
            }
            combinedCrumbs.push(...path);
          } else {
            // Disconnected node (Island)
            const n = currentNodes.find((node) => node.id === activeId);
            if (n)
              combinedCrumbs.push({ id: n.id, name: n.content, type: "node" });
          }
        }
      }
    }
    return combinedCrumbs;
  };

  const filteredNodes = nodes.filter((n) => n.parentId == currentScopeId); // null == undefined check
  const filteredEdges = edges.filter((e) => e.parentId == currentScopeId);

  const handleOpenStorage = async () => {
    if (user) {
      // Check if user is paid for Cloud Storage
      // Note: We use 'isPaid' from the user object (make sure to update user type or just cast)
      if ((user as any).isPaid) {
        setIsGraphLoaded(false);
        // For cloud, we don't need a local path, but we set a virtual one to indicate connection
        setDirName("Cloud Storage");

        try {
          const { nodes: loadedNodes, edges: loadedEdges } =
            await loadGraphFromApi();
          if (loadedNodes) setNodes(loadedNodes);
          if (loadedEdges) setEdges(loadedEdges);
          setIsGraphLoaded(true);
        } catch (e) {
          console.error("Error loading cloud graph", e);
          setIsGraphLoaded(true);
          alert("Failed to load cloud graph.");
        }
        return;
      }

      // Legacy Server Mode (Self-hosted local path)
      try {
        const { path, cancelled } = await pickServerDirectory();
        if (cancelled) return;

        if (path) {
          setIsGraphLoaded(false); // Prevent saving before load
          await updateUserSettings(path);
          // Update local user state
          setUser((prev) => (prev ? { ...prev, storagePath: path } : null));
          setDirName(path);

          const { nodes: loadedNodes, edges: loadedEdges } =
            await loadGraphFromApi();
          if (loadedNodes && loadedNodes.length > 0) {
            setNodes(loadedNodes);
            setEdges(loadedEdges);
          }
          setIsGraphLoaded(true);
        }
      } catch (e) {
        console.error("Error setting server directory", e);
        setIsGraphLoaded(true); // Reset on error
        alert(
          "Failed to set server directory. Ensure server tools are installed."
        );
      }
    } else {
      // Local Mode (Browser File System API)
      const handle = await pickDirectory();
      if (handle) {
        setIsGraphLoaded(false); // Prevent saving before load
        setDirHandle(handle);
        setDirName(handle.name);
        try {
          // Sync current nodes and edges to the selected local directory
          if (nodes.length > 0) {
            for (const node of nodes) {
              await saveNodeToFile(handle, node);
            }
          }
          if (edges.length > 0) {
            await saveEdgesToFile(handle, edges);
          }

          const { nodes: loadedNodes, edges: loadedEdges } =
            await loadGraphFromDirectory(handle);
          if (loadedNodes.length > 0) {
            setNodes(loadedNodes);
            setEdges(loadedEdges);
          }
          setIsGraphLoaded(true);
        } catch (e) {
          console.error("Error loading from directory", e);
          setIsGraphLoaded(true); // Reset on error
          alert("Failed to load graph from directory.");
        }
      }
    }
  };

  const sidebarNode =
    activeSidePane?.type === "node"
      ? nodes.find((n) => n.id === activeSidePane.data)
      : null;

  return (
    <div className="flex w-screen h-screen overflow-hidden bg-slate-900 text-slate-200 font-sans">
      <div className="flex-1 relative min-w-0 flex flex-col">
        {/* Auth/Folder Buttons */}
        <div className="absolute top-4 right-4 z-[60] flex gap-3 items-center pointer-events-none">
          {!user ? (
            <>
              <button
                onClick={() => {
                  setAuthMode("login");
                  setShowAuth(true);
                }}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-sky-400 text-sm font-bold rounded-lg border border-slate-700 shadow-lg transition-all pointer-events-auto"
              >
                Log In
              </button>
              <button
                onClick={() => {
                  setAuthMode("signup");
                  setShowAuth(true);
                }}
                className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white text-sm font-bold rounded-lg shadow-lg transition-all pointer-events-auto"
              >
                Sign Up
              </button>
            </>
          ) : (
            <></>
          )}
        </div>

        {/* Breadcrumbs */}
        <div className="absolute top-16 left-4 md:left-20 z-40 flex items-center gap-2 text-sm pointer-events-none flex-wrap">
          {getBreadcrumbs().map((crumb, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className="text-slate-600 font-bold">&gt;</span>}
              <div className="flex items-center gap-1 pointer-events-auto">
                <button
                  onClick={() => {
                    if (crumb.type === "node") {
                      if (crumb.id) {
                        handleFocusNode(crumb.id);
                      }
                      return;
                    }
                    setCurrentScopeId(crumb.id);
                    setSelectedNodeIds(new Set());
                  }}
                  className={`transition-colors ${
                    crumb.id &&
                    selectedNodeIds.has(crumb.id) &&
                    selectedNodeIds.size === 1
                      ? "text-sky-400 font-bold cursor-default"
                      : "text-slate-400 hover:text-white"
                  }`}
                  disabled={
                    !!(
                      crumb.id &&
                      selectedNodeIds.has(crumb.id) &&
                      selectedNodeIds.size === 1
                    )
                  }
                >
                  {crumb.name}
                </button>
                {crumb.type === "root" && dirName && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCloseFolder();
                    }}
                    className="ml-1 p-0.5 text-slate-500 hover:text-red-400 rounded-full hover:bg-slate-800 transition-colors"
                    title="Close Folder"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                )}
              </div>
            </React.Fragment>
          ))}
        </div>

        {/* Scope Indicator Background */}
        {currentScopeId && (
          <div className="absolute inset-0 border-[20px] border-slate-800/50 pointer-events-none z-30 flex items-center justify-center">
            <div className="absolute bottom-4 text-slate-700 font-bold text-4xl uppercase opacity-20 pointer-events-none select-none">
              {nodes.find((n) => n.id === currentScopeId)?.content}
            </div>
          </div>
        )}

        {isSearchOpen && (
          <SearchBar
            nodes={nodes}
            onSelect={handleSearchSelect}
            onNavigate={handleFocusNode}
            onClose={() => setIsSearchOpen(false)}
            isCloud={!!user}
          />
        )}

        <ErrorBoundary>
          <NodeListDrawer
            nodes={nodes}
            isOpen={isMenuOpen}
            onClose={() => setIsMenuOpen(false)}
            onSelectNode={handleFocusNode}
            onUpdateNode={handleUpdateNode}
          />
        </ErrorBoundary>

        {/* Usage Notification Toast */}
        {usageNotification.visible && (
          <div className="absolute bottom-4 right-4 z-50 bg-slate-800 border border-sky-500 text-sky-400 px-4 py-3 rounded shadow-lg animate-bounce">
            <p className="text-sm font-bold">{usageNotification.message}</p>
            <button
              onClick={() =>
                setUsageNotification((prev) => ({ ...prev, visible: false }))
              }
              className="absolute top-1 right-1 text-xs text-slate-500 hover:text-white"
            >
              ✕
            </button>
          </div>
        )}

        <ErrorBoundary>
          <Canvas
            nodes={filteredNodes}
            edges={filteredEdges}
            setNodes={setNodes}
            setEdges={setEdges}
            viewTransform={viewTransform}
            onViewTransformChange={setViewTransform}
            onOpenStorage={handleOpenStorage}
            onOpenSearch={() => setIsSearchOpen(true)}
            storageConnected={!!dirName}
            storageDirName={dirName}
            isSaving={isSaving}
            profileButtonTitle={user ? user.username : undefined}
            onOpenProfile={user ? () => setShowProfile(true) : undefined}
            onOpenLink={handleOpenLink}
            onMaximizeNode={handleMaximizeNode}
            onExpandNode={handleExpandNode}
            onExpandNodeFromWikidata={handleExpandNodeFromWikidata}
            onUpdateNode={handleUpdateNode}
            onDeleteNode={handleDeleteNode}
            expandingNodeIds={expandingNodeIds}
            onToggleMenu={() => setIsMenuOpen(true)}
            connectingNodeId={connectingNodeId}
            onConnectStart={handleConnectStart}
            onConnectEnd={handleConnectEnd}
            onCancelConnect={() => setConnectingNodeId(null)}
            onNavigateDown={handleNavigateDown}
            onNavigateUp={handleNavigateUp}
            currentScopeId={currentScopeId}
            autoGraphEnabled={autoGraphEnabled}
            onSetAutoGraphEnabled={setAutoGraphEnabled}
            selectedNodeIds={selectedNodeIds}
            onNodeSelect={handleNodeSelect}
            onMultiSelect={handleBoxSelect}
          />
        </ErrorBoundary>
      </div>

      {activeSidePane && (
        <SidePanel
          onClose={handleCloseSidePane}
          hideDefaultDragHandle={!!sidebarNode}
        >
          <ErrorBoundary>
            {activeSidePane.type === "web" ? (
              <WebContent
                url={activeSidePane.data}
                onClose={handleCloseSidePane}
              />
            ) : sidebarNode ? (
              <GraphNodeComponent
                node={sidebarNode}
                viewMode="sidebar"
                onUpdate={handleUpdateNode}
                onExpand={handleExpandNode}
                onExpandFromWikidata={handleExpandNodeFromWikidata}
                onDelete={handleDeleteNode}
                onToggleMaximize={handleMaximizeNode}
                onOpenLink={handleOpenLink}
                autoGraphEnabled={autoGraphEnabled}
                onSetAutoGraphEnabled={setAutoGraphEnabled}
              />
            ) : (
              <div className="p-4 text-slate-500">Node not found.</div>
            )}
          </ErrorBoundary>
        </SidePanel>
      )}

      {showAuth && (
        <div className="fixed inset-0 z-[100]">
          <ErrorBoundary>
            <AuthPage
              initialMode={authMode}
              onLogin={async (user) => {
                setUser(user);

                // Helper to sync local data to cloud on login
                const syncToCloud = async () => {
                  // If we have local nodes (and it's not just the default welcome node)
                  const isDefaultGraph =
                    nodes.length === 1 && nodes[0].id === "1";
                  const hasLocalData = nodes.length > 0 && !isDefaultGraph;

                  if (hasLocalData) {
                    try {
                      // Sync Nodes
                      for (const node of nodes) {
                        const res = await saveNodeToApi(node);
                        if (res.code === "STORAGE_LIMIT") {
                          setUsageNotification({
                            message:
                              "Storage limit reached during sync. Some nodes may not be saved.",
                            visible: true,
                          });
                          break; // Stop syncing nodes
                        }
                      }
                      // Sync Edges
                      if (edges.length > 0) {
                        await saveEdgesToApi(edges);
                      }
                    } catch (e) {
                      console.error("Failed to sync local data to cloud", e);
                    }
                  }
                };

                if ((user as any).isPaid) {
                  setDirName("Cloud Storage");
                  await syncToCloud();
                  loadGraphFromApi()
                    .then(({ nodes, edges }) => {
                      if (nodes && nodes.length > 0) {
                        setNodes(nodes);
                        setEdges(edges);
                      }
                      setIsGraphLoaded(true);
                    })
                    .catch((e) => {
                      console.error("Failed to load cloud graph on login", e);
                      setIsGraphLoaded(true);
                    });
                } else if (user.storagePath) {
                  setDirName(user.storagePath);
                  loadGraphFromApi()
                    .then(({ nodes, edges }) => {
                      if (nodes && nodes.length > 0) {
                        setNodes(nodes);
                        setEdges(edges);
                      }
                      setIsGraphLoaded(true);
                    })
                    .catch((e) => {
                      console.error("Failed to load graph on login", e);
                      setIsGraphLoaded(true);
                    });
                } else {
                  // Free user, no local server path -> Default to Cloud
                  setDirName("Cloud Storage");
                  await syncToCloud();
                  loadGraphFromApi()
                    .then(({ nodes, edges }) => {
                      if (nodes && nodes.length > 0) {
                        setNodes(nodes);
                        setEdges(edges);
                      }
                      setIsGraphLoaded(true);
                    })
                    .catch((e) => {
                      console.error("Failed to load cloud graph on login", e);
                      setIsGraphLoaded(true);
                    });
                }
                setShowAuth(false);
                // Redirect to app subdomain upon login
                if (
                  window.location.hostname === "infoverse.ai" &&
                  !window.location.hostname.startsWith("app.")
                ) {
                  window.location.href = "https://app.infoverse.ai";
                }
              }}
              onCancel={() => setShowAuth(false)}
            />
          </ErrorBoundary>
        </div>
      )}

      {showProfile && user && (
        <ErrorBoundary>
          <ProfilePage
            user={user}
            onClose={() => setShowProfile(false)}
            onUpdateUser={(updates) =>
              setUser((prev) => (prev ? { ...prev, ...updates } : null))
            }
            onLogout={handleLogout}
          />
        </ErrorBoundary>
      )}

      <UpgradeModal
        isOpen={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
      />

      <LimitModal
        isOpen={showLimitModal}
        onClose={() => setShowLimitModal(false)}
        onLogin={() => {
          setShowLimitModal(false);
          setAuthMode("login");
          setShowAuth(true);
        }}
        onSignup={() => {
          setShowLimitModal(false);
          setAuthMode("signup");
          setShowAuth(true);
        }}
      />

      <Toast
        message={toast.message}
        visible={toast.visible}
        onUndo={toast.action}
        onClose={() => setToast((prev) => ({ ...prev, visible: false }))}
      />
    </div>
  );
};

export default App;
