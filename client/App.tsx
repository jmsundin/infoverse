import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { Canvas } from "./components/Canvas";
import {
  SidePanel,
  WebContent,
  SidePanelLayout,
  SidePanelDockPosition,
} from "./components/SidePanel";

type ActiveSidePane = {
  id: string; // Unique ID for this panel instance
  type: "web" | "node";
  data: string;
  layout?: SidePanelLayout; // Store individual layout for each panel
  initialDockPosition?: SidePanelDockPosition;
  initialWidthPercent?: number;
};
import { GraphNodeComponent } from "./components/GraphNode";
import { SearchBar } from "./components/SearchBar";
import { NodeListDrawer } from "./components/NodeListDrawer";
import { AuthPage } from "./components/AuthPage";
import { LimitModal } from "./components/LimitModal";
import { UpgradeModal } from "./components/UpgradeModal";
import { ProfilePage } from "./components/ProfilePage";
import { Toast } from "./components/Toast";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { SelectionTooltip } from "./components/SelectionTooltip";
import {
  GraphEdge,
  GraphNode,
  NodeType,
  ViewportTransform,
  ChatMessage,
  SelectionTooltipState,
} from "./types";
import {
  DEFAULT_NODE_HEIGHT,
  DEFAULT_NODE_WIDTH,
  PARENT_NODE_HEIGHT,
  PARENT_NODE_WIDTH,
} from "./constants";
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
  fetchNodesInViewport,
  saveNodeToApi,
  saveNodesBatchToApi,
  deleteNodeFromApi,
  saveEdgesToApi,
} from "./services/apiStorageService";
import { performGreedyClustering } from "./utils/clustering";
import * as geminiService from "./services/geminiService";
import * as hfService from "./services/huggingfaceService";
import { fetchWikidataSubtopics } from "./services/wikidataService";
import { debounce } from "./services/debounceService";
import { v4 as uuidv4 } from "uuid";

const LOCAL_STORAGE_KEY = "wiki-graph-data";
const WIKIDATA_SUBTOPIC_LIMIT = 12;
const WIKIDATA_MAX_RECURSIVE_NODES_PER_LEVEL = 5;

const getDefaultNodePosition = () => {
  if (typeof window === "undefined") {
    return { x: 0, y: 0 };
  }

  return {
    x: window.innerWidth / 2 - DEFAULT_NODE_WIDTH / 2,
    y: window.innerHeight / 2 - DEFAULT_NODE_HEIGHT / 2,
  };
};

const createDefaultGraphNodes = (): GraphNode[] => {
  const { x, y } = getDefaultNodePosition();
  return [
    {
      id: "1",
      type: NodeType.CHAT,
      x,
      y,
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
};

const getFirstNonEmptyLine = (text?: string | null) => {
  if (!text) return "";
  for (const rawLine of text.split("\n")) {
    const trimmed = rawLine.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return "";
};

const getNodeTitleForBreadcrumb = (node: GraphNode) => {
  if (!node) return "Untitled";
  if (node.type === NodeType.CHAT) {
    return (node.content || "").trim() || "Chat";
  }

  let title = getFirstNonEmptyLine(node.content);
  const headingMatch = title.match(/^#+\s*(.*)$/);
  if (headingMatch) {
    title = headingMatch[1].trim();
  }

  if (title) return title;

  const summaryLine = getFirstNonEmptyLine(node.summary);
  return summaryLine || "Untitled";
};

type LocalGraphSnapshot = {
  nodes?: GraphNode[];
  edges?: GraphEdge[];
  autoGraphEnabled?: boolean;
  viewTransform?: ViewportTransform;
  currentScopeId?: string | null;
  selectedNodeIds?: string[];
  selectedNodeId?: string;
};

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
  const [nodes, setNodes] = useState<GraphNode[]>(createDefaultGraphNodes);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [autoGraphEnabled, setAutoGraphEnabled] = useState<boolean>(true);
  // Viewport State (lifted from Canvas)
  const [viewTransform, setViewTransform] = useState<ViewportTransform>({
    x: 0,
    y: 0,
    k: 1,
  });

  // UI State
  const [currentScopeId, setCurrentScopeId] = useState<string | null>(null);

  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(
    () => new Set()
  );

  const [localStorageReady, setLocalStorageReady] = useState(false);

  const [activeSidePanes, setActiveSidePanes] = useState<ActiveSidePane[]>([]);
  const [expandingNodeIds, setExpandingNodeIds] = useState<string[]>([]);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [connectingNodeId, setConnectingNodeId] = useState<string | null>(null);
  const [selectionTooltip, setSelectionTooltip] =
    useState<SelectionTooltipState | null>(null);

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
  const hasLoadedLocalGraphRef = useRef(false);
  const hasCenteredOnStoredSelectionRef = useRef(false);

  // File System State
  const [dirHandle, setDirHandle] = useState<FileSystemDirectoryHandle | null>(
    null
  );
  const [dirName, setDirName] = useState<string | null>(null);
  const [isGraphLoaded, setIsGraphLoaded] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [aiProvider, setAiProvider] = useState<"gemini" | "huggingface">(() => {
    if (typeof window !== "undefined") {
      return (
        (localStorage.getItem("ai_provider") as "gemini" | "huggingface") ||
        "gemini"
      );
    }
    return "gemini";
  });

  const handleSetAiProvider = useCallback(
    (provider: "gemini" | "huggingface") => {
      setAiProvider(provider);
      if (typeof window !== "undefined") {
        localStorage.setItem("ai_provider", provider);
      }
    },
    []
  );

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

  const [showLimitModal, setShowLimitModal] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  const [lastSelectedNode, setLastSelectedNode] = useState<GraphNode | null>(
    null
  );
  const [cutNodeId, setCutNodeId] = useState<string | null>(null);

  // --- Viewport Fetching Logic ---
  const fetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewportFetchAbortRef = useRef<AbortController | null>(null);
  const lastViewportFetchKeyRef = useRef<string | null>(null);
  const lastViewportFetchAtRef = useRef<number>(0);

  const fetchViewportNodes = useCallback(async () => {
    // Only fetch if authenticated and in cloud mode
    if (!user || dirName !== "Cloud Storage") return;

    const { x, y, k } = viewTransform;

    // Guard against invalid transform
    if (!k || k === 0) return;

    const width = window.innerWidth;
    const height = window.innerHeight;

    // Screen (0,0) -> World (-x/k, -y/k)
    // Screen (W,H) -> World ((W-x)/k, (H-y)/k)
    const minX = -x / k;
    const minY = -y / k;
    const maxX = (width - x) / k;
    const maxY = (height - y) / k;

    // Buffer 20%
    const w = maxX - minX;
    const h = maxY - minY;
    const bufferX = w * 0.2;
    const bufferY = h * 0.2;

    const bufferedMinX = minX - bufferX;
    const bufferedMinY = minY - bufferY;
    const bufferedMaxX = maxX + bufferX;
    const bufferedMaxY = maxY + bufferY;

    // Dedupe/throttle: quantize viewport to reduce request churn from tiny transform changes.
    // Quantization step is a fraction of the viewport size, so it scales with zoom.
    const quantizeStepX = Math.max(w * 0.25, 1);
    const quantizeStepY = Math.max(h * 0.25, 1);
    const q = (v: number, step: number) => Math.round(v / step) * step;
    const fetchKey = [
      q(bufferedMinX, quantizeStepX),
      q(bufferedMinY, quantizeStepY),
      q(bufferedMaxX, quantizeStepX),
      q(bufferedMaxY, quantizeStepY),
      Math.round(k * 1000) / 1000,
    ].join("|");

    if (lastViewportFetchKeyRef.current === fetchKey) return;

    const now = Date.now();
    // Hard throttle: never fetch more than once per 800ms even if the key changes.
    if (now - lastViewportFetchAtRef.current < 800) return;
    lastViewportFetchAtRef.current = now;
    lastViewportFetchKeyRef.current = fetchKey;

    try {
      // Cancel any in-flight viewport request to avoid piling up work.
      if (viewportFetchAbortRef.current) {
        viewportFetchAbortRef.current.abort();
      }
      const controller = new AbortController();
      viewportFetchAbortRef.current = controller;

      const { nodes: newNodes, edges: newEdges } = await fetchNodesInViewport(
        bufferedMinX,
        bufferedMinY,
        bufferedMaxX,
        bufferedMaxY,
        controller.signal
      );

      // Pruning: We replace the current nodes with the fetched viewport nodes.
      // This implicitly prunes nodes outside the viewport (plus buffer).
      if (newNodes) setNodes(newNodes);
      if (newEdges) setEdges(newEdges);
    } catch (e) {
      // Ignore aborts (expected during rapid pan/zoom)
      if ((e as any)?.name !== "AbortError") {
        console.error("Viewport fetch failed", e);
      }
    }
  }, [viewTransform, user, dirName]);

  // Trigger fetch on view transform change (debounced)
  useEffect(() => {
    if (!user || dirName !== "Cloud Storage") return;

    if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current);

    fetchTimeoutRef.current = setTimeout(() => {
      fetchViewportNodes();
    }, 600);

    return () => {
      if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current);
    };
  }, [viewTransform, user, dirName, fetchViewportNodes]);

  const handleCreateNode = useCallback(
    (node: GraphNode) => {
      setNodes((prevNodes) => [...prevNodes, node]);
      setSelectedNodeIds(new Set([node.id]));
      setCurrentScopeId(node.parentId || null);
      setViewTransform((prevTransform) => ({
        ...prevTransform,
        x: prevTransform.x + 100,
        y: prevTransform.y + 100,
      }));
    },
    [setNodes, setSelectedNodeIds, setCurrentScopeId, setViewTransform]
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
    [nodes, setToast]
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
    [cutNodeId, nodes, handleCreateNode, setToast]
  );

  const saveGraphToLocalStorage = useCallback(
    (
      nodesToSave: GraphNode[],
      edgesToSave: GraphEdge[],
      currentViewTransform: ViewportTransform,
      currentAutoGraphEnabled: boolean,
      currentScopeId: string | null,
      currentSelectedNodeIds: Set<string>
    ) => {
      if (typeof window === "undefined") return;
      const data = {
        nodes: nodesToSave,
        edges: edgesToSave,
        viewTransform: currentViewTransform,
        autoGraphEnabled: currentAutoGraphEnabled,
        currentScopeId: currentScopeId,
        selectedNodeIds: Array.from(currentSelectedNodeIds),
      };
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
    },
    []
  );

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
    } else if (percentage >= 20 && percentage >= 20) {
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

  // Debounced save functions
  const dirtyNodesByIdRef = useRef<
    Map<string, { node: GraphNode; skipEmbedding: boolean }>
  >(new Map());
  const edgesDirtyRef = useRef(false);

  const debouncedFlushSaves = useMemo(
    () =>
      debounce(
        async (
          nodesSnapshot: GraphNode[],
          edgesSnapshot: GraphEdge[],
          currentViewTransform: ViewportTransform,
          currentAutoGraphEnabled: boolean,
          currentScopeId: string | null,
          currentSelectedNodeIds: Set<string>
        ) => {
          // Save to local storage (snapshot of current graph state)
          saveGraphToLocalStorage(
            nodesSnapshot,
            edgesSnapshot,
            currentViewTransform,
            currentAutoGraphEnabled,
            currentScopeId,
            currentSelectedNodeIds
          );

          const dirtyNodes = Array.from(dirtyNodesByIdRef.current.values());
          dirtyNodesByIdRef.current.clear();
          const edgesDirty = edgesDirtyRef.current;
          edgesDirtyRef.current = false;

          // Save to file system or cloud (only what changed)
          if (dirHandle) {
            dirtyNodes.forEach(({ node }) => saveNodeToFile(dirHandle, node));
            if (edgesDirty) {
              saveEdgesToFile(dirHandle, edgesSnapshot);
            }
          } else if (user) {
            if (dirtyNodes.length > 0) {
              // Batch-save dirty nodes to cut request count
              await saveNodesBatchToApi(
                dirtyNodes.map(({ node, skipEmbedding }) => ({
                  ...(node as any),
                  skipEmbedding,
                }))
              );
            }
            if (edgesDirty) {
              saveEdgesToApi(edgesSnapshot);
            }
          }
        },
        2000 // 2 second debounce delay
      ),
    [saveGraphToLocalStorage, dirHandle, user, checkUsage]
  );

  const setNodesCallback = useCallback(
    (newNodes: GraphNode[] | ((prev: GraphNode[]) => GraphNode[])) => {
      const resolvedNodes =
        typeof newNodes === "function" ? newNodes(nodes) : newNodes;
      setNodes(resolvedNodes);
      // Mark changed nodes as dirty (reference compare is fast and works with immutable updates)
      const prevById = new Map(nodes.map((n) => [n.id, n]));
      for (const n of resolvedNodes) {
        const prev = prevById.get(n.id);
        if (!prev || prev !== n) {
          const semanticChanged =
            !prev ||
            prev.content !== n.content ||
            prev.summary !== n.summary ||
            JSON.stringify(prev.aliases || []) !==
              JSON.stringify(n.aliases || []);

          // skipEmbedding=true for position-only updates; false when semantic fields changed
          dirtyNodesByIdRef.current.set(n.id, {
            node: n,
            skipEmbedding: !semanticChanged,
          });
        }
      }

      debouncedFlushSaves(
        resolvedNodes,
        edges,
        viewTransform,
        autoGraphEnabled,
        currentScopeId,
        selectedNodeIds
      );
    },
    [
      nodes,
      edges,
      viewTransform,
      autoGraphEnabled,
      currentScopeId,
      selectedNodeIds,
      debouncedFlushSaves,
    ]
  );

  const setEdgesCallback = useCallback(
    (newEdges: GraphEdge[] | ((prev: GraphEdge[]) => GraphEdge[])) => {
      const resolvedEdges =
        typeof newEdges === "function" ? newEdges(edges) : newEdges;
      setEdges(resolvedEdges);
      edgesDirtyRef.current = true;
      debouncedFlushSaves(
        nodes,
        resolvedEdges,
        viewTransform,
        autoGraphEnabled,
        currentScopeId,
        selectedNodeIds
      );
    },
    [
      nodes,
      edges,
      viewTransform,
      autoGraphEnabled,
      currentScopeId,
      selectedNodeIds,
      debouncedFlushSaves,
    ]
  );

  const resetGraphState = useCallback(() => {
    setNodesCallback(createDefaultGraphNodes());
    setEdgesCallback([]);
    setViewTransform({ x: 0, y: 0, k: 1 });
    setCurrentScopeId(null);
    setSelectedNodeIds(new Set());
    setAutoGraphEnabled(true);
  }, [setNodesCallback, setEdgesCallback]);

  const loadGraphFromLocalStorage = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (!saved) {
        resetGraphState();
        return;
      }

      const parsed: LocalGraphSnapshot & {
        viewTransform?: ViewportTransform;
        autoGraphEnabled?: boolean;
      } = JSON.parse(saved);

      if (parsed.nodes && Array.isArray(parsed.nodes)) {
        setNodesCallback(parsed.nodes);
      } else {
        setNodesCallback(createDefaultGraphNodes());
      }

      if (parsed.edges && Array.isArray(parsed.edges)) {
        setEdgesCallback(parsed.edges);
      } else {
        setEdgesCallback([]);
      }

      if (parsed.viewTransform) {
        setViewTransform(parsed.viewTransform);
      } else {
        setViewTransform({ x: 0, y: 0, k: 1 });
      }

      if (parsed.currentScopeId !== undefined) {
        setCurrentScopeId(parsed.currentScopeId || null);
      }

      if (parsed.selectedNodeIds && Array.isArray(parsed.selectedNodeIds)) {
        setSelectedNodeIds(new Set(parsed.selectedNodeIds));
      } else if (parsed.selectedNodeId) {
        setSelectedNodeIds(new Set([parsed.selectedNodeId]));
      } else {
        setSelectedNodeIds(new Set());
      }

      setAutoGraphEnabled(
        parsed.autoGraphEnabled !== undefined ? !!parsed.autoGraphEnabled : true
      );
    } catch (e) {
      console.error("Failed to load from local storage", e);
      resetGraphState();
    }
  }, [resetGraphState, setNodesCallback, setEdgesCallback]);

  const selectedNodeId =
    selectedNodeIds.size === 1 ? Array.from(selectedNodeIds)[0] : null;
  const setSelectedNodeId = useCallback((id: string | null) => {
    if (id === null) setSelectedNodeIds(new Set());
    else setSelectedNodeIds(new Set([id]));
  }, []);

  const prevNodesRef = useRef<GraphNode[]>(nodes);
  const prevEdgesRef = useRef<GraphEdge[]>(edges);

  // Layout & Visual Stability for multiple side panels
  const [sidePanelLayouts, setSidePanelLayouts] = useState<
    Record<string, SidePanelLayout>
  >({});
  const [canvasShiftX, setCanvasShiftX] = useState(0);
  const [canvasShiftY, setCanvasShiftY] = useState(0);

  const isAnyPanelResizing = useMemo(
    () => Object.values(sidePanelLayouts).some((l) => l.isResizing),
    [sidePanelLayouts]
  );

  // Layout & Visual Stability for multiple side panels
  useEffect(() => {
    if (typeof window === "undefined") return;

    let newLeftShift = 0;
    let newRightShift = 0;
    let newTopShift = 0;
    let newBottomShift = 0;

    Object.values(sidePanelLayouts).forEach((layout) => {
      const { width, height, dockPosition } = layout;
      if (dockPosition === "left") {
        newLeftShift = Math.max(
          newLeftShift,
          (window.innerWidth * width) / 100
        );
      } else if (dockPosition === "right") {
        newRightShift = Math.max(
          newRightShift,
          (window.innerWidth * width) / 100
        );
      } else if (dockPosition === "top-left" || dockPosition === "top-right") {
        newTopShift = Math.max(
          newTopShift,
          (window.innerHeight * height) / 100
        );
      } else if (
        dockPosition === "bottom-left" ||
        dockPosition === "bottom-right"
      ) {
        newBottomShift = Math.max(
          newBottomShift,
          (window.innerHeight * height) / 100
        );
      }
    });

    // Sum up effective shifts
    const totalXShift = newLeftShift - newRightShift; // Left shift positive, Right shift negative
    const totalYShift = newTopShift - newBottomShift; // Top shift positive, Bottom shift negative

    // Only update if there's a significant change to prevent unnecessary re-renders
    if (Math.abs(totalXShift - canvasShiftX) > 1) {
      setCanvasShiftX(totalXShift);
    }
    if (Math.abs(totalYShift - canvasShiftY) > 1) {
      setCanvasShiftY(totalYShift);
    }
  }, [sidePanelLayouts, canvasShiftX, canvasShiftY]);

  const handleSidePanelLayoutChange = useCallback(
    (id: string, layout: SidePanelLayout) => {
      setSidePanelLayouts((prev) => {
        const nextLayouts = { ...prev, [id]: layout };
        return nextLayouts;
      });
    },
    []
  );

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
            // Initial load is handled by the viewport effect
            setIsGraphLoaded(true);
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
      setNodesCallback([]);
      setEdgesCallback([]);
    } catch (err) {
      console.error("Logout failed", err);
    }
  };

  const handleFindRelationshipsForNode = useCallback(
    async (sourceNodeId: string) => {
      const sourceNode = nodes.find((n) => n.id === sourceNodeId);
      if (!sourceNode || !sourceNode.content || sourceNode.content.length < 3) {
        return;
      }

      const potentialTargets = nodes
        .filter(
          (n) =>
            n.id !== sourceNode.id &&
            n.content.length > 3 &&
            n.parentId === currentScopeId
        )
        .slice(-10);

      try {
        const relationships = await (aiProvider === "huggingface"
          ? hfService
          : geminiService
        ).findRelationships(
          { id: sourceNode.id, content: sourceNode.content },
          potentialTargets.map((n) => ({ id: n.id, content: n.content }))
        );

        if (relationships.length > 0) {
          setEdgesCallback((prev) => {
            const nextEdges = [...prev];
            relationships.forEach((rel) => {
              const exists = nextEdges.some(
                (e) =>
                  (e.source === sourceNode.id && e.target === rel.targetId) ||
                  (e.source === rel.targetId && e.target === sourceNode.id)
              );

              if (!exists) {
                nextEdges.push({
                  id: crypto.randomUUID(),
                  source: sourceNode.id,
                  target: rel.targetId,
                  label: rel.relationship,
                  parentId: currentScopeId || undefined,
                });
              }
            });
            return nextEdges;
          });
        }
      } catch (e: any) {
        if (e?.message === "LIMIT_REACHED") {
          setShowLimitModal(true);
        } else {
          console.error("Failed to find relationships", e);
        }
      }
    },
    [nodes, currentScopeId, setEdgesCallback]
  );

  // --- Auto-Resize Nodes Based on Children ---
  useEffect(() => {
    // Identify parents
    const parentIds = new Set(edges.map((e) => e.source));
    let hasChanges = false;
    const changedNodes: GraphNode[] = [];

    const newNodes = nodes.map((node) => {
      const isParent = parentIds.has(node.id);
      const currentW = node.width || DEFAULT_NODE_WIDTH;
      const currentH = node.height || DEFAULT_NODE_HEIGHT;

      let newW = currentW;
      let newH = currentH;

      // Logic: Only toggle between DEFAULT and PARENT sizes.
      // If user has custom size (e.g. 500x500), leave it alone.

      if (isParent) {
        // Upgrade to Parent Size if currently Default Leaf Size
        if (
          Math.abs(currentW - DEFAULT_NODE_WIDTH) < 1 &&
          Math.abs(currentH - DEFAULT_NODE_HEIGHT) < 1
        ) {
          newW = PARENT_NODE_WIDTH;
          newH = PARENT_NODE_HEIGHT;
        }
      } else {
        // Downgrade to Leaf Size if currently Parent Size
        // This handles cases where a node lost its last child
        if (
          Math.abs(currentW - PARENT_NODE_WIDTH) < 1 &&
          Math.abs(currentH - PARENT_NODE_HEIGHT) < 1
        ) {
          newW = DEFAULT_NODE_WIDTH;
          newH = DEFAULT_NODE_HEIGHT;
        }
      }

      if (newW !== currentW || newH !== currentH) {
        hasChanges = true;
        const updated = { ...node, width: newW, height: newH };
        changedNodes.push(updated);
        return updated;
      }
      return node;
    });

    if (hasChanges) {
      setNodesCallback(newNodes);
    }
  }, [edges, nodes, setNodesCallback]);

  // --- Initial Center on Selected Node ---
  useEffect(() => {
    if (!localStorageReady) return;
    if (hasCenteredOnStoredSelectionRef.current) return;

    if (selectedNodeIds.size > 0) {
      const primaryId = Array.from(selectedNodeIds)[0];
      const node = nodes.find((n) => n.id === primaryId);
      if (node) {
        const k = 1;
        const nodeW = node.width || DEFAULT_NODE_WIDTH;
        const nodeH = node.height || DEFAULT_NODE_HEIGHT;

        const nodeCenterX = node.x + nodeW / 2;
        const nodeCenterY = node.y + nodeH / 2;

        const newX = window.innerWidth / 2 - nodeCenterX * k;
        const newY = window.innerHeight / 2 - nodeCenterY * k;

        setViewTransform({ x: newX, y: newY, k });
        hasCenteredOnStoredSelectionRef.current = true;
      }
    }
  }, [localStorageReady, nodes, selectedNodeIds]);

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
      setNodesCallback((prev) =>
        prev.map((n) => {
          if (n.id === id) {
            const updated = { ...n, ...updates };
            return updated;
          }
          return n;
        })
      );
    },
    [setNodesCallback]
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
      setNodesCallback((prev) => prev.filter((node) => !ids.includes(node.id)));
      setEdgesCallback((prev) =>
        prev.filter(
          (edge) => !ids.includes(edge.source) && !ids.includes(edge.target)
        )
      );
      setSelectedNodeIds(new Set()); // Clear selection after deletion

      // If the cut node is among the deleted nodes, clear the cut state
      if (cutNodeId && ids.includes(cutNodeId)) {
        setCutNodeId(null);
      }

      // Close any side panels associated with deleted nodes
      setActiveSidePanes((prev) =>
        prev.filter((pane) => !(pane.type === "node" && idsSet.has(pane.data)))
      );

      setSelectedNodeIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });

      // 3. Set up Soft Delete / Undo Timer
      // We wait 5 seconds before actually deleting from disk/API
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

            setNodesCallback((prev) => [...prev, ...restoredNodes]);
            setEdgesCallback((prev) => [...prev, ...restoredEdges]);

            deletedNodeRef.current = null;
            setToast((prev) => ({ ...prev, visible: false }));
          }
        },
      });
    },
    [
      nodes,
      edges,
      dirHandle,
      user,
      deleteNodeFile,
      setNodesCallback,
      setEdgesCallback,
    ]
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

      // Cut (Ctrl+X / Cmd+X)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "x") {
        if (selectedNodeIds.size === 1) {
          e.preventDefault();
          handleCut(Array.from(selectedNodeIds)[0]);
        }
      }

      // Paste (Ctrl+V / Cmd+V)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
        e.preventDefault();
        // You might want to paste it at the current canvas view center or mouse position
        // For simplicity, let's paste it at a fixed offset from the original or center.
        // This needs to be refined for actual positioning.
        handlePaste({
          x: viewTransform.x + 50,
          y: viewTransform.y + 50,
        });
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    toast,
    selectedNodeIds,
    handleDeleteNode,
    confirmDeleteNode,
    handleCut,
    handlePaste,
    viewTransform.x,
    viewTransform.y,
    viewTransform.k,
  ]);

  const handleExpandNodeFromWikidata = useCallback(
    async (
      id: string,
      topic: string,
      nodeOverride?: GraphNode,
      depth?: number,
      options: { suppressToast?: boolean } = {}
    ): Promise<boolean> => {
      if (wikidataExpansionInFlightRef.current.has(id)) return false;
      wikidataExpansionInFlightRef.current.add(id);

      setExpandingNodeIds((prev) => (prev.includes(id) ? prev : [...prev, id]));

      const sourceNode = nodeOverride || nodes.find((n) => n.id === id);
      if (!sourceNode) {
        setExpandingNodeIds((prev) => prev.filter((nId) => nId !== id));
        wikidataExpansionInFlightRef.current.delete(id);
        return false;
      }

      const depthToUse =
        depth !== undefined ? depth : sourceNode.autoExpandDepth || 1;

      try {
        const subtopics = await fetchWikidataSubtopics(topic, {
          language: "en",
          resultLimit: WIKIDATA_SUBTOPIC_LIMIT,
        });

        if (subtopics.length === 0) {
          if (!options.suppressToast) {
            setToast({
              visible: true,
              message: `No Wikidata subtopics found for "${topic}".`,
            });
          }
          return false;
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

        setNodesCallback((prev) => [...prev, ...nodesToAdd]);
        setEdgesCallback((prev) => [...prev, ...edgesToAdd]);

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

          // Calculate zoom to fit
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
        return true;
      } catch (e: any) {
        console.error("Failed to expand from Wikidata:", e);
        if (!options.suppressToast) {
          setToast({
            visible: true,
            message: `Wikidata request failed for "${topic}".`,
          });
        }
        return false;
      } finally {
        setExpandingNodeIds((prev) => prev.filter((nId) => nId !== id));
        wikidataExpansionInFlightRef.current.delete(id);
      }
    },
    [nodes, currentScopeId, setNodesCallback, setEdgesCallback]
  );

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
          // --- Wikidata Check ---
          // Try to expand from Wikidata first
          const wikidataSuccess = await handleExpandNodeFromWikidata(
            id,
            topic,
            sourceNode,
            depth,
            { suppressToast: true }
          );

          if (wikidataSuccess) return;

          // Restart spinner if fallback (it was removed by handleExpandNodeFromWikidata)
          setExpandingNodeIds((prev) => [...prev, id]);

          // --- Gemini API Mode ---
          const existingNodeNames = nodes
            .filter((n) => n.parentId === currentScopeId)
            .map((n) => n.content);
          const result = await (aiProvider === "huggingface"
            ? hfService
            : geminiService
          ).expandNodeTopic(topic, existingNodeNames);

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

        setNodesCallback((prev) => [...prev, ...nodesToAdd]);
        setEdgesCallback((prev) => [...prev, ...edgesToAdd]);

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
          newK = Math.max(newK, 0.1);

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
    [nodes, currentScopeId, setNodesCallback, setEdgesCallback]
  );

  const handleMaximizeNode = useCallback((id: string) => {
    setActiveSidePanes((prevPanes) => {
      const existingNodePane = prevPanes.find(
        (pane) => pane.type === "node" && pane.data === id
      );
      if (existingNodePane) {
        // If already open, close it
        return prevPanes.filter((pane) => pane.id !== existingNodePane.id);
      } else {
        // Otherwise, open a new one on the right
        return [
          ...prevPanes,
          {
            id: crypto.randomUUID(),
            type: "node",
            data: id,
            initialDockPosition: "right",
          },
        ];
      }
    });
  }, []);

  const handleOpenLink = useCallback((url: string) => {
    const isWikipedia = url.includes("wikipedia.org/wiki/");
    if (isWikipedia) {
      // Create a new side panel for Wikipedia links on the left
      setActiveSidePanes((prevPanes) => [
        ...prevPanes,
        {
          id: crypto.randomUUID(),
          type: "web",
          data: url,
          initialDockPosition: "left",
          initialWidthPercent: 33,
        },
      ]);
    } else {
      // For other web links, reuse an existing web panel or create a new one on the right
      setActiveSidePanes((prevPanes) => {
        const existingWebPane = prevPanes.find(
          (pane) => pane.type === "web" && pane.initialDockPosition !== "left"
        );
        if (existingWebPane) {
          return prevPanes.map((pane) =>
            pane.id === existingWebPane.id ? { ...pane, data: url } : pane
          );
        }
        return [
          ...prevPanes,
          {
            id: crypto.randomUUID(),
            type: "web",
            data: url,
            initialDockPosition: "right",
            initialWidthPercent: 33,
          },
        ];
      });
    }
  }, []);

  const handleCloseSidePane = useCallback((id: string) => {
    setActiveSidePanes((prevPanes) =>
      prevPanes.filter((pane) => pane.id !== id)
    );
    setSidePanelLayouts((prevLayouts) => {
      const newLayouts = { ...prevLayouts };
      delete newLayouts[id];
      return newLayouts;
    });
  }, []);

  const handleNavigateToNodeLink = useCallback(
    (rawTitle: string) => {
      const normalize = (value?: string | null) =>
        value ? value.trim().toLowerCase() : "";
      const target = normalize(rawTitle);
      if (!target) return;

      const matchesNode = (graphNode: GraphNode) => {
        if (normalize(graphNode.content) === target) return true;
        if (normalize(graphNode.summary) === target) return true;
        if (graphNode.aliases?.some((alias) => normalize(alias) === target))
          return true;
        if (graphNode.type === NodeType.NOTE) {
          const noteTitle = normalize(
            (graphNode.content || "").split("\n")[0] || ""
          );
          if (noteTitle === target) return true;
        }
        return false;
      };

      const matchedNode = nodes.find(matchesNode);
      if (!matchedNode) return;

      setCurrentScopeId(matchedNode.parentId ?? null);
      setSelectedNodeIds(new Set([matchedNode.id]));
      if (typeof window === "undefined") return;
      setViewTransform((prev) => {
        const k = prev.k;
        const nodeCenterX =
          matchedNode.x + (matchedNode.width || DEFAULT_NODE_WIDTH) / 2;
        const nodeCenterY =
          matchedNode.y + (matchedNode.height || DEFAULT_NODE_HEIGHT) / 2;
        return {
          x: window.innerWidth / 2 - nodeCenterX * k,
          y: window.innerHeight / 2 - nodeCenterY * k,
          k,
        };
      });
    },
    [nodes, setCurrentScopeId, setSelectedNodeIds, setViewTransform]
  );

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
      setConnectingNodeId(null);
    },
    [currentScopeId, setEdgesCallback]
  );

  const handleCreateFromSelection = useCallback(
    async (type: NodeType) => {
      if (!selectionTooltip) return;
      let newNodeX = 0,
        newNodeY = 0;
      const sourceNode = nodes.find((n) => n.id === selectionTooltip.sourceId);
      if (sourceNode) {
        newNodeX = sourceNode.x + (sourceNode.width || DEFAULT_NODE_WIDTH) + 50;
        newNodeY = sourceNode.y;
      } else {
        const canvasX =
          (selectionTooltip.x - viewTransform.x) / viewTransform.k;
        const canvasY =
          (selectionTooltip.y - viewTransform.y) / viewTransform.k;
        newNodeX = canvasX + 100;
        newNodeY = canvasY + 50;
      }

      const promptTemplate = geminiService.getTopicSummaryPrompt(
        selectionTooltip.text
      );
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
      setSelectionTooltip(null);
      window.getSelection()?.removeAllRanges();

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
    [
      selectionTooltip,
      nodes,
      viewTransform,
      setNodesCallback,
      setEdgesCallback,
      currentScopeId,
      setSelectedNodeIds,
    ]
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

      setNodesCallback((prev) => [...prev, newNode]);

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
            // Save final state
            const updatedNode = { ...newNode };
            if (updatedNode.messages) {
              const lastMsg =
                updatedNode.messages[updatedNode.messages.length - 1];
              if (lastMsg.role === "model") lastMsg.text = result.text;
            }
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
    [viewTransform, handleExpandNode, currentScopeId, setNodesCallback]
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
      setNodesCallback([]);
      setEdgesCallback([]);
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
    setNodesCallback([]); // Clear?
    setEdgesCallback([]);
    window.location.reload();
  }, [user, setNodesCallback, setEdgesCallback]);

  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  // Breadcrumbs: show scope hierarchy plus the lineage of connected nodes within that scope
  const getBreadcrumbs = () => {
    const rootName = dirName || "Home";
    type Breadcrumb = {
      id: string | null;
      name: string;
      type: "root" | "scope" | "node";
    };
    const crumbs: Breadcrumb[] = [];
    const seenIds = new Set<string | null>();

    const pushCrumb = (crumb: Breadcrumb) => {
      const key = crumb.id ?? null;
      if (seenIds.has(key)) return;
      crumbs.push(crumb);
      seenIds.add(key);
    };

    pushCrumb({ id: null, name: rootName, type: "root" });

    const activeId =
      selectedNodeIds.size > 0 ? Array.from(selectedNodeIds)[0] : null;
    const activeNode = activeId ? nodeMap.get(activeId) : null;
    const activeScopeId = activeNode
      ? activeNode.parentId ?? null
      : currentScopeId ?? null;
    const scopeNode = activeScopeId ? nodeMap.get(activeScopeId) : null;

    const appendScopeAncestors = (node?: GraphNode | null) => {
      if (!node) return;
      const stack: GraphNode[] = [];
      const visited = new Set<string>();
      let current: GraphNode | undefined | null = node;
      while (current?.parentId) {
        if (visited.has(current.parentId)) break;
        const parent = nodeMap.get(current.parentId);
        if (!parent) break;
        stack.unshift(parent);
        visited.add(parent.id);
        current = parent;
      }
      stack.forEach((ancestor) =>
        pushCrumb({
          id: ancestor.id,
          name: getNodeTitleForBreadcrumb(ancestor),
          type: "scope",
        })
      );
    };

    if (scopeNode) {
      appendScopeAncestors(scopeNode);
      pushCrumb({
        id: scopeNode.id,
        name: getNodeTitleForBreadcrumb(scopeNode),
        type: "scope",
      });
    }

    const nodesInScope = nodes.filter((n) => n.parentId == activeScopeId);
    const edgesInScope = edges.filter((e) => e.parentId == activeScopeId);

    const buildLineageInScope = () => {
      if (!activeId || !activeNode) return [] as GraphNode[];
      if (nodesInScope.length === 0) return [activeNode];

      const nodeIdsInScope = new Set(nodesInScope.map((n) => n.id));
      if (!nodeIdsInScope.has(activeId)) return [activeNode];

      const adjacency = new Map<string, Set<string>>();
      nodesInScope.forEach((n) => adjacency.set(n.id, new Set()));
      edgesInScope.forEach((edge) => {
        const sourceNeighbors = adjacency.get(edge.source);
        const targetNeighbors = adjacency.get(edge.target);
        if (sourceNeighbors) sourceNeighbors.add(edge.target);
        if (targetNeighbors) targetNeighbors.add(edge.source);
      });

      const inDegree = new Map<string, number>();
      nodesInScope.forEach((n) => inDegree.set(n.id, 0));
      edgesInScope.forEach((edge) => {
        const current = inDegree.get(edge.target);
        if (typeof current === "number") {
          inDegree.set(edge.target, current + 1);
        }
      });

      const rootCandidates = nodesInScope.filter(
        (n) => (inDegree.get(n.id) || 0) === 0
      );
      const traversalStarts =
        rootCandidates.length > 0 ? rootCandidates : nodesInScope;

      const queue: string[] = [];
      const visited = new Set<string>();
      const parentMap = new Map<string, string>();

      const enqueue = (id: string) => {
        if (visited.has(id)) return;
        visited.add(id);
        queue.push(id);
      };

      traversalStarts.forEach((node) => enqueue(node.id));

      let found = false;
      while (queue.length > 0) {
        const current = queue.shift()!;
        if (current === activeId) {
          found = true;
          break;
        }
        const neighbors = adjacency.get(current);
        if (!neighbors) continue;
        neighbors.forEach((neighbor) => {
          if (visited.has(neighbor)) return;
          parentMap.set(neighbor, current);
          enqueue(neighbor);
        });
      }

      if (!found) return [activeNode];

      const lineagePath: GraphNode[] = [];
      let cursor: string | undefined = activeId;
      while (cursor) {
        const node = nodeMap.get(cursor);
        if (node) lineagePath.unshift(node);
        cursor = parentMap.get(cursor);
      }
      return lineagePath;
    };

    if (activeNode) {
      const lineagePath = buildLineageInScope();
      lineagePath.forEach((node) =>
        pushCrumb({
          id: node.id,
          name: getNodeTitleForBreadcrumb(node),
          type: "node",
        })
      );
    }

    return crumbs;
  };

  const filteredNodes = useMemo(
    () => nodes.filter((n) => n.parentId == currentScopeId),
    [nodes, currentScopeId]
  );

  // Apply clustering logic for rendering
  const clusteredNodes = useMemo(() => {
    return performGreedyClustering(filteredNodes, viewTransform.k);
  }, [filteredNodes, viewTransform.k]);

  const visibleNodeIds = useMemo(
    () => new Set(clusteredNodes.map((n) => n.id)),
    [clusteredNodes]
  );

  const filteredEdges = useMemo(
    () =>
      edges.filter((e) => {
        if (e.parentId != currentScopeId) return false;
        // Only show edges between visible nodes (hides edges connected to clusters for now)
        return visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target);
      }),
    [edges, currentScopeId, visibleNodeIds]
  );

  const handleOpenStorage = useCallback(async () => {
    if (user) {
      // Check if user is paid for Cloud Storage
      // Note: We use 'isPaid' from the user object (make sure to update user type or just cast)
      if ((user as any).isPaid) {
        setIsGraphLoaded(false);
        // For cloud, we don't need a local path, but we set a virtual one to indicate connection
        setDirName("Cloud Storage");

        try {
          // Initial load handled by viewport effect
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
            setNodesCallback(loadedNodes);
            setEdgesCallback(loadedEdges);
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
            setNodesCallback(loadedNodes);
            setEdgesCallback(loadedEdges);
          }
          setIsGraphLoaded(true);
        } catch (e) {
          console.error("Error loading from directory", e);
          setIsGraphLoaded(true); // Reset on error
          alert("Failed to load graph from directory.");
        }
      }
    }
  }, [user, nodes, edges, setNodesCallback, setEdgesCallback]);

  const getSidePanelContent = useCallback(
    (activePane: ActiveSidePane) => {
      const sidebarNode =
        activePane.type === "node"
          ? nodes.find((n) => n.id === activePane.data)
          : null;
      return (
        <ErrorBoundary>
          {activePane.type === "web" ? (
            <WebContent
              url={activePane.data}
              onClose={() => handleCloseSidePane(activePane.id)}
              onWikipediaLinkClick={handleOpenLink} // Pass handleOpenLink for new Wikipedia panels
            />
          ) : sidebarNode ? (
            <GraphNodeComponent
              key={sidebarNode.id}
              node={sidebarNode}
              allNodes={nodes}
              viewMode="sidebar"
              onUpdate={handleUpdateNode}
              onExpand={handleExpandNode}
              onExpandFromWikidata={handleExpandNodeFromWikidata}
              onDelete={handleDeleteNode}
              onToggleMaximize={handleMaximizeNode}
              onOpenLink={handleOpenLink}
              onNavigateToNode={handleNavigateToNodeLink}
              autoGraphEnabled={autoGraphEnabled}
              onSetAutoGraphEnabled={setAutoGraphEnabled}
              cutNodeId={cutNodeId}
              aiProvider={aiProvider}
            />
          ) : (
            <div className="p-4 text-slate-500">Node not found.</div>
          )}
        </ErrorBoundary>
      );
    },
    [
      nodes,
      handleCloseSidePane,
      handleUpdateNode,
      handleExpandNode,
      handleExpandNodeFromWikidata,
      handleDeleteNode,
      handleMaximizeNode,
      handleOpenLink,
      handleNavigateToNodeLink,
      autoGraphEnabled,
      setAutoGraphEnabled,
      cutNodeId,
    ]
  );

  // Memoize SidePanels to prevent re-rendering on canvas pan (viewTransform change)
  const sidePanels = useMemo(
    () =>
      activeSidePanes.map((pane) => (
        <SidePanel
          key={pane.id}
          id={pane.id}
          onClose={handleCloseSidePane}
          initialWidthPercent={pane.initialWidthPercent}
          initialDockPosition={pane.initialDockPosition}
          hideDefaultDragHandle={pane.type === "node"} // Hide drag handle for node panels
          onLayoutChange={handleSidePanelLayoutChange}
        >
          {getSidePanelContent(pane)}
        </SidePanel>
      )),
    [
      activeSidePanes,
      handleCloseSidePane,
      handleSidePanelLayoutChange,
      getSidePanelContent,
    ]
  );

  return (
    <div className="flex w-screen h-screen overflow-hidden bg-slate-900 text-slate-200 font-sans">
      <div className="flex-1 relative min-w-0 flex flex-col">
        {/* Auth/Folder/Search Buttons */}
        <div
          className={`absolute top-4 right-4 z-[60] flex gap-3 items-center pointer-events-none transition-all duration-200 ${
            activeSidePanes.length > 0
              ? "opacity-0 invisible"
              : "opacity-100 visible"
          }`}
        >
          {/* Search Button */}
          <button
            id="search-trigger-icon"
            onClick={() => setIsSearchOpen((prev) => !prev)}
            className="p-2 text-slate-400 hover:text-white bg-slate-800/80 backdrop-blur rounded-lg border border-slate-700 pointer-events-auto transition-all shadow-lg"
            title="Search"
          >
            <svg
              className="h-5 w-5"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </button>

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
            <button
              onClick={() => setShowProfile(true)}
              className="w-10 h-10 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-400 hover:text-white hover:border-slate-500 transition-all shadow-lg pointer-events-auto"
              title={user.username}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </button>
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
            onPreview={handleOpenLink}
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
            nodes={clusteredNodes}
            allNodes={nodes}
            edges={filteredEdges}
            setNodes={setNodesCallback}
            setEdges={setEdgesCallback}
            viewTransform={viewTransform}
            onViewTransformChange={setViewTransform}
            onOpenStorage={handleOpenStorage}
            storageConnected={!!dirName}
            storageDirName={dirName}
            isSaving={false}
            onOpenLink={handleOpenLink}
            onNavigateToNode={handleNavigateToNodeLink}
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
            // Pass the aggregated canvas shifts to Canvas for positioning
            canvasShiftX={canvasShiftX}
            canvasShiftY={canvasShiftY}
            isResizing={isAnyPanelResizing}
            onSelectionTooltipChange={setSelectionTooltip}
            cutNodeId={cutNodeId}
            setCutNodeId={setCutNodeId}
            aiProvider={aiProvider}
          />
        </ErrorBoundary>
      </div>

      {sidePanels}

      {selectionTooltip && !connectingNodeId && (
        <SelectionTooltip
          tooltip={selectionTooltip}
          onClose={() => setSelectionTooltip(null)}
          onCreateNote={() => handleCreateFromSelection(NodeType.NOTE)}
          onCreateChat={() => handleCreateFromSelection(NodeType.CHAT)}
          onExpandGraph={() => {
            if (selectionTooltip.sourceId) {
              handleExpandNode(
                selectionTooltip.sourceId,
                selectionTooltip.text
              );
              setSelectionTooltip(null);
              window.getSelection()?.removeAllRanges();
            }
          }}
          onFindRelationships={() => {
            if (selectionTooltip.sourceId) {
              handleFindRelationshipsForNode(selectionTooltip.sourceId);
              setSelectionTooltip(null);
              window.getSelection()?.removeAllRanges();
            }
          }}
          isMobile={
            typeof window !== "undefined" &&
            window.matchMedia("(max-width: 768px)").matches
          }
        />
      )}

      {showAuth && (
        <div className="fixed inset-0 z-[100]">
          <ErrorBoundary>
            <AuthPage
              initialMode={authMode}
              onLogin={async (user) => {
                setUser(user);
                setShowAuth(false);

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
                    .then(({ nodes: loadedNodes, edges: loadedEdges }) => {
                      if (loadedNodes && loadedNodes.length > 0) {
                        setNodesCallback(loadedNodes);
                        setEdgesCallback(loadedEdges);
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
                    .then(({ nodes: loadedNodes, edges: loadedEdges }) => {
                      if (loadedNodes && loadedNodes.length > 0) {
                        setNodesCallback(loadedNodes);
                        setEdgesCallback(loadedEdges);
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
                    .then(({ nodes: loadedNodes, edges: loadedEdges }) => {
                      if (loadedNodes && loadedNodes.length > 0) {
                        setNodesCallback(loadedNodes);
                        setEdgesCallback(loadedEdges);
                      }
                      setIsGraphLoaded(true);
                    })
                    .catch((e) => {
                      console.error("Failed to load cloud graph on login", e);
                      setIsGraphLoaded(true);
                    });
                }
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
            aiProvider={aiProvider}
            onSetAiProvider={handleSetAiProvider}
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
