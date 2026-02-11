import React, {
  useEffect,
  useRef,
  useCallback,
  useState,
} from "react";
import { useAuth } from "./context/AuthContext";
import { useStorage } from "./context/StorageContext";
import { useSelector, useDispatch, useStore } from "./hooks/useAppStore";
import { useGraphActions } from "./hooks/useGraphActions";
import {
  selectGraphHot,
  selectGraphCold,
  selectUiSlice,
  selectStorageSlice,
  selectAuthSlice,
  selectPanelsSlice,
  shallowEqual,
} from "./store/selectors";
import { SearchBar } from "./components/SearchBar";
import { SelectionTooltip } from "./components/SelectionTooltip";
import { Breadcrumbs } from "./components/Breadcrumbs";
import { HeaderActions } from "./components/HeaderActions";
import { ScopeIndicator } from "./components/ScopeIndicator";
import { OutlineTreePanel } from "./components/OutlineTreePanel";
import { ChatModeContainer, ChatModeSidebar } from "./components/ChatMode";
import { GraphModeContainer } from "./components/GraphMode";
import { GlobalModals } from "./components/GlobalModals";
import { SidePanelsRenderer } from "./components/SidePanelsRenderer";
import { getMigrationService } from "./services/migration/MigrationService";
import {
  GraphEdge,
  GraphNode,
  NodeType,
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
import { useBreadcrumbs } from "./hooks/useBreadcrumbs";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useExpansion } from "./hooks/useExpansion";
import { createDefaultGraphNodes } from "./utils/graphUtils";

const EMPTY_SET = new Set<string>();

const App: React.FC = () => {
  const dispatch = useDispatch();
  const store = useStore();

  // --- Read state via slice selectors ---
  const graphHot = useSelector(selectGraphHot, shallowEqual);
  const graphCold = useSelector(selectGraphCold, shallowEqual);
  const ui = useSelector(selectUiSlice, shallowEqual);
  const storage = useSelector(selectStorageSlice, shallowEqual);
  const auth = useSelector(selectAuthSlice, shallowEqual);
  const panels = useSelector(selectPanelsSlice, shallowEqual);

  // --- Stable actions ---
  const actions = useGraphActions();

  // --- Local UI state ---
  const [outlinePanelWidth, setOutlinePanelWidth] = useState(280);

  // --- Auth & Storage from Context ---
  const { logout } = useAuth();
  const {
    storageMode,
    isMigrating,
    initialize,
    initializeInMemory,
    restoreLastDeletedNode,
    getDeletionStackSize,
  } = useStorage();

  // --- Refs ---
  const chatModeFocusRef = useRef<((nodeId: string) => void) | null>(null);

  // --- Toast helper ---
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

  // --- Stable setters for useExpansion (route through actions façade) ---
  const stableSetNodes = useCallback(
    (v: GraphNode[] | ((prev: GraphNode[]) => GraphNode[])) => {
      if (typeof v === 'function') actions.updateNodes(v);
      else actions.setNodes(v);
    },
    [actions]
  );

  const stableSetEdges = useCallback(
    (v: GraphEdge[] | ((prev: GraphEdge[]) => GraphEdge[])) => {
      if (typeof v === 'function') actions.updateEdges(v);
      else actions.setEdges(v);
    },
    [actions]
  );

  // --- Expansion (needed for ChatMode and shared handlers) ---
  const {
    handleExpandNode,
    pendingExpansion,
    handleCreateAllAnyway,
    handleLinkToExisting,
    handleCancelExpansion,
  } = useExpansion(
    graphHot.nodes,
    graphCold.currentScopeId,
    stableSetNodes,
    stableSetEdges,
    graphCold.aiProvider,
    actions.setViewTransform,
    setToast,
    (show: boolean) => show ? dispatch({ type: 'MODAL_LIMIT_SHOW' }) : dispatch({ type: 'MODAL_LIMIT_HIDE' }),
    undefined
  );

  // --- Keyboard Shortcuts ---
  const handleRestoreFromDeletionStack = useCallback(async () => {
    const entry = await restoreLastDeletedNode();
    if (entry) {
      dispatch({ type: 'RESTORE_NODES', nodes: [entry.node], edges: entry.edges });
      dispatch({ type: 'TOAST_SHOW', message: "Node restored" });
    }
  }, [restoreLastDeletedNode, dispatch]);

  useKeyboardShortcuts(
    graphHot.selectedNodeIds,
    () => {}, // confirmDeleteNode handled by containers
    () => {}, // handleCut handled by containers
    () => {}, // handlePaste handled by containers
    graphHot.viewTransform,
    ui.toast.visible,
    ui.toast.action,
    getDeletionStackSize(),
    handleRestoreFromDeletionStack
  );

  // --- Breadcrumbs ---
  const breadcrumbs = useBreadcrumbs(
    graphHot.nodes,
    graphHot.edges,
    graphCold.currentScopeId,
    graphHot.selectedNodeIds,
    storage.dirName
  );

  // --- Layout Shifts ---
  useEffect(() => {
    if (typeof window === "undefined") return;
    let newLeftShift = 0, newRightShift = 0, newTopShift = 0, newBottomShift = 0;
    Object.values(panels.sidePanelLayouts).forEach((layout) => {
      const { width, height, dockPosition } = layout;
      if (dockPosition === "left") newLeftShift = Math.max(newLeftShift, (window.innerWidth * width) / 100);
      else if (dockPosition === "right") newRightShift = Math.max(newRightShift, (window.innerWidth * width) / 100);
      else if (dockPosition === "top-left" || dockPosition === "top-right") newTopShift = Math.max(newTopShift, (window.innerHeight * height) / 100);
      else if (dockPosition === "bottom-left" || dockPosition === "bottom-right") newBottomShift = Math.max(newBottomShift, (window.innerHeight * height) / 100);
    });
    const totalXShift = newLeftShift - newRightShift;
    const totalYShift = newTopShift - newBottomShift;
    if (Math.abs(totalXShift - ui.canvasShiftX) > 1 || Math.abs(totalYShift - ui.canvasShiftY) > 1) {
      dispatch({ type: 'CANVAS_SHIFT_SET', x: totalXShift, y: totalYShift });
    }
  }, [panels.sidePanelLayouts, ui.canvasShiftX, ui.canvasShiftY, dispatch]);

  // --- Storage & Sync Logic ---
  useEffect(() => {
    const initializeApp = async () => {
      if (auth.authLoading) return;
      cleanupLegacyStorage();

      try {
        const storedHandle = await getDirectoryHandle();

        let initializedStorage = false;

        if (storedHandle) {
          const hasPermission = await verifyPermission(storedHandle, true);

          if (hasPermission) {
            await initialize(storedHandle, auth.user?.id, false);
            initializedStorage = true;
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

        if (auth.user) {
          if (!initializedStorage) {
            await initialize(undefined, auth.user.id, false);
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
  }, [auth.authLoading, auth.user, initialize, initializeInMemory, dispatch]);

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
            await migrateEdgesToNodes(handle, loadedNodes, loadedEdges);
          }
        } else {
          const { nodes, edges } = store.getState();
          if (nodes.length > 0) {
            for (const node of nodes) {
              const outgoingEdges = getOutgoingEdges(node.id, edges);
              await saveNodeToFile(handle, node, outgoingEdges);
            }
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
  }, [store, dispatch]);

  const handleStartMigration = useCallback(async () => {
    const { dirHandle } = store.getState();
    if (!dirHandle) return;

    const migrationService = getMigrationService();
    const lastTimestamp = migrationService.getLastMigrationTimestamp();
    if (lastTimestamp) {
      dispatch({
        type: 'MIGRATION_PROGRESS_SET',
        progress: {
          isRunning: false, totalNodes: 0, processedNodes: 0,
          nodesNeedingUpdates: 0, currentStatus: 'Idle',
          lastMigrationTimestamp: lastTimestamp, errors: [],
        },
      });
    }

    const snapshot = store.getState();
    try {
      await migrationService.runMigration(
        async (nodeId: string) => {
          const node = snapshot.nodes.find((n) => n.id === nodeId);
          if (!node) return null;
          const outgoingEdges = snapshot.edges.filter((e) => e.source === nodeId);
          return { ...node, edges: outgoingEdges.map((e) => ({ id: e.id, target: e.target, label: e.label })) };
        },
        async (node: GraphNode) => {
          dispatch({ type: 'NODE_UPDATE', id: node.id, updates: node });
          const dh = store.getState().dirHandle;
          if (dh) {
            const outgoingEdges = getOutgoingEdges(node.id, snapshot.edges);
            await saveNodeToFile(dh, node, outgoingEdges);
          }
        },
        () => snapshot.nodes.map((n) => n.id),
        (progress) => dispatch({ type: 'MIGRATION_PROGRESS_SET', progress })
      );
    } catch (e) {
      console.error('Migration failed:', e);
    }
  }, [store, dispatch]);

  const handleImportFromCloud = useCallback(async () => {
    if (!auth.user) return;

    const cloudData = await importFromCloud();
    if (cloudData && (cloudData.nodes.length > 0 || cloudData.edges.length > 0)) {
      dispatch({ type: 'GRAPH_LOAD_FROM_STORAGE', nodes: cloudData.nodes, edges: cloudData.edges });

      if (storage.dirHandle) {
        for (const node of cloudData.nodes) {
          const outgoingEdges = getOutgoingEdges(node.id, cloudData.edges);
          await saveNodeToFile(storage.dirHandle, node, outgoingEdges);
        }
      }

      dispatch({ type: 'TOAST_SHOW', message: "Imported from cloud successfully" });
    } else {
      dispatch({ type: 'TOAST_SHOW', message: "No data found in cloud storage" });
    }
  }, [auth.user, storage.dirHandle, dispatch]);

  const handleCloseFolder = useCallback(async () => {
    if ((auth.user as any)?.isPaid) {
      dispatch({ type: 'STORAGE_DIR_NAME_SET', name: null });
      dispatch({ type: 'NODES_SET', nodes: createDefaultGraphNodes() });
      dispatch({ type: 'EDGES_SET', edges: [] });
      return;
    }
    if (auth.user?.storagePath) {
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
  }, [auth.user, dispatch]);

  // --- View mode toggle ---
  const handleToggleViewMode = useCallback(() => {
    dispatch({ type: 'VIEW_MODE_TOGGLE' });
  }, [dispatch]);

  // --- Focus node handler for breadcrumbs/search ---
  const handleFocusNode = useCallback((nodeId: string) => {
    const state = store.getState();
    const node = state.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const k = state.viewTransform.k;
    const cx = node.x + (node.width || DEFAULT_NODE_WIDTH) / 2;
    const cy = node.y + (node.height || DEFAULT_NODE_HEIGHT) / 2;
    dispatch({
      type: 'FOCUS_NODE',
      nodeId,
      pushHistory: true,
      transform: {
        x: window.innerWidth / 2 - cx * k,
        y: window.innerHeight / 2 - cy * k,
        k,
      },
    });
    if (state.viewMode === 'chat' && chatModeFocusRef.current) {
      chatModeFocusRef.current(nodeId);
    }
  }, [store, dispatch]);

  // --- Search select handler ---
  const handleSearchSelect = useCallback(
    (topic: string, shouldExpand: boolean, isWiki: boolean = true) => {
      const state = store.getState();
      const { viewTransform } = state;
      const vpW = window.innerWidth;
      const vpH = window.innerHeight;
      const centerX = -viewTransform.x / viewTransform.k + vpW / 2 / viewTransform.k - DEFAULT_NODE_WIDTH / 2;
      const centerY = -viewTransform.y / viewTransform.k + vpH / 2 / viewTransform.k - DEFAULT_NODE_HEIGHT / 2;

      const newNodeId = crypto.randomUUID();
      const wikiUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(topic.replace(/ /g, "_"))}`;
      const initialContent = isWiki
        ? `# ${topic}\n\n**assistant**: Topic: ${topic}\n\n[Wikipedia](${wikiUrl})`
        : `# ${topic}\n\n`;

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

      actions.updateNodes(prev => [...prev, newNode]);

      if (shouldExpand) {
        handleExpandNode(newNodeId, topic, newNode);
      }

      const nodeCenterX = newNode.x + DEFAULT_NODE_WIDTH / 2;
      const nodeCenterY = newNode.y + DEFAULT_NODE_HEIGHT / 2;
      dispatch({
        type: 'FOCUS_NODE',
        nodeId: newNodeId,
        pushHistory: true,
        transform: { x: vpW / 2 - nodeCenterX, y: vpH / 2 - nodeCenterY, k: 1 },
      });
    },
    [store, actions, handleExpandNode, dispatch]
  );

  // --- Link & Navigation handlers (shared by SidePanels + ChatMode) ---
  const handleOpenLink = useCallback(
    (url: string) => {
      const isWikipedia = url.includes("wikipedia.org/wiki/");
      if (isWikipedia) {
        dispatch({
          type: 'SIDE_PANE_ADD',
          pane: { id: crypto.randomUUID(), type: "web", data: url, initialDockPosition: "left", initialWidthPercent: 33 },
        });
      } else {
        const existing = panels.activeSidePanes.find((p) => p.type === "web" && p.initialDockPosition !== "left");
        if (existing) {
          dispatch({ type: 'SIDE_PANE_UPDATE', id: existing.id, updates: { data: url } });
        } else {
          dispatch({
            type: 'SIDE_PANE_ADD',
            pane: { id: crypto.randomUUID(), type: "web", data: url, initialDockPosition: "right", initialWidthPercent: 33 },
          });
        }
      }
    },
    [panels.activeSidePanes, dispatch]
  );

  const handleNavigateToNodeLink = useCallback(
    (rawTitle: string) => {
      const normalize = (v?: string | null) => v?.trim().toLowerCase() || "";
      const target = normalize(rawTitle);
      if (!target) return;
      const matchedNode = store.getState().nodes.find(
        (n) => normalize(n.content) === target || normalize(n.summary) === target || n.aliases?.some((a) => normalize(a) === target)
      );
      if (!matchedNode) return;
      handleFocusNode(matchedNode.id);
    },
    [store, handleFocusNode]
  );

  const handleUpdateNode = useCallback(
    (id: string, updates: Partial<GraphNode>) => {
      dispatch({ type: 'NODE_UPDATE', id, updates });
    },
    [dispatch]
  );

  // --- ChatMode handlers ---
  const handleChatModeSelectionChange = useCallback((nodeId: string | null) => {
    if (nodeId) {
      dispatch({ type: 'SELECTION_SET', ids: new Set([nodeId]) });
      dispatch({ type: 'SELECTION_HISTORY_PUSH', id: nodeId });
    }
  }, [dispatch]);

  const handleCreateNodeForChatMode = useCallback(
    (parentId: string | null, type: NodeType, content?: string): GraphNode => {
      const id = crypto.randomUUID();
      const newNode: GraphNode = {
        id,
        type,
        x: 0,
        y: 0,
        content: content || '',
        parentId: parentId ?? undefined,
        scopeId: store.getState().currentScopeId ?? undefined,
      };
      actions.updateNodes(prev => [...prev, newNode]);
      dispatch({ type: 'SELECTION_SET', ids: new Set([id]) });
      return newNode;
    },
    [store, actions, dispatch]
  );

  const handleDeleteNode = useCallback((id: string) => {
    dispatch({ type: 'DELETE_NODES', ids: [id] });
  }, [dispatch]);

  return (
    <div className="flex w-screen h-screen overflow-hidden bg-slate-900 text-slate-200 font-sans">
      <div className="flex-1 relative min-w-0 flex flex-col">
        {!auth.user && (
          <HeaderActions
            user={auth.user}
            onLogin={() => dispatch({ type: 'MODAL_AUTH_SHOW', mode: 'login' })}
            onSignup={() => dispatch({ type: 'MODAL_AUTH_SHOW', mode: 'signup' })}
            onShowProfile={() => dispatch({ type: 'MODAL_PROFILE_SHOW' })}
            activeSidePanesCount={panels.activeSidePanes.length}
            searchExpanded={ui.searchExpanded}
            onSearchExpandedChange={(v: boolean) => dispatch({ type: 'SEARCH_EXPANDED_SET', expanded: v })}
          />
        )}

        <button
          onClick={handleToggleViewMode}
          className={`absolute top-4 right-4 z-[60] p-2 rounded-lg border transition-all shadow-lg bg-slate-800/80 backdrop-blur text-slate-400 hover:text-white border-slate-700 ${
            panels.activeSidePanes.length > 0 ? "opacity-0 invisible" : "opacity-100 visible"
          }`}
          title={ui.viewMode === 'chat' ? 'Switch to Graph View' : 'Switch to Chat View'}
        >
          {ui.viewMode === 'chat' ? (
            <svg className="h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="7" cy="12" r="3.5" />
              <circle cx="16" cy="5" r="2.5" />
              <circle cx="18" cy="17" r="2" />
              <line x1="10" y1="10" x2="14" y2="6.5" />
              <line x1="10" y1="14" x2="16.5" y2="16" />
            </svg>
          ) : (
            <svg className="h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              <line x1="7" y1="8" x2="17" y2="8" />
              <line x1="7" y1="12" x2="13" y2="12" />
            </svg>
          )}
        </button>

        <div className="absolute top-4 text-slate-500 text-xs font-mono opacity-50 pointer-events-none select-none">
          {isMigrating ? "Saving your work..." : storage.dirName ||
            (auth.user ? "Cloud Storage Active" : storageMode === 'memory' ? "In-Memory (Sign in to save)" : "Local Storage (Not Saved)")}
        </div>

        <Breadcrumbs
          breadcrumbs={breadcrumbs}
          selectedNodeIds={graphHot.selectedNodeIds}
          onNavigate={(id, type) => {
            if (type === "node" && id) handleFocusNode(id);
            else {
              dispatch({ type: 'SCOPE_SET', scopeId: id });
              dispatch({ type: 'SELECTION_CLEAR' });
            }
          }}
          onCloseFolder={handleCloseFolder}
          onImportFromCloud={handleImportFromCloud}
          dirName={storage.dirName}
          isLoggedIn={!!auth.user}
          isOutlinePanelOpen={ui.isOutlinePanelOpen}
          outlinePanelWidth={outlinePanelWidth}
        />

        <ScopeIndicator currentScopeId={graphCold.currentScopeId} nodes={graphHot.nodes} />

        <SearchBar
          nodes={graphHot.nodes}
          onSelect={handleSearchSelect}
          onNavigate={handleFocusNode}
          onPreview={handleOpenLink}
          isCloud={!!auth.user}
          isExpanded={ui.searchExpanded}
          onExpandedChange={(v: boolean) => dispatch({ type: 'SEARCH_EXPANDED_SET', expanded: v })}
        />

        {ui.usageNotification.visible && (
          <div className="absolute bottom-4 right-4 z-50 bg-slate-800 border border-sky-500 text-sky-400 px-4 py-3 rounded shadow-lg animate-bounce">
            <p className="text-sm font-bold">{ui.usageNotification.message}</p>
            <button
              onClick={() => dispatch({ type: 'USAGE_NOTIFICATION_HIDE' })}
              className="absolute top-1 right-1 text-xs text-slate-500 hover:text-white"
            >
              ✕
            </button>
          </div>
        )}

        <div className="flex-1 flex overflow-hidden">
          {ui.viewMode === 'graph' ? (
            <GraphModeContainer
              outlinePanelWidth={outlinePanelWidth}
              onOutlinePanelWidthChange={setOutlinePanelWidth}
            />
          ) : (
            <div className="flex-1 min-w-0 h-full flex">
              <ChatModeSidebar
                user={auth.user}
                isOutlinePanelOpen={ui.isOutlinePanelOpen}
                onToggleOutlinePanel={() => dispatch({ type: 'OUTLINE_PANEL_TOGGLE' })}
                onShowProfile={() => dispatch({ type: 'MODAL_PROFILE_SHOW' })}
                onCreateNode={(type) => handleCreateNodeForChatMode(null, type)}
              />
              <OutlineTreePanel
                isOpen={ui.isOutlinePanelOpen}
                onClose={() => dispatch({ type: 'OUTLINE_PANEL_SET', open: false })}
                nodes={graphHot.nodes}
                viewportNodeIds={EMPTY_SET}
                hasViewportNodes={false}
                selectedNodeIds={graphHot.selectedNodeIds}
                lastSelectedNodeId={graphCold.selectionHistory[0] ?? null}
                currentScopeId={graphCold.currentScopeId}
                onFocusNode={handleFocusNode}
                panelWidth={outlinePanelWidth}
                onPanelWidthChange={setOutlinePanelWidth}
              />
              <ChatModeContainer
                onUpdateNode={handleUpdateNode}
                onCreateNode={handleCreateNodeForChatMode}
                onDeleteNode={handleDeleteNode}
                onNavigateToNode={handleNavigateToNodeLink}
                onOpenLink={handleOpenLink}
                onExpandNode={handleExpandNode}
                focusNodeRef={chatModeFocusRef}
                onSelectionChange={handleChatModeSelectionChange}
              />
            </div>
          )}
        </div>
      </div>

      {/* Side Panels - outside mode switch */}
      <SidePanelsRenderer
        onExpandNode={handleExpandNode}
        onNavigateToNode={handleNavigateToNodeLink}
        onOpenLink={handleOpenLink}
      />

      {/* Selection Tooltip (graph mode only) */}
      {ui.selectionTooltip && !graphCold.connectingNodeId && ui.viewMode === 'graph' && (
        <SelectionTooltip
          tooltip={ui.selectionTooltip}
          onClose={() => dispatch({ type: 'SELECTION_TOOLTIP_SET', tooltip: null })}
          onCreateNote={() => {}}
          onCreateChat={() => {}}
          onExpandGraph={() => {
            if (ui.selectionTooltip?.sourceId) {
              handleExpandNode(ui.selectionTooltip.sourceId, ui.selectionTooltip.text);
              dispatch({ type: 'SELECTION_TOOLTIP_SET', tooltip: null });
              window.getSelection()?.removeAllRanges();
            }
          }}
          onFindRelationships={() => {}}
          isMobile={typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches}
        />
      )}

      {/* Global Modals */}
      <GlobalModals
        pendingExpansion={pendingExpansion}
        onCreateAllAnyway={handleCreateAllAnyway}
        onLinkToExisting={handleLinkToExisting}
        onCancelExpansion={handleCancelExpansion}
        onOpenStorage={handleOpenStorage}
        onStartMigration={handleStartMigration}
        onLogout={handleLogout}
      />
    </div>
  );
};

export default App;
