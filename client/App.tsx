import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
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
import {
  GraphEdge,
  GraphNode,
  NodeType,
  ViewportTransform,
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
  saveEdgesToFile,
  verifyPermission,
} from "./services/storageService";
import {
  getDirectoryHandle,
  storeDirectoryHandle,
} from "./services/idbService";
import {
  updateUserSettings,
  loadGraphFromApi,
  saveNodeToApi,
  saveEdgesToApi,
} from "./services/apiStorageService";
import { useGraphState } from "./hooks/useGraphState";
import { usePersistence } from "./hooks/usePersistence";
import { useSidePanes } from "./hooks/useSidePanes";
import { useExpansion } from "./hooks/useExpansion";
import { useNavigation } from "./hooks/useNavigation";
import { useGraphOperations } from "./hooks/useGraphOperations";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useBreadcrumbs } from "./hooks/useBreadcrumbs";
import { createDefaultGraphNodes } from "./utils/graphUtils";
import { performGreedyClustering } from "./utils/clustering";

const LOCAL_STORAGE_KEY = "wiki-graph-data";

const App: React.FC = () => {
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
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [cutNodeId, setCutNodeId] = useState<string | null>(null);
  const [aiProvider, setAiProvider] = useState<"gemini" | "huggingface">(() => {
    if (typeof window !== "undefined") {
      return (
        (localStorage.getItem("ai_provider") as "gemini" | "huggingface") ||
        "gemini"
      );
    }
    return "gemini";
  });

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
      setShowLimitModal
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
    setActiveSidePanes
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

  // --- Auth & Sync Logic ---
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
          const storedHandle = await getDirectoryHandle();
          if (data.user && !storedHandle) setDirName("Cloud Storage");
          setIsGraphLoaded(true);
          if (
            window.location.hostname === "infoverse.ai" &&
            !window.location.hostname.startsWith("app.")
          ) {
            window.location.href = `https://app.infoverse.ai${window.location.pathname}`;
          }
        } else {
          setIsGraphLoaded(true);
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
      setNodes(createDefaultGraphNodes());
      setEdges([]);
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
      try {
        if (nodes.length > 0)
          for (const node of nodes) await saveNodeToFile(handle, node);
        if (edges.length > 0) await saveEdgesToFile(handle, edges);
        const { nodes: loadedNodes, edges: loadedEdges } =
          await loadGraphFromDirectory(handle);
        if (loadedNodes.length > 0) {
          setNodes(loadedNodes);
          setEdges(loadedEdges);
        }
        setIsGraphLoaded(true);
      } catch (e) {
        console.error("Error loading from directory", e);
        setIsGraphLoaded(true);
        alert("Failed to load graph from directory.");
      }
    }
  }, [nodes, edges, setNodes, setEdges, setIsGraphLoaded]);

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
    return performGreedyClustering(filteredNodes, viewTransform.k);
  }, [filteredNodes, viewTransform.k]);

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
          {dirName ||
            (user ? "Cloud Storage Active" : "Local Storage (Not Saved)")}
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
          dirName={dirName}
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
          />
        </ErrorBoundary>
      </div>

      {sidePanels}

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
                setUser(u);
                setShowAuth(false);
                const isDefault = nodes.length === 1 && nodes[0].id === "1";
                if (nodes.length > 0 && !isDefault) {
                  try {
                    for (const n of nodes) {
                      const res = await saveNodeToApi(n);
                      if (res.code === "STORAGE_LIMIT") {
                        setUsageNotification({
                          message: "Storage limit reached during sync.",
                          visible: true,
                        });
                        break;
                      }
                    }
                    if (edges.length > 0) await saveEdgesToApi(edges);
                  } catch (e) {
                    console.error("Sync failed", e);
                  }
                }
                if ((u as any).isPaid || !dirHandle) {
                  if (!dirHandle) setDirName("Cloud Storage");
                  loadGraphFromApi()
                    .then(({ nodes: ln, edges: le }) => {
                      if (ln?.length) {
                        setNodes(ln);
                        setEdges(le);
                      }
                      setIsGraphLoaded(true);
                    })
                    .catch((e) => {
                      console.error("Cloud load failed", e);
                      setIsGraphLoaded(true);
                    });
                }
                if (
                  window.location.hostname === "infoverse.ai" &&
                  !window.location.hostname.startsWith("app.")
                )
                  window.location.href = "https://app.infoverse.ai";
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
    </div>
  );
};

export default App;
