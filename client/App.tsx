import React, {
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { useAuth } from "./context/AuthContext";
import { useStorage } from "./context/StorageContext";
import { useSelector, useDispatch } from "./hooks/useAppStore";
import { Canvas } from "./components/Canvas";
import { SidePanel, WebContent } from "./components/SidePanel";
import { GraphNodeComponent } from "./components/GraphNode";
import { SearchBar } from "./components/SearchBar";
import { AuthPage } from "./components/AuthPage";
import { LimitModal } from "./components/LimitModal";
import { UpgradeModal } from "./components/UpgradeModal";
import { DuplicateWarningModal } from "./components/DuplicateWarningModal";
import { ProfilePage } from "./components/ProfilePage";
import { Toast } from "./components/Toast";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { SelectionTooltip } from "./components/SelectionTooltip";
import { Breadcrumbs } from "./components/Breadcrumbs";
import { HeaderActions } from "./components/HeaderActions";
import { ScopeIndicator } from "./components/ScopeIndicator";
import { OutlineTreePanel } from "./components/OutlineTreePanel";
import { ChatModeContainer, ChatModeSidebar } from "./components/ChatMode";
import { MigrationProgressBar } from "./components/MigrationProgressBar";
import { getMigrationService } from "./services/migration/MigrationService";
import {
  GraphEdge,
  GraphNode,
  NodeType,
  ViewportTransform,
} from "./types";
import {
  DEFAULT_NODE_HEIGHT,
  DEFAULT_NODE_WIDTH,
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
  getLastDirName,
  setLastDirName,
  cleanupLegacyStorage,
} from "./services/settingsService";
import { importFromCloud } from "./services/cloudSyncService";
import { useViewportStorage, USE_VIEWPORT_STORAGE } from "./hooks/useViewportStorage";
import { useExpansion } from "./hooks/useExpansion";
import { useNavigation } from "./hooks/useNavigation";
import { useGraphOperations } from "./hooks/useGraphOperations";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useBreadcrumbs } from "./hooks/useBreadcrumbs";
import { usePhysicsSimulation } from "./hooks/usePhysicsSimulation";
import { useViewportNodes } from "./hooks/useViewportNodes";
import { createDefaultGraphNodes } from "./utils/graphUtils";
import { performGreedyClustering } from "./utils/clustering";

const App: React.FC = () => {
  const dispatch = useDispatch();

  // --- Read state from store ---
  const nodes = useSelector((s) => s.nodes);
  const edges = useSelector((s) => s.edges);
  const currentScopeId = useSelector((s) => s.currentScopeId);
  const selectedNodeIds = useSelector((s) => s.selectedNodeIds);
  const viewTransform = useSelector((s) => s.viewTransform);
  const viewMode = useSelector((s) => s.viewMode);
  const connectingNodeId = useSelector((s) => s.connectingNodeId);
  const selectionTooltip = useSelector((s) => s.selectionTooltip);
  const toast = useSelector((s) => s.toast);
  const searchExpanded = useSelector((s) => s.searchExpanded);
  const isOutlinePanelOpen = useSelector((s) => s.isOutlinePanelOpen);
  const canvasShiftX = useSelector((s) => s.canvasShiftX);
  const canvasShiftY = useSelector((s) => s.canvasShiftY);
  const windowSize = useSelector((s) => s.windowSize);
  const autoGraphEnabled = useSelector((s) => s.autoGraphEnabled);
  const aiProvider = useSelector((s) => s.aiProvider);
  const physicsConfig = useSelector((s) => s.physicsConfig);
  const selectionHistory = useSelector((s) => s.selectionHistory);
  const showAuth = useSelector((s) => s.showAuth);
  const authMode = useSelector((s) => s.authMode);
  const showProfile = useSelector((s) => s.showProfile);
  const showLimitModal = useSelector((s) => s.showLimitModal);
  const showUpgradeModal = useSelector((s) => s.showUpgradeModal);
  const usageNotification = useSelector((s) => s.usageNotification);
  const cutNodeId = useSelector((s) => s.cutNodeId);
  const migrationProgress = useSelector((s) => s.migrationProgress);
  const dirHandle = useSelector((s) => s.dirHandle);
  const dirName = useSelector((s) => s.dirName);
  const user = useSelector((s) => s.user);
  const authLoading = useSelector((s) => s.authLoading);
  const activeSidePanes = useSelector((s) => s.activeSidePanes);
  const sidePanelLayouts = useSelector((s) => s.sidePanelLayouts);

  // --- Auth & Storage from Context (for service functions only) ---
  const { login, logout } = useAuth();
  const { storageMode, isMigrating, initializeInMemory, restoreLastDeletedNode, getDeletionStackSize } = useStorage();

  // --- Thin setter wrappers for hooks that still expect individual setters ---
  const setNodes = useCallback(
    (v: GraphNode[] | ((prev: GraphNode[]) => GraphNode[])) => {
      // For functional updates, we need to resolve against current state
      // Hooks pass functional updates, so we handle both cases
      if (typeof v === 'function') {
        // We need the current nodes to resolve the updater
        // This is a bit of a hack but necessary for backward compat with hooks
        dispatch({ type: 'NODES_SET', nodes: v(nodes) });
      } else {
        dispatch({ type: 'NODES_SET', nodes: v });
      }
    },
    [dispatch, nodes]
  );

  const setEdges = useCallback(
    (v: GraphEdge[] | ((prev: GraphEdge[]) => GraphEdge[])) => {
      if (typeof v === 'function') {
        dispatch({ type: 'EDGES_SET', edges: v(edges) });
      } else {
        dispatch({ type: 'EDGES_SET', edges: v });
      }
    },
    [dispatch, edges]
  );

  const setCurrentScopeId = useCallback(
    (id: string | null) => dispatch({ type: 'SCOPE_SET', scopeId: id }),
    [dispatch]
  );

  const setSelectedNodeIds = useCallback(
    (ids: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      if (typeof ids === 'function') {
        dispatch({ type: 'SELECTION_SET', ids: ids(selectedNodeIds) });
      } else {
        dispatch({ type: 'SELECTION_SET', ids });
      }
    },
    [dispatch, selectedNodeIds]
  );

  const setViewTransform = useCallback(
    (t: ViewportTransform) => dispatch({ type: 'VIEW_TRANSFORM_SET', transform: t }),
    [dispatch]
  );

  const setToast = useCallback(
    (t: { visible: boolean; message: string; action?: () => void }) => {
      if (t.visible) {
        dispatch({ type: 'TOAST_SHOW', message: t.message, action: t.action });
      } else {
        dispatch({ type: 'TOAST_HIDE' });
      }
    },
    [dispatch]
  );

  const setCutNodeId = useCallback(
    (id: string | null) => dispatch({ type: 'CUT_NODE_SET', id }),
    [dispatch]
  );

  const setAutoGraphEnabled = useCallback(
    (enabled: boolean) => dispatch({ type: 'AUTO_GRAPH_SET', enabled }),
    [dispatch]
  );

  const setShowLimitModal = useCallback(
    (show: boolean) => dispatch(show ? { type: 'MODAL_LIMIT_SHOW' } : { type: 'MODAL_LIMIT_HIDE' }),
    [dispatch]
  );

  const setUser = useCallback(
    (v: any) => {
      if (typeof v === 'function') {
        dispatch({ type: 'AUTH_USER_SET', user: v(user) });
      } else {
        dispatch({ type: 'AUTH_USER_SET', user: v });
      }
    },
    [dispatch, user]
  );

  const setIsGraphLoaded = useCallback(
    (loaded: boolean) => dispatch({ type: 'GRAPH_LOADED_SET', loaded }),
    [dispatch]
  );

  const setDirHandle = useCallback(
    (h: FileSystemDirectoryHandle | null) => dispatch({ type: 'STORAGE_DIR_HANDLE_SET', handle: h }),
    [dispatch]
  );

  const setDirName = useCallback(
    (n: string | null) => dispatch({ type: 'STORAGE_DIR_NAME_SET', name: n }),
    [dispatch]
  );

  const setMigrationProgress = useCallback(
    (p: any) => dispatch({ type: 'MIGRATION_PROGRESS_SET', progress: p }),
    [dispatch]
  );

  const setActiveSidePanes = useCallback(
    (v: any) => {
      if (typeof v === 'function') {
        dispatch({ type: 'SIDE_PANES_SET', panes: v(activeSidePanes) });
      } else {
        dispatch({ type: 'SIDE_PANES_SET', panes: v });
      }
    },
    [dispatch, activeSidePanes]
  );

  const deletedNodeRef = useRef<{
    nodes: GraphNode[];
    edges: GraphEdge[];
    timer: number | null;
  } | null>(null);

  // Ref to expose chat mode's focusNode for search bar navigation
  const chatModeFocusRef = useRef<((nodeId: string) => void) | null>(null);

  // --- Viewport-Based Storage (Two-Phase Loading) ---
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

  // --- Viewport Nodes for Outline Panel ---
  const { viewportNodeIds, hasViewportNodes } = useViewportNodes({
    nodes,
    viewTransform,
    containerWidth: windowSize.width,
    containerHeight: windowSize.height,
    debounceMs: 200,
  });

  // Sync viewportStorage state to main state continuously
  useEffect(() => {
    if (USE_VIEWPORT_STORAGE && viewportStorage.isInitialized && dirHandle) {
      if (viewportStorage.nodes.length > 0) {
        dispatch({ type: 'NODES_SET', nodes: viewportStorage.nodes });
      }
      if (viewportStorage.edges.length > 0) {
        dispatch({ type: 'EDGES_SET', edges: viewportStorage.edges });
      }
    }
  }, [viewportStorage.isInitialized, viewportStorage.nodes, viewportStorage.edges, dirHandle, dispatch]);

  const setNodesCallback = useCallback(
    (newNodes: GraphNode[] | ((prev: GraphNode[]) => GraphNode[])) => {
      const resolvedNodes =
        typeof newNodes === "function" ? newNodes(nodes) : newNodes;
      const uniqueNodes = Array.from(
        new Map(resolvedNodes.map((n) => [n.id, n])).values()
      );

      const prevById = new Map(nodes.map((n) => [n.id, n]));
      for (const n of uniqueNodes) {
        const p = prevById.get(n.id);
        if (!p || p !== n) {
          const semanticChanged =
            !p ||
            p.content !== n.content ||
            p.summary !== n.summary ||
            JSON.stringify(p.aliases || []) !==
              JSON.stringify(n.aliases || []);

          if (USE_VIEWPORT_STORAGE && viewportStorage.isInitialized) {
            if (!p) {
              viewportStorage.addNode(n, !semanticChanged);
            } else {
              viewportStorage.updateNode(n, !semanticChanged);
            }
          }
        }
      }

      dispatch({ type: 'NODES_SET', nodes: uniqueNodes });
    },
    [
      nodes,
      dispatch,
      viewportStorage,
    ]
  );

  const setEdgesCallback = useCallback(
    (newEdges: GraphEdge[] | ((prev: GraphEdge[]) => GraphEdge[])) => {
      const resolvedEdges =
        typeof newEdges === "function" ? newEdges(edges) : newEdges;

      if (USE_VIEWPORT_STORAGE && viewportStorage.isInitialized) {
        viewportStorage.updateEdges(resolvedEdges);
      }

      dispatch({ type: 'EDGES_SET', edges: resolvedEdges });
    },
    [
      edges,
      dispatch,
      viewportStorage,
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
  } = usePhysicsSimulation(nodes, edges, setNodesCallback as any, { config: physicsConfig });

  // --- Expansion ---
  const {
    expandingNodeIds,
    handleExpandNode,
    handleExpandNodeFromWikidata,
    pendingExpansion,
    handleCreateAllAnyway,
    handleLinkToExisting,
    handleCancelExpansion,
  } = useExpansion(
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
  const isAnyPanelResizing = useMemo(
    () => Object.values(sidePanelLayouts).some((l) => l.isResizing),
    [sidePanelLayouts]
  );

  const handleCloseSidePane = useCallback((id: string) => {
    dispatch({ type: 'SIDE_PANE_REMOVE', id });
  }, [dispatch]);

  const handleSidePanelLayoutChange = useCallback((id: string, layout: any) => {
    dispatch({ type: 'SIDE_PANEL_LAYOUT_SET', id, layout });
  }, [dispatch]);

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
    setSelectedNodeIds as any,
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
    startSimulation,
    USE_VIEWPORT_STORAGE && dirHandle ? viewportStorage.deleteNode : undefined,
    USE_VIEWPORT_STORAGE && dirHandle ? viewportStorage.removeNodesFromState : undefined,
    USE_VIEWPORT_STORAGE && dirHandle ? viewportStorage.restoreNodesToState : undefined
  );

  // --- Navigation ---
  const { handleNavigateDown, handleNavigateUp, handleFocusNode } =
    useNavigation(
      nodes,
      currentScopeId,
      setCurrentScopeId,
      setSelectedNodeIds as any,
      viewTransform,
      setViewTransform,
      setNodes as any,
      setEdges as any,
      user,
      dirName
    );

  // Wrapper for search bar navigation - also navigates in chat mode
  const handleSearchNavigate = useCallback((nodeId: string) => {
    handleFocusNode(nodeId);
    if (viewMode === 'chat' && chatModeFocusRef.current) {
      chatModeFocusRef.current(nodeId);
    }
  }, [viewMode, handleFocusNode]);

  // --- Keyboard Shortcuts ---
  const handleRestoreFromDeletionStack = useCallback(async () => {
    const entry = await restoreLastDeletedNode();
    if (entry) {
      dispatch({ type: 'RESTORE_NODES', nodes: [entry.node], edges: entry.edges });
      dispatch({ type: 'TOAST_SHOW', message: "Node restored" });
    }
  }, [restoreLastDeletedNode, dispatch]);

  useKeyboardShortcuts(
    selectedNodeIds,
    confirmDeleteNode,
    handleCut,
    handlePaste,
    viewTransform,
    toast.visible,
    toast.action,
    getDeletionStackSize(),
    handleRestoreFromDeletionStack
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
    if (Math.abs(totalXShift - canvasShiftX) > 1 || Math.abs(totalYShift - canvasShiftY) > 1) {
      dispatch({ type: 'CANVAS_SHIFT_SET', x: totalXShift, y: totalYShift });
    }
  }, [sidePanelLayouts, canvasShiftX, canvasShiftY, dispatch]);

  // --- Storage & Sync Logic ---
  useEffect(() => {
    const initializeApp = async () => {
      if (authLoading) return;

      cleanupLegacyStorage();

      try {
        const storedHandle = await getDirectoryHandle();

        if (storedHandle) {
          const hasPermission = await verifyPermission(storedHandle, true);

          if (hasPermission) {
            dispatch({ type: 'STORAGE_DIR_HANDLE_SET', handle: storedHandle });
            dispatch({ type: 'STORAGE_DIR_NAME_SET', name: storedHandle.name });
            setLastDirName(storedHandle.name);

            const { nodes: loadedNodes, edges: loadedEdges, hasLegacyEdgesFile } =
              await loadGraphFromDirectory(storedHandle);

            if (loadedNodes.length > 0) {
              dispatch({ type: 'NODES_SET', nodes: loadedNodes });
              dispatch({ type: 'EDGES_SET', edges: loadedEdges });

              if (hasLegacyEdgesFile) {
                await migrateEdgesToNodes(storedHandle, loadedNodes, loadedEdges);
              }
            }
          } else {
            const lastDir = getLastDirName();
            if (lastDir) {
              dispatch({ type: 'STORAGE_DIR_NAME_SET', name: `${lastDir} (click to reopen)` });
            }
          }
        }

        if (user) {
          if (!storedHandle) {
            dispatch({ type: 'STORAGE_DIR_NAME_SET', name: "Cloud Storage" });
          }
        } else {
          await initializeInMemory();
        }

        dispatch({ type: 'GRAPH_LOADED_SET', loaded: true });
      } catch (err) {
        console.error("App initialization failed", err);
        dispatch({ type: 'GRAPH_LOADED_SET', loaded: true });
      }
    };

    initializeApp();
  }, [authLoading, user, initializeInMemory, dispatch]);

  const handleLogout = async () => {
    try {
      await logout();
      dispatch({ type: 'LOGOUT' });
      await initializeInMemory();
    } catch (err) {
      console.error("Logout failed", err);
    }
  };

  const handleOpenStorage = useCallback(async () => {
    const handle = await pickDirectory();
    if (handle) {
      await storeDirectoryHandle(handle);
      dispatch({ type: 'STORAGE_DIR_HANDLE_SET', handle });
      dispatch({ type: 'STORAGE_DIR_NAME_SET', name: handle.name });
      setLastDirName(handle.name);

      try {
        const { nodes: loadedNodes, edges: loadedEdges, hasLegacyEdgesFile } =
          await loadGraphFromDirectory(handle);

        if (loadedNodes.length > 0) {
          dispatch({ type: 'NODES_SET', nodes: loadedNodes });
          dispatch({ type: 'EDGES_SET', edges: loadedEdges });

          if (hasLegacyEdgesFile) {
            console.log("Migrating edges to node files...");
            await migrateEdgesToNodes(handle, loadedNodes, loadedEdges);
          }
        } else if (nodes.length > 0) {
          for (const node of nodes) {
            const outgoingEdges = getOutgoingEdges(node.id, edges);
            await saveNodeToFile(handle, node, outgoingEdges);
          }
        }

        cleanupLegacyStorage();
        dispatch({ type: 'GRAPH_LOADED_SET', loaded: true });
      } catch (e) {
        console.error("Error loading from directory", e);
        dispatch({ type: 'GRAPH_LOADED_SET', loaded: true });
        alert("Failed to load graph from directory.");
      }
    }
  }, [nodes, edges, dispatch]);

  // Handle schema migration
  const handleStartMigration = useCallback(async () => {
    if (!dirHandle) return;

    const migrationService = getMigrationService();

    const lastTimestamp = migrationService.getLastMigrationTimestamp();
    if (lastTimestamp) {
      dispatch({
        type: 'MIGRATION_PROGRESS_SET',
        progress: {
          isRunning: false,
          totalNodes: 0,
          processedNodes: 0,
          nodesNeedingUpdates: 0,
          currentStatus: 'Idle',
          lastMigrationTimestamp: lastTimestamp,
          errors: [],
        },
      });
    }

    try {
      await migrationService.runMigration(
        async (nodeId: string) => {
          const node = nodes.find((n) => n.id === nodeId);
          if (!node) return null;
          const outgoingEdges = edges.filter((e) => e.source === nodeId);
          return {
            ...node,
            edges: outgoingEdges.map((e) => ({ id: e.id, target: e.target, label: e.label })),
          };
        },
        async (node: GraphNode) => {
          dispatch({ type: 'NODE_UPDATE', id: node.id, updates: node });
          if (dirHandle) {
            const outgoingEdges = getOutgoingEdges(node.id, edges);
            await saveNodeToFile(dirHandle, node, outgoingEdges);
          }
        },
        () => nodes.map((n) => n.id),
        (progress) => dispatch({ type: 'MIGRATION_PROGRESS_SET', progress })
      );
    } catch (e) {
      console.error('Migration failed:', e);
    }
  }, [dirHandle, nodes, edges, dispatch]);

  const handleCancelMigration = useCallback(() => {
    const migrationService = getMigrationService();
    migrationService.cancel();
  }, []);

  // Import graph from cloud storage
  const handleImportFromCloud = useCallback(async () => {
    if (!user) return;

    const cloudData = await importFromCloud();
    if (cloudData && (cloudData.nodes.length > 0 || cloudData.edges.length > 0)) {
      dispatch({ type: 'GRAPH_LOAD_FROM_STORAGE', nodes: cloudData.nodes, edges: cloudData.edges });

      if (dirHandle) {
        for (const node of cloudData.nodes) {
          const outgoingEdges = getOutgoingEdges(node.id, cloudData.edges);
          await saveNodeToFile(dirHandle, node, outgoingEdges);
        }
      }

      dispatch({ type: 'TOAST_SHOW', message: "Imported from cloud successfully" });
    } else {
      dispatch({ type: 'TOAST_SHOW', message: "No data found in cloud storage" });
    }
  }, [user, dirHandle, dispatch]);

  const handleCloseFolder = useCallback(async () => {
    if ((user as any)?.isPaid) {
      dispatch({ type: 'STORAGE_DIR_NAME_SET', name: null });
      dispatch({ type: 'NODES_SET', nodes: createDefaultGraphNodes() });
      dispatch({ type: 'EDGES_SET', edges: [] });
      return;
    }
    if (user?.storagePath) {
      try {
        await updateUserSettings("");
        dispatch({ type: 'AUTH_USER_UPDATE', updates: { storagePath: undefined } });
      } catch (e) {
        console.error("Failed to clear user settings", e);
      }
    }
    dispatch({ type: 'STORAGE_DIR_HANDLE_SET', handle: null });
    dispatch({ type: 'STORAGE_DIR_NAME_SET', name: null });
    dispatch({ type: 'NODES_SET', nodes: createDefaultGraphNodes() });
    dispatch({ type: 'EDGES_SET', edges: [] });
    window.location.reload();
  }, [user, dispatch]);

  // --- Clustering and Filtering for Rendering ---
  const filteredNodes = useMemo(
    () =>
      nodes.filter((n) => (n.scopeId ?? null) === (currentScopeId ?? null)),
    [nodes, currentScopeId]
  );

  const clusteredNodes = useMemo(() => {
    return performGreedyClustering(filteredNodes, edges, viewTransform.k);
  }, [filteredNodes, edges, viewTransform.k]);

  const visibleNodeIds = useMemo(() => {
    const ids = new Set<string>();
    clusteredNodes.forEach((n) => ids.add(n.id));
    return ids;
  }, [clusteredNodes]);

  const filteredEdges = useMemo(
    () =>
      edges.filter((e) => {
        if ((e.scopeId ?? null) !== (currentScopeId ?? null)) return false;
        const sourceVisible = visibleNodeIds.has(e.source);
        const targetVisible = visibleNodeIds.has(e.target);
        return sourceVisible && targetVisible;
      }),
    [edges, currentScopeId, visibleNodeIds]
  );

  const edgesToRender = useMemo(() => {
    return filteredEdges;
  }, [filteredEdges]);

  const handleMaximizeNode = useCallback(
    (id: string) => {
      const existing = activeSidePanes.find((p) => p.type === "node" && p.data === id);
      if (existing) {
        dispatch({ type: 'SIDE_PANE_REMOVE', id: existing.id });
      } else {
        dispatch({
          type: 'SIDE_PANE_ADD',
          pane: {
            id: crypto.randomUUID(),
            type: "node",
            data: id,
            initialDockPosition: "right",
          },
        });
      }
    },
    [activeSidePanes, dispatch]
  );

  // Toggle between graph and chat modes
  const handleToggleViewMode = useCallback(() => {
    dispatch({ type: 'VIEW_MODE_TOGGLE' });
  }, [dispatch]);

  // Sync chat mode selection to main state
  const handleChatModeSelectionChange = useCallback((nodeId: string | null) => {
    if (nodeId) {
      dispatch({ type: 'SELECTION_SET', ids: new Set([nodeId]) });
      dispatch({ type: 'SELECTION_HISTORY_PUSH', id: nodeId });
    }
  }, [dispatch]);

  // Create node for chat mode - returns the created node
  const handleCreateNodeForChatMode = useCallback(
    (parentId: string | null, type: NodeType, content?: string): GraphNode => {
      const id = crypto.randomUUID();
      const newNode: GraphNode = {
        id,
        type,
        x: 0,
        y: 0,
        content: content || '',
        parentId: parentId,
        scopeId: currentScopeId,
      };

      setNodesCallback((prev) => [...prev, newNode]);
      dispatch({ type: 'SELECTION_SET', ids: new Set([id]) });

      return newNode;
    },
    [currentScopeId, setNodesCallback, dispatch]
  );

  const handleOpenLink = useCallback(
    (url: string) => {
      const isWikipedia = url.includes("wikipedia.org/wiki/");
      if (isWikipedia) {
        dispatch({
          type: 'SIDE_PANE_ADD',
          pane: {
            id: crypto.randomUUID(),
            type: "web",
            data: url,
            initialDockPosition: "left",
            initialWidthPercent: 33,
          },
        });
      } else {
        const existing = activeSidePanes.find(
          (p) => p.type === "web" && p.initialDockPosition !== "left"
        );
        if (existing) {
          dispatch({ type: 'SIDE_PANE_UPDATE', id: existing.id, updates: { data: url } });
        } else {
          dispatch({
            type: 'SIDE_PANE_ADD',
            pane: {
              id: crypto.randomUUID(),
              type: "web",
              data: url,
              initialDockPosition: "right",
              initialWidthPercent: 33,
            },
          });
        }
      }
    },
    [activeSidePanes, dispatch]
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
      dispatch({ type: 'SCOPE_SET', scopeId: matchedNode.scopeId ?? null });
      dispatch({ type: 'SELECTION_SET', ids: new Set([matchedNode.id]) });
      const k = viewTransform.k;
      const nodeCenterX =
        matchedNode.x + (matchedNode.width || DEFAULT_NODE_WIDTH) / 2;
      const nodeCenterY =
        matchedNode.y + (matchedNode.height || DEFAULT_NODE_HEIGHT) / 2;
      dispatch({
        type: 'VIEW_TRANSFORM_SET',
        transform: {
          x: window.innerWidth / 2 - nodeCenterX * k,
          y: window.innerHeight / 2 - nodeCenterY * k,
          k,
        },
      });
    },
    [nodes, viewTransform.k, dispatch]
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
        {!user && (
          <HeaderActions
            user={user}
            onLogin={() => dispatch({ type: 'MODAL_AUTH_SHOW', mode: 'login' })}
            onSignup={() => dispatch({ type: 'MODAL_AUTH_SHOW', mode: 'signup' })}
            onShowProfile={() => dispatch({ type: 'MODAL_PROFILE_SHOW' })}
            activeSidePanesCount={activeSidePanes.length}
            searchExpanded={searchExpanded}
            onSearchExpandedChange={(v: boolean) => dispatch({ type: 'SEARCH_EXPANDED_SET', expanded: v })}
          />
        )}

        <button
          onClick={handleToggleViewMode}
          className={`absolute top-4 right-4 z-[60] p-2 rounded-lg border transition-all shadow-lg bg-slate-800/80 backdrop-blur text-slate-400 hover:text-white border-slate-700 ${
            activeSidePanes.length > 0 ? "opacity-0 invisible" : "opacity-100 visible"
          }`}
          title={viewMode === 'chat' ? 'Switch to Graph View' : 'Switch to Chat View'}
        >
          {viewMode === 'chat' ? (
            <svg className="h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {/* Asymmetric graph: large root with two different-sized children */}
              {/* Root node (large) */}
              <circle cx="7" cy="12" r="3.5" />
              {/* Child at 60° (medium) */}
              <circle cx="16" cy="5" r="2.5" />
              {/* Child at -30° (small) */}
              <circle cx="18" cy="17" r="2" />
              {/* Edge to 60° child */}
              <line x1="10" y1="10" x2="14" y2="6.5" />
              {/* Edge to -30° child */}
              <line x1="10" y1="14" x2="16.5" y2="16" />
            </svg>
          ) : (
            <svg className="h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {/* Speech bubble with two lines */}
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              <line x1="7" y1="8" x2="17" y2="8" />
              <line x1="7" y1="12" x2="13" y2="12" />
            </svg>
          )}
        </button>

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
              dispatch({ type: 'SCOPE_SET', scopeId: id });
              dispatch({ type: 'SELECTION_CLEAR' });
            }
          }}
          onCloseFolder={handleCloseFolder}
          onImportFromCloud={handleImportFromCloud}
          dirName={dirName}
          isLoggedIn={!!user}
        />

        <ScopeIndicator currentScopeId={currentScopeId} nodes={nodes} />

        <SearchBar
          nodes={nodes}
          onSelect={handleSearchSelect}
          onNavigate={handleSearchNavigate}
          onPreview={handleOpenLink}
          isCloud={!!user}
          isExpanded={searchExpanded}
          onExpandedChange={(v: boolean) => dispatch({ type: 'SEARCH_EXPANDED_SET', expanded: v })}
        />

        {usageNotification.visible && (
          <div className="absolute bottom-4 right-4 z-50 bg-slate-800 border border-sky-500 text-sky-400 px-4 py-3 rounded shadow-lg animate-bounce">
            <p className="text-sm font-bold">{usageNotification.message}</p>
            <button
              onClick={() => dispatch({ type: 'USAGE_NOTIFICATION_HIDE' })}
              className="absolute top-1 right-1 text-xs text-slate-500 hover:text-white"
            >
              ✕
            </button>
          </div>
        )}

        {viewMode === 'graph' ? (
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
              onToggleMenu={() => dispatch({ type: 'OUTLINE_PANEL_TOGGLE' })}
              connectingNodeId={connectingNodeId}
              onConnectStart={(id) => dispatch({ type: 'CONNECTING_NODE_SET', id })}
              onConnectEnd={(s, t) => {
                handleConnectEnd(s, t);
                dispatch({ type: 'CONNECTING_NODE_SET', id: null });
              }}
              onCancelConnect={() => dispatch({ type: 'CONNECTING_NODE_SET', id: null })}
              onNavigateDown={handleNavigateDown}
              onNavigateUp={handleNavigateUp}
              currentScopeId={currentScopeId}
              autoGraphEnabled={autoGraphEnabled}
              onSetAutoGraphEnabled={setAutoGraphEnabled}
              selectedNodeIds={selectedNodeIds}
              selectionHistory={selectionHistory}
              onNodeSelect={(id, multi) => {
                if (id === null) {
                  dispatch({ type: 'SELECTION_CLEAR' });
                } else if (multi === 'remove') {
                  dispatch({ type: 'SELECTION_REMOVE', id });
                } else if (multi) {
                  dispatch({ type: 'SELECTION_ADD', id });
                  dispatch({ type: 'SELECTION_HISTORY_PUSH', id });
                } else {
                  dispatch({ type: 'SELECTION_SET', ids: new Set([id]) });
                  dispatch({ type: 'SELECTION_HISTORY_PUSH', id });
                }
              }}
              canvasShiftX={canvasShiftX}
              canvasShiftY={canvasShiftY}
              isResizing={isAnyPanelResizing}
              onSelectionTooltipChange={(t) => dispatch({ type: 'SELECTION_TOOLTIP_SET', tooltip: t })}
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
            />
          </ErrorBoundary>
        ) : (
          <div className="flex-1 flex overflow-hidden">
            <ChatModeSidebar
              user={user}
              isOutlinePanelOpen={isOutlinePanelOpen}
              onToggleOutlinePanel={() => dispatch({ type: 'OUTLINE_PANEL_TOGGLE' })}
              onShowProfile={() => dispatch({ type: 'MODAL_PROFILE_SHOW' })}
              onCreateNode={(type) => handleCreateNodeForChatMode(null, type)}
            />
            <ChatModeContainer
              nodes={nodes}
              edges={edges}
              initialNodeId={selectionHistory[0] ?? null}
              selectionHistory={selectionHistory}
              onUpdateNode={handleUpdateNode}
              onCreateNode={handleCreateNodeForChatMode}
              onDeleteNode={handleDeleteNode}
              onNavigateToNode={handleNavigateToNodeLink}
              onOpenLink={handleOpenLink}
              onExpandNode={handleExpandNode}
              aiProvider={aiProvider}
              autoGraphEnabled={autoGraphEnabled}
              focusNodeRef={chatModeFocusRef}
              onSelectionChange={handleChatModeSelectionChange}
            />
          </div>
        )}
      </div>

      {sidePanels}

      <OutlineTreePanel
        isOpen={isOutlinePanelOpen}
        onClose={() => dispatch({ type: 'OUTLINE_PANEL_SET', open: false })}
        nodes={nodes}
        viewportNodeIds={viewportNodeIds}
        hasViewportNodes={hasViewportNodes}
        selectedNodeIds={selectedNodeIds}
        lastSelectedNodeId={selectionHistory[0] ?? null}
        currentScopeId={currentScopeId}
        onFocusNode={handleFocusNode}
      />

      {selectionTooltip && !connectingNodeId && viewMode === 'graph' && (
        <SelectionTooltip
          tooltip={selectionTooltip}
          onClose={() => dispatch({ type: 'SELECTION_TOOLTIP_SET', tooltip: null })}
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
              dispatch({ type: 'SELECTION_TOOLTIP_SET', tooltip: null });
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
                login(u);
                dispatch({ type: 'MODAL_AUTH_HIDE' });
              }}
              onCancel={() => dispatch({ type: 'MODAL_AUTH_HIDE' })}
            />
          </ErrorBoundary>
        </div>
      )}

      {showProfile && user && (
        <ErrorBoundary>
          <ProfilePage
            user={user}
            aiProvider={aiProvider}
            onSetAiProvider={(provider) => dispatch({ type: 'AI_PROVIDER_SET', provider })}
            onClose={() => dispatch({ type: 'MODAL_PROFILE_HIDE' })}
            onUpdateUser={(upd) => dispatch({ type: 'AUTH_USER_UPDATE', updates: upd })}
            onLogout={handleLogout}
            storageConnected={!!dirHandle}
            storageDirName={dirName}
            onOpenStorage={handleOpenStorage}
            onStartMigration={handleStartMigration}
            migrationProgress={migrationProgress}
            physicsConfig={physicsConfig}
            onPhysicsConfigChange={(config) => dispatch({ type: 'PHYSICS_CONFIG_SET', config })}
            isSimulating={isSimulating}
            onStopSimulation={stopSimulation}
          />
        </ErrorBoundary>
      )}

      <UpgradeModal
        isOpen={showUpgradeModal}
        onClose={() => dispatch({ type: 'MODAL_UPGRADE_HIDE' })}
      />
      <LimitModal
        isOpen={showLimitModal}
        onClose={() => dispatch({ type: 'MODAL_LIMIT_HIDE' })}
        onLogin={() => {
          dispatch({ type: 'MODAL_LIMIT_HIDE' });
          dispatch({ type: 'MODAL_AUTH_SHOW', mode: 'login' });
        }}
        onSignup={() => {
          dispatch({ type: 'MODAL_LIMIT_HIDE' });
          dispatch({ type: 'MODAL_AUTH_SHOW', mode: 'signup' });
        }}
      />
      <DuplicateWarningModal
        isOpen={!!pendingExpansion}
        duplicates={pendingExpansion?.duplicates || []}
        onCreateAll={handleCreateAllAnyway}
        onLinkToExisting={handleLinkToExisting}
        onCancel={handleCancelExpansion}
      />
      <Toast
        message={toast.message}
        visible={toast.visible}
        onUndo={toast.action}
        onClose={() => dispatch({ type: 'TOAST_HIDE' })}
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
