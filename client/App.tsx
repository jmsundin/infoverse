import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { useAuth } from "./context/AuthContext";
import { useStorage } from "./context/StorageContext";
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
import { SelectionTooltip } from "./components/SelectionTooltip";
import { Breadcrumbs } from "./components/Breadcrumbs";
import { HeaderActions } from "./components/HeaderActions";
import { ScopeIndicator } from "./components/ScopeIndicator";
import { PhysicsSettingsPanel } from "./components/PhysicsSettingsPanel";
import { OutlineTreePanel } from "./components/OutlineTreePanel";
import { MigrationProgressBar } from "./components/MigrationProgressBar";
import { getMigrationService } from "./services/migration/MigrationService";
import { MigrationProgress } from "./services/migration/types";
import {
  GraphEdge,
  GraphNode,
  NodeType,
  ViewportTransform,
  SelectionTooltipState,
  PhysicsConfig,
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
  verifyPermission,
  migrateEdgesToNodes,
  getOutgoingEdges,
} from "./services/storageService";
import {
  getDirectoryHandle,
  storeDirectoryHandle,
} from "./services/idbService";
import {
  updateUserSettings,
} from "./services/apiStorageService";
import {
  getAIProvider,
  setAIProvider as saveAIProvider,
  getLastDirName,
  setLastDirName,
  cleanupLegacyStorage,
  getPhysicsConfig,
  setPhysicsConfig as savePhysicsConfig,
} from "./services/settingsService";
import { importFromCloud } from "./services/cloudSyncService";
import { useGraphState } from "./hooks/useGraphState";
import { usePersistence } from "./hooks/usePersistence";
import { useViewportStorage, USE_VIEWPORT_STORAGE } from "./hooks/useViewportStorage";
import { useSidePanes } from "./hooks/useSidePanes";
import { useExpansion } from "./hooks/useExpansion";
import { useNavigation } from "./hooks/useNavigation";
import { useGraphOperations } from "./hooks/useGraphOperations";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useBreadcrumbs } from "./hooks/useBreadcrumbs";
import { usePhysicsSimulation } from "./hooks/usePhysicsSimulation";
import { createDefaultGraphNodes } from "./utils/graphUtils";
import { performGreedyClustering } from "./utils/clustering";

import { StorageTest } from './components/StorageTest';

const App: React.FC = () => {
  // --- Auth & Storage from Context ---
  const { user, setUser, login, logout, isLoading: authLoading } = useAuth();
  const { storageMode, isMigrating, initializeInMemory } = useStorage();

  // --- Hooks for State ---
  const {
    nodes,
    setNodes,
    edges,
    setEdges,
    currentScopeId,
    setCurrentScopeId,
    selectedNodeIds,
    setSelectedNodeIds,
    setIsGraphLoaded,
  } = useGraphState();

  const [autoGraphEnabled, setAutoGraphEnabled] = useState<boolean>(true);
  const [viewTransform, setViewTransform] = useState<ViewportTransform>({
    x: 0,
    y: 0,
    k: 1,
  });
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [connectingNodeId, setConnectingNodeId] = useState<string | null>(null);
  const [selectionTooltip, setSelectionTooltip] =
    useState<SelectionTooltipState | null>(null);
  const [toast, setToast] = useState<{
    visible: boolean;
    message: string;
    action?: () => void;
  }>({ visible: false, message: "" });
  const [dirHandle, setDirHandle] = useState<FileSystemDirectoryHandle | null>(
    null
  );
  const [dirName, setDirName] = useState<string | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [showProfile, setShowProfile] = useState(false);
  const [usageNotification, setUsageNotification] = useState<{
    message: string;
    visible: boolean;
  }>({ message: "", visible: false });
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isOutlinePanelOpen, setIsOutlinePanelOpen] = useState(false);
  const [cutNodeId, setCutNodeId] = useState<string | null>(null);
  const [aiProvider, setAiProviderState] = useState<"gemini" | "huggingface">(getAIProvider);
  const [physicsConfig, setPhysicsConfigState] = useState<PhysicsConfig>(getPhysicsConfig);
  const [migrationProgress, setMigrationProgress] = useState<MigrationProgress | null>(null);

  // Window dimensions for viewport-based storage
  const [windowSize, setWindowSize] = useState({ width: window.innerWidth, height: window.innerHeight });

  // Track window resize for viewport calculations
  useEffect(() => {
    const handleResize = () => {
      setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Wrapper to persist AI provider changes
  const setAiProvider = useCallback((provider: "gemini" | "huggingface") => {
    setAiProviderState(provider);
    saveAIProvider(provider);
  }, []);

  // Wrapper to persist physics config changes
  const setPhysicsConfig = useCallback((config: Partial<PhysicsConfig>) => {
    setPhysicsConfigState(prev => {
      const updated = { ...prev, ...config };
      savePhysicsConfig(updated);
      return updated;
    });
  }, []);

  const deletedNodeRef = useRef<{
    nodes: GraphNode[];
    edges: GraphEdge[];
    timer: number | null;
  } | null>(null);

  // --- Persistence ---
  const { debouncedFlushSaves, markNodeDirty, markEdgesDirty } = usePersistence(
    user,
    dirHandle
  );

  // --- Viewport-Based Storage (Two-Phase Loading) ---
  // When enabled, this provides lazy loading with skeleton placeholders
  const viewportStorage = useViewportStorage({
    enabled: USE_VIEWPORT_STORAGE && !!dirHandle,
    dirHandle,
    userId: user?.id ?? null,
    viewTransform,
    containerWidth: windowSize.width,
    containerHeight: windowSize.height,
    bufferMultiplier: 1.3,
    debounceMs: 150,
  });

  // When viewport storage is enabled and initialized, sync nodes/edges from it
  useEffect(() => {
    if (USE_VIEWPORT_STORAGE && viewportStorage.isInitialized && dirHandle) {
      // Viewport storage takes over node/edge state management
      if (viewportStorage.nodes.length > 0) {
        setNodes(viewportStorage.nodes);
      }
      if (viewportStorage.edges.length > 0) {
        setEdges(viewportStorage.edges);
      }
    }
  }, [viewportStorage.isInitialized, viewportStorage.nodes, viewportStorage.edges, dirHandle, setNodes, setEdges]);

  const setNodesCallback = useCallback(
    (newNodes: GraphNode[] | ((prev: GraphNode[]) => GraphNode[])) => {
      setNodes((prev) => {
        const resolvedNodes =
          typeof newNodes === "function" ? newNodes(prev) : newNodes;
        const uniqueNodes = Array.from(
          new Map(resolvedNodes.map((n) => [n.id, n])).values()
        );

        const prevById = new Map(prev.map((n) => [n.id, n]));
        for (const n of uniqueNodes) {
          const p = prevById.get(n.id);
          if (!p || p !== n) {
            const semanticChanged =
              !p ||
              p.content !== n.content ||
              p.summary !== n.summary ||
              JSON.stringify(p.aliases || []) !==
                JSON.stringify(n.aliases || []);
            markNodeDirty(n, !semanticChanged);
          }
        }
        debouncedFlushSaves(
          uniqueNodes,
          edges,
          viewTransform,
          autoGraphEnabled,
          currentScopeId,
          selectedNodeIds
        );
        return uniqueNodes;
      });
    },
    [
      edges,
      viewTransform,
      autoGraphEnabled,
      currentScopeId,
      selectedNodeIds,
      debouncedFlushSaves,
      markNodeDirty,
      setNodes,
    ]
  );

  const setEdgesCallback = useCallback(
    (newEdges: GraphEdge[] | ((prev: GraphEdge[]) => GraphEdge[])) => {
      setEdges((prev) => {
        const resolvedEdges =
          typeof newEdges === "function" ? newEdges(prev) : newEdges;
        markEdgesDirty();
        debouncedFlushSaves(
          nodes,
          resolvedEdges,
          viewTransform,
          autoGraphEnabled,
          currentScopeId,
          selectedNodeIds
        );
        return resolvedEdges;
      });
    },
    [
      nodes,
      viewTransform,
      autoGraphEnabled,
      currentScopeId,
      selectedNodeIds,
      debouncedFlushSaves,
      markEdgesDirty,
      setEdges,
    ]
  );

  // --- Physics Simulation ---
  const {
    isSimulating,
    startSimulation,
    stopSimulation,
    startDrag: physicsStartDrag,
    updateDragPosition: physicsUpdateDrag,
    endDrag: physicsEndDrag,
    pinNode,
    unpinNode,
    togglePinNode,
  } = usePhysicsSimulation(nodes, edges, setNodesCallback, { config: physicsConfig });

  // --- Expansion ---
  const { expandingNodeIds, handleExpandNode, handleExpandNodeFromWikidata } =
    useExpansion(
      nodes,
      currentScopeId,
      setNodesCallback,
      setEdgesCallback,
      aiProvider,
      setViewTransform,
      setToast,
      setShowLimitModal,
      startSimulation
    );

  // --- Side Panels ---
  const {
    activeSidePanes,
    setActiveSidePanes,
    sidePanelLayouts,
    handleCloseSidePane,
    handleSidePanelLayoutChange,
    isAnyPanelResizing,
  } = useSidePanes();

  // --- Operations ---
  const {
    handleUpdateNode,
    handleDeleteNode,
    confirmDeleteNode,
    handleCut,
    handlePaste,
    handleConnectEnd,
    handleCreateFromSelection,
    handleSearchSelect,
  } = useGraphOperations(
    nodes,
    edges,
    setNodesCallback,
    setEdgesCallback,
    currentScopeId,
    setCurrentScopeId,
    selectedNodeIds,
    setSelectedNodeIds,
    viewTransform,
    setViewTransform,
    setToast,
    setCutNodeId,
    cutNodeId,
    dirHandle,
    user,
    setShowLimitModal,
    aiProvider,
    handleExpandNode,
    deletedNodeRef,
    setActiveSidePanes,
    startSimulation
  );

  // --- Navigation ---
  const { handleNavigateDown, handleNavigateUp, handleFocusNode } =
    useNavigation(
      nodes,
      currentScopeId,
      setCurrentScopeId,
      setSelectedNodeIds,
      viewTransform,
      setViewTransform,
      setNodes,
      setEdges,
      user,
      dirName
    );

  // --- Keyboard Shortcuts ---
  useKeyboardShortcuts(
    selectedNodeIds,
    confirmDeleteNode,
    setIsSearchOpen,
    handleCut,
    handlePaste,
    viewTransform,
    toast.visible,
    toast.action
  );

  // --- Breadcrumbs ---
  const breadcrumbs = useBreadcrumbs(
    nodes,
    edges,
    currentScopeId,
    selectedNodeIds,
    dirName
  );

  // --- Layout Shifts ---
  const [canvasShiftX, setCanvasShiftX] = useState(0);
  const [canvasShiftY, setCanvasShiftY] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let newLeftShift = 0,
      newRightShift = 0,
      newTopShift = 0,
      newBottomShift = 0;
    Object.values(sidePanelLayouts).forEach((layout) => {
      const { width, height, dockPosition } = layout;
      if (dockPosition === "left")
        newLeftShift = Math.max(
          newLeftShift,
          (window.innerWidth * width) / 100
        );
      else if (dockPosition === "right")
        newRightShift = Math.max(
          newRightShift,
          (window.innerWidth * width) / 100
        );
      else if (dockPosition === "top-left" || dockPosition === "top-right")
        newTopShift = Math.max(
          newTopShift,
          (window.innerHeight * height) / 100
        );
      else if (
        dockPosition === "bottom-left" ||
        dockPosition === "bottom-right"
      )
        newBottomShift = Math.max(
          newBottomShift,
          (window.innerHeight * height) / 100
        );
    });
    const totalXShift = newLeftShift - newRightShift;
    const totalYShift = newTopShift - newBottomShift;
    if (Math.abs(totalXShift - canvasShiftX) > 1) setCanvasShiftX(totalXShift);
    if (Math.abs(totalYShift - canvasShiftY) > 1) setCanvasShiftY(totalYShift);
  }, [sidePanelLayouts, canvasShiftX, canvasShiftY]);

  // --- Storage & Sync Logic ---
  useEffect(() => {
    const initializeApp = async () => {
      // Wait for auth check to complete
      if (authLoading) return;

      // Clean up legacy localStorage on app start
      cleanupLegacyStorage();

      try {
        // Check for stored directory handle first (local-first approach)
        const storedHandle = await getDirectoryHandle();

        if (storedHandle) {
          // Verify permission
          const hasPermission = await verifyPermission(storedHandle, true);

          if (hasPermission) {
            setDirHandle(storedHandle);
            setDirName(storedHandle.name);
            setLastDirName(storedHandle.name);

            // Load from local directory (MASTER)
            const { nodes: loadedNodes, edges: loadedEdges, hasLegacyEdgesFile } =
              await loadGraphFromDirectory(storedHandle);

            if (loadedNodes.length > 0) {
              setNodes(loadedNodes);
              setEdges(loadedEdges);

              // Migrate edges if needed
              if (hasLegacyEdgesFile) {
                console.log("Migrating edges to node files...");
                await migrateEdgesToNodes(storedHandle, loadedNodes, loadedEdges);
              }
            }
          } else {
            // Permission denied - show last known directory name
            const lastDir = getLastDirName();
            if (lastDir) {
              setDirName(`${lastDir} (click to reopen)`);
            }
          }
        }

        // Handle storage based on auth state
        if (user) {
          // Authenticated user - use cloud/local storage
          if (!storedHandle) {
            setDirName("Cloud Storage");
          }
        } else {
          // Unauthenticated user - initialize in-memory storage
          await initializeInMemory();
        }

        setIsGraphLoaded(true);
      } catch (err) {
        console.error("App initialization failed", err);
        setIsGraphLoaded(true);
      }
    };

    initializeApp();
  }, [setNodes, setEdges, setIsGraphLoaded, authLoading, user, initializeInMemory]);

  const handleLogout = async () => {
    try {
      await logout();
      setDirHandle(null);
      setDirName(null);
      setNodes(createDefaultGraphNodes());
      setEdges([]);
      // Re-initialize in-memory storage for unauthenticated state
      await initializeInMemory();
    } catch (err) {
      console.error("Logout failed", err);
    }
  };

  const handleOpenStorage = useCallback(async () => {
    const handle = await pickDirectory();
    if (handle) {
      await storeDirectoryHandle(handle);
      setDirHandle(handle);
      setDirName(handle.name);
      setLastDirName(handle.name); // Persist for next session

      try {
        // Load graph from directory
        const { nodes: loadedNodes, edges: loadedEdges, hasLegacyEdgesFile } =
          await loadGraphFromDirectory(handle);

        if (loadedNodes.length > 0) {
          setNodes(loadedNodes);
          setEdges(loadedEdges);

          // Migrate edges from _edges.json to embedded in node files
          if (hasLegacyEdgesFile) {
            console.log("Migrating edges to node files...");
            await migrateEdgesToNodes(handle, loadedNodes, loadedEdges);
          }
        } else if (nodes.length > 0) {
          // Directory is empty, save current nodes with their edges
          for (const node of nodes) {
            const outgoingEdges = getOutgoingEdges(node.id, edges);
            await saveNodeToFile(handle, node, outgoingEdges);
          }
        }

        // Clean up legacy localStorage graph data
        cleanupLegacyStorage();
        setIsGraphLoaded(true);
      } catch (e) {
        console.error("Error loading from directory", e);
        setIsGraphLoaded(true);
        alert("Failed to load graph from directory.");
      }
    }
  }, [nodes, edges, setNodes, setEdges, setIsGraphLoaded]);

  // Handle schema migration
  const handleStartMigration = useCallback(async () => {
    if (!dirHandle) return;

    const migrationService = getMigrationService();

    // Load last migration timestamp if available
    const lastTimestamp = migrationService.getLastMigrationTimestamp();
    if (lastTimestamp) {
      setMigrationProgress({
        isRunning: false,
        totalNodes: 0,
        processedNodes: 0,
        nodesNeedingUpdates: 0,
        currentStatus: 'Idle',
        lastMigrationTimestamp: lastTimestamp,
        errors: [],
      });
    }

    try {
      await migrationService.runMigration(
        // loadNode
        async (nodeId: string) => {
          return nodes.find((n) => n.id === nodeId) || null;
        },
        // saveNode
        async (node: GraphNode) => {
          // Update in-memory state
          setNodes((prev) => prev.map((n) => (n.id === node.id ? node : n)));
          // Persist to filesystem
          if (dirHandle) {
            const outgoingEdges = getOutgoingEdges(node.id, edges);
            await saveNodeToFile(dirHandle, node, outgoingEdges);
          }
        },
        // getAllNodeIds
        () => nodes.map((n) => n.id),
        // onProgress
        setMigrationProgress
      );
    } catch (e) {
      console.error('Migration failed:', e);
    }
  }, [dirHandle, nodes, edges, setNodes]);

  // Cancel migration
  const handleCancelMigration = useCallback(() => {
    const migrationService = getMigrationService();
    migrationService.cancel();
  }, []);

  // Import graph from cloud storage
  const handleImportFromCloud = useCallback(async () => {
    if (!user) return;

    const cloudData = await importFromCloud();
    if (cloudData && (cloudData.nodes.length > 0 || cloudData.edges.length > 0)) {
      setNodes(cloudData.nodes);
      setEdges(cloudData.edges);

      // If we have a directory handle, save imported data to filesystem
      if (dirHandle) {
        for (const node of cloudData.nodes) {
          const outgoingEdges = getOutgoingEdges(node.id, cloudData.edges);
          await saveNodeToFile(dirHandle, node, outgoingEdges);
        }
      }

      setToast({ visible: true, message: "Imported from cloud successfully" });
    } else {
      setToast({ visible: true, message: "No data found in cloud storage" });
    }
  }, [user, dirHandle, setNodes, setEdges]);

  const handleCloseFolder = useCallback(async () => {
    if ((user as any)?.isPaid) {
      setDirName(null);
      setNodes(createDefaultGraphNodes());
      setEdges([]);
      return;
    }
    if (user?.storagePath) {
      try {
        await updateUserSettings("");
        setUser((prev: any) =>
          prev ? { ...prev, storagePath: undefined } : null
        );
      } catch (e) {
        console.error("Failed to clear user settings", e);
      }
    }
    setDirHandle(null);
    setDirName(null);
    setNodes(createDefaultGraphNodes());
    setEdges([]);
    window.location.reload();
  }, [user, setNodes, setEdges]);

  // --- Clustering and Filtering for Rendering ---
  const filteredNodes = useMemo(
    () =>
      nodes.filter((n) => (n.parentId ?? null) === (currentScopeId ?? null)),
    [nodes, currentScopeId]
  );

  const clusteredNodes = useMemo(() => {
    return performGreedyClustering(filteredNodes, edges, viewTransform.k);
  }, [filteredNodes, edges, viewTransform.k]);

  const visibleNodeIds = useMemo(() => {
    const ids = new Set<string>();
    clusteredNodes.forEach((n) => {
      if (n.type === NodeType.CLUSTER && n.clusterIds) {
        n.clusterIds.forEach((id) => ids.add(id));
      } else {
        ids.add(n.id);
      }
    });
    return ids;
  }, [clusteredNodes]);

  const filteredEdges = useMemo(
    () =>
      edges.filter((e) => {
        if ((e.parentId ?? null) !== (currentScopeId ?? null)) return false;
        const sourceVisible = visibleNodeIds.has(e.source);
        const targetVisible = visibleNodeIds.has(e.target);
        return sourceVisible && targetVisible;
      }),
    [edges, currentScopeId, visibleNodeIds]
  );

  const edgesToRender = useMemo(() => {
    const idToRenderedId = new Map<string, string>();
    clusteredNodes.forEach((n) => {
      if (n.type === NodeType.CLUSTER && n.clusterIds) {
        n.clusterIds.forEach((id) => idToRenderedId.set(id, n.id));
      } else {
        idToRenderedId.set(n.id, n.id);
      }
    });
    const seenEdges = new Set<string>();
    const renderedEdges: GraphEdge[] = [];
    filteredEdges.forEach((e) => {
      const sourceId = idToRenderedId.get(e.source);
      const targetId = idToRenderedId.get(e.target);
      if (sourceId && targetId && sourceId !== targetId) {
        const key = `${sourceId}-${targetId}`;
        if (!seenEdges.has(key)) {
          seenEdges.add(key);
          renderedEdges.push({ ...e, source: sourceId, target: targetId });
        }
      }
    });
    return renderedEdges;
  }, [filteredEdges, clusteredNodes]);

  const handleMaximizeNode = useCallback(
    (id: string) => {
      setActiveSidePanes((prev) => {
        const existing = prev.find((p) => p.type === "node" && p.data === id);
        if (existing) return prev.filter((p) => p.id !== existing.id);
        return [
          ...prev,
          {
            id: crypto.randomUUID(),
            type: "node",
            data: id,
            initialDockPosition: "right",
          },
        ];
      });
    },
    [setActiveSidePanes]
  );

  const handleOpenLink = useCallback(
    (url: string) => {
      const isWikipedia = url.includes("wikipedia.org/wiki/");
      if (isWikipedia) {
        setActiveSidePanes((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            type: "web",
            data: url,
            initialDockPosition: "left",
            initialWidthPercent: 33,
          },
        ]);
      } else {
        setActiveSidePanes((prev) => {
          const existing = prev.find(
            (p) => p.type === "web" && p.initialDockPosition !== "left"
          );
          if (existing)
            return prev.map((p) =>
              p.id === existing.id ? { ...p, data: url } : p
            );
          return [
            ...prev,
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
    },
    [setActiveSidePanes]
  );

  const handleNavigateToNodeLink = useCallback(
    (rawTitle: string) => {
      const normalize = (v?: string | null) => v?.trim().toLowerCase() || "";
      const target = normalize(rawTitle);
      if (!target) return;
      const matchedNode = nodes.find(
        (n) =>
          normalize(n.content) === target ||
          normalize(n.summary) === target ||
          n.aliases?.some((a) => normalize(a) === target)
      );
      if (!matchedNode) return;
      setCurrentScopeId(matchedNode.parentId ?? null);
      setSelectedNodeIds(new Set([matchedNode.id]));
      const k = viewTransform.k;
      const nodeCenterX =
        matchedNode.x + (matchedNode.width || DEFAULT_NODE_WIDTH) / 2;
      const nodeCenterY =
        matchedNode.y + (matchedNode.height || DEFAULT_NODE_HEIGHT) / 2;
      setViewTransform({
        x: window.innerWidth / 2 - nodeCenterX * k,
        y: window.innerHeight / 2 - nodeCenterY * k,
        k,
      });
    },
    [
      nodes,
      viewTransform.k,
      setCurrentScopeId,
      setSelectedNodeIds,
      setViewTransform,
    ]
  );

  const getSidePanelContent = useCallback(
    (pane: any) => {
      const node =
        pane.type === "node" ? nodes.find((n) => n.id === pane.data) : null;
      return (
        <ErrorBoundary>
          {pane.type === "web" ? (
            <WebContent
              url={pane.data}
              onClose={() => handleCloseSidePane(pane.id)}
              onWikipediaLinkClick={handleOpenLink}
            />
          ) : node ? (
            <GraphNodeComponent
              node={node}
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
      aiProvider,
    ]
  );

  const sidePanels = useMemo(
    () =>
      activeSidePanes.map((p) => (
        <SidePanel
          key={p.id}
          id={p.id}
          onClose={handleCloseSidePane}
          initialWidthPercent={p.initialWidthPercent}
          initialDockPosition={p.initialDockPosition}
          hideDefaultDragHandle={p.type === "node"}
          onLayoutChange={handleSidePanelLayoutChange}
        >
          {getSidePanelContent(p)}
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
        <HeaderActions
          user={user}
          onLogin={() => {
            setAuthMode("login");
            setShowAuth(true);
          }}
          onSignup={() => {
            setAuthMode("signup");
            setShowAuth(true);
          }}
          onShowProfile={() => setShowProfile(true)}
          onToggleSearch={() => setIsSearchOpen((p) => !p)}
          onOpenStorage={handleOpenStorage}
          dirName={dirName}
          activeSidePanesCount={activeSidePanes.length}
        />

        <div className="absolute top-4 text-slate-500 text-xs font-mono opacity-50 pointer-events-none select-none">
          {isMigrating ? "Saving your work..." : dirName ||
            (user ? "Cloud Storage Active" : storageMode === 'memory' ? "In-Memory (Sign in to save)" : "Local Storage (Not Saved)")}
        </div>

        <Breadcrumbs
          breadcrumbs={breadcrumbs}
          selectedNodeIds={selectedNodeIds}
          onNavigate={(id, type) => {
            if (type === "node" && id) handleFocusNode(id);
            else {
              setCurrentScopeId(id);
              setSelectedNodeIds(new Set());
            }
          }}
          onCloseFolder={handleCloseFolder}
          onImportFromCloud={handleImportFromCloud}
          dirName={dirName}
          isLoggedIn={!!user}
        />

        <ScopeIndicator currentScopeId={currentScopeId} nodes={nodes} />

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

        {usageNotification.visible && (
          <div className="absolute bottom-4 right-4 z-50 bg-slate-800 border border-sky-500 text-sky-400 px-4 py-3 rounded shadow-lg animate-bounce">
            <p className="text-sm font-bold">{usageNotification.message}</p>
            <button
              onClick={() =>
                setUsageNotification((p) => ({ ...p, visible: false }))
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
            edges={edgesToRender}
            setNodes={setNodesCallback}
            setEdges={setEdgesCallback}
            viewTransform={viewTransform}
            onViewTransformChange={setViewTransform}
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
            onConnectStart={(id) => setConnectingNodeId(id)}
            onConnectEnd={(s, t) => {
              handleConnectEnd(s, t);
              setConnectingNodeId(null);
            }}
            onCancelConnect={() => setConnectingNodeId(null)}
            onNavigateDown={handleNavigateDown}
            onNavigateUp={handleNavigateUp}
            currentScopeId={currentScopeId}
            autoGraphEnabled={autoGraphEnabled}
            onSetAutoGraphEnabled={setAutoGraphEnabled}
            selectedNodeIds={selectedNodeIds}
            onNodeSelect={(id, multi) => {
              if (id === null) {
                setSelectedNodeIds(new Set());
              } else if (multi === 'remove') {
                // Remove this specific node from selection (for minimize)
                setSelectedNodeIds((prev) => {
                  const newSet = new Set(prev);
                  newSet.delete(id);
                  return newSet;
                });
              } else if (multi) {
                // Add to existing selection without clearing others
                setSelectedNodeIds((prev) => new Set([...prev, id]));
              } else {
                setSelectedNodeIds(new Set([id]));
              }
            }}
            canvasShiftX={canvasShiftX}
            canvasShiftY={canvasShiftY}
            isResizing={isAnyPanelResizing}
            onSelectionTooltipChange={setSelectionTooltip}
            cutNodeId={cutNodeId}
            setCutNodeId={setCutNodeId}
            aiProvider={aiProvider}
            // Physics simulation props
            isSimulating={isSimulating}
            startSimulation={startSimulation}
            stopSimulation={stopSimulation}
            physicsStartDrag={physicsStartDrag}
            physicsUpdateDrag={physicsUpdateDrag}
            physicsEndDrag={physicsEndDrag}
            pinNode={pinNode}
            unpinNode={unpinNode}
            togglePinNode={togglePinNode}
            onToggleOutlinePanel={() => setIsOutlinePanelOpen((prev) => !prev)}
            isOutlinePanelOpen={isOutlinePanelOpen}
          />
        </ErrorBoundary>
      </div>

      {sidePanels}

      <OutlineTreePanel
        isOpen={isOutlinePanelOpen}
        onClose={() => setIsOutlinePanelOpen(false)}
        nodes={nodes}
        selectedNodeIds={selectedNodeIds}
        currentScopeId={currentScopeId}
        onFocusNode={handleFocusNode}
      />

      {selectionTooltip && !connectingNodeId && (
        <SelectionTooltip
          tooltip={selectionTooltip}
          onClose={() => setSelectionTooltip(null)}
          onCreateNote={() =>
            handleCreateFromSelection(NodeType.NOTE, selectionTooltip)
          }
          onCreateChat={() =>
            handleCreateFromSelection(NodeType.CHAT, selectionTooltip)
          }
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
              /* Logic remains in App for now */
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
              onLogin={async (u) => {
                // Use the login function from AuthContext
                login(u);
                setShowAuth(false);
                // Migration of in-memory data is handled by StorageContext
                // which watches for auth state changes
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
            onSetAiProvider={setAiProvider}
            onClose={() => setShowProfile(false)}
            onUpdateUser={(upd) =>
              setUser((p: any) => (p ? { ...p, ...upd } : null))
            }
            onLogout={handleLogout}
            storageConnected={!!dirHandle}
            storageDirName={dirName}
            onOpenStorage={handleOpenStorage}
            onStartMigration={handleStartMigration}
            migrationProgress={migrationProgress}
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
        onClose={() => setToast((p) => ({ ...p, visible: false }))}
      />

      {/* Physics Settings Panel */}
      <PhysicsSettingsPanel
        config={physicsConfig}
        onConfigChange={setPhysicsConfig}
        isSimulating={isSimulating}
        onStopSimulation={stopSimulation}
      />

      {/* Migration Progress Bar */}
      {migrationProgress?.isRunning && (
        <MigrationProgressBar
          progress={migrationProgress}
          onCancel={handleCancelMigration}
        />
      )}
    </div>
  );
};

export default App;
