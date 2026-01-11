import React, {
  createContext,
  useContext,
  useRef,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from 'react';
import { GraphNode, GraphEdge } from '../types';
import {
  UnifiedStorageService,
  ViewportBounds,
  ViewportLoadResult,
  StorageConfig,
} from '../services/storage';
import { useAuth } from './AuthContext';
import { pickDirectory, saveNodeToFile, getOutgoingEdges } from '../services/storageService';
import { storeDirectoryHandle } from '../services/idbService';
import { saveNodeToApi, saveEdgesToApi } from '../services/apiStorageService';

export type StorageMode = 'memory' | 'local' | 'cloud' | 'both';

interface StorageContextValue {
  // Service instance
  service: UnifiedStorageService;

  // State
  isInitialized: boolean;
  isLoading: boolean;
  isMigrating: boolean;
  storageMode: StorageMode;
  nodes: GraphNode[];
  edges: GraphEdge[];

  // Actions
  initialize: (
    dirHandle?: FileSystemDirectoryHandle,
    userId?: string,
    inMemoryOnly?: boolean
  ) => Promise<void>;
  initializeInMemory: () => Promise<void>;
  migrateToStorage: (dirHandle: FileSystemDirectoryHandle) => Promise<void>;
  loadViewport: (bounds: ViewportBounds) => Promise<ViewportLoadResult>;
  getNodesInViewport: (bounds: ViewportBounds) => GraphNode[];
  getEdgesInViewport: (bounds: ViewportBounds) => GraphEdge[];
  updateNode: (node: GraphNode, skipEmbedding?: boolean) => void;
  addNode: (node: GraphNode, skipEmbedding?: boolean) => void;
  deleteNode: (nodeId: string) => Promise<void>;
  updateEdges: (edges: GraphEdge[]) => void;
  refresh: (bounds: ViewportBounds) => Promise<ViewportLoadResult>;
  flush: () => Promise<void>;
  hasInMemoryData: () => boolean;
  getInMemoryData: () => { nodes: GraphNode[]; edges: GraphEdge[] };
}

const StorageContext = createContext<StorageContextValue | null>(null);

interface StorageProviderProps {
  children: ReactNode;
  config?: Partial<StorageConfig>;
}

export function StorageProvider({ children, config }: StorageProviderProps) {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const serviceRef = useRef<UnifiedStorageService | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const [storageMode, setStorageMode] = useState<StorageMode>('memory');
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const prevAuthenticatedRef = useRef<boolean>(false);

  // Create service on mount
  useEffect(() => {
    serviceRef.current = new UnifiedStorageService(config);
    const service = serviceRef.current;

    // Listen for events
    const handleNodesUpdated = (e: CustomEvent) => {
      if (e.detail.nodes) {
        setNodes(service.getAllCachedNodes());
      }
    };

    const handleEdgesUpdated = (e: CustomEvent) => {
      if (e.detail.edges) {
        setEdges(service.getAllCachedEdges());
      }
    };

    const handleLoadingStart = () => {
      setIsLoading(true);
    };

    const handleLoadingComplete = () => {
      setIsLoading(false);
    };

    service.addEventListener('nodes-updated', handleNodesUpdated as EventListener);
    service.addEventListener('edges-updated', handleEdgesUpdated as EventListener);
    service.addEventListener('loading-start', handleLoadingStart as EventListener);
    service.addEventListener('loading-complete', handleLoadingComplete as EventListener);

    return () => {
      service.removeEventListener('nodes-updated', handleNodesUpdated as EventListener);
      service.removeEventListener('edges-updated', handleEdgesUpdated as EventListener);
      service.removeEventListener('loading-start', handleLoadingStart as EventListener);
      service.removeEventListener('loading-complete', handleLoadingComplete as EventListener);
      service.dispose();
    };
  }, [config]);

  // Handle auth state change - trigger migration when user signs in
  useEffect(() => {
    const handleAuthChange = async () => {
      if (!serviceRef.current || authLoading) return;

      const wasAuthenticated = prevAuthenticatedRef.current;
      prevAuthenticatedRef.current = isAuthenticated;

      // User just signed in
      if (isAuthenticated && !wasAuthenticated && user) {
        const hasData = serviceRef.current.hasInMemoryData();

        if (hasData) {
          // User has in-memory data - migrate it
          setIsMigrating(true);

          try {
            const { nodes: inMemoryNodes, edges: inMemoryEdges } =
              serviceRef.current.getInMemoryData();

            // Prompt for local directory
            const dirHandle = await pickDirectory();

            if (dirHandle) {
              await storeDirectoryHandle(dirHandle);

              // Save to local file system
              for (const node of inMemoryNodes) {
                const outgoingEdges = getOutgoingEdges(node.id, inMemoryEdges);
                await saveNodeToFile(dirHandle, node, outgoingEdges);
              }

              // If paid/admin, also save to cloud
              if (user.isPaid || user.isAdmin) {
                for (const node of inMemoryNodes) {
                  await saveNodeToApi(node);
                }
                if (inMemoryEdges.length > 0) {
                  await saveEdgesToApi(inMemoryEdges);
                }
              }

              // Clear in-memory data
              serviceRef.current.clearInMemoryData();

              // Re-initialize with real storage
              await serviceRef.current.initialize(dirHandle, user.id, false);
              setStorageMode(user.isPaid || user.isAdmin ? 'both' : 'local');
              setIsInitialized(true);
            }
          } catch (err) {
            console.error('Migration failed:', err);
            // Keep in-memory data on failure
          } finally {
            setIsMigrating(false);
          }
        }
      }
    };

    handleAuthChange();
  }, [isAuthenticated, user, authLoading]);

  const initialize = useCallback(
    async (
      dirHandle?: FileSystemDirectoryHandle,
      userId?: string,
      inMemoryOnly: boolean = false
    ) => {
      if (!serviceRef.current) return;
      await serviceRef.current.initialize(dirHandle, userId, inMemoryOnly);

      if (inMemoryOnly) {
        setStorageMode('memory');
      } else if (dirHandle && userId) {
        setStorageMode('both');
      } else if (dirHandle) {
        setStorageMode('local');
      } else if (userId) {
        setStorageMode('cloud');
      }

      setIsInitialized(true);
    },
    []
  );

  const initializeInMemory = useCallback(async () => {
    if (!serviceRef.current) return;
    await serviceRef.current.initialize(undefined, undefined, true);
    setStorageMode('memory');
    setIsInitialized(true);
  }, []);

  const migrateToStorage = useCallback(
    async (dirHandle: FileSystemDirectoryHandle) => {
      if (!serviceRef.current || !user) return;

      setIsMigrating(true);

      try {
        const { nodes: inMemoryNodes, edges: inMemoryEdges } =
          serviceRef.current.getInMemoryData();

        // Save to local file system
        for (const node of inMemoryNodes) {
          const outgoingEdges = getOutgoingEdges(node.id, inMemoryEdges);
          await saveNodeToFile(dirHandle, node, outgoingEdges);
        }

        // If paid/admin, also save to cloud
        if (user.isPaid || user.isAdmin) {
          for (const node of inMemoryNodes) {
            await saveNodeToApi(node);
          }
          if (inMemoryEdges.length > 0) {
            await saveEdgesToApi(inMemoryEdges);
          }
        }

        // Clear in-memory and re-initialize
        serviceRef.current.clearInMemoryData();
        await serviceRef.current.initialize(dirHandle, user.id, false);
        setStorageMode(user.isPaid || user.isAdmin ? 'both' : 'local');
      } finally {
        setIsMigrating(false);
      }
    },
    [user]
  );

  const loadViewport = useCallback(async (bounds: ViewportBounds) => {
    if (!serviceRef.current) {
      return { nodes: [], edges: [], ghostNodes: [], source: 'cache' as const };
    }
    return serviceRef.current.loadViewport(bounds);
  }, []);

  const getNodesInViewport = useCallback((bounds: ViewportBounds) => {
    if (!serviceRef.current) return [];
    return serviceRef.current.getNodesInViewport(bounds);
  }, []);

  const getEdgesInViewport = useCallback((bounds: ViewportBounds) => {
    if (!serviceRef.current) return [];
    return serviceRef.current.getEdgesInViewport(bounds);
  }, []);

  const updateNode = useCallback((node: GraphNode, skipEmbedding = false) => {
    if (!serviceRef.current) return;
    serviceRef.current.updateNode(node, skipEmbedding);
  }, []);

  const addNode = useCallback((node: GraphNode, skipEmbedding = false) => {
    if (!serviceRef.current) return;
    serviceRef.current.addNode(node, skipEmbedding);
  }, []);

  const deleteNode = useCallback(async (nodeId: string) => {
    if (!serviceRef.current) return;
    await serviceRef.current.deleteNode(nodeId);
  }, []);

  const updateEdges = useCallback((newEdges: GraphEdge[]) => {
    if (!serviceRef.current) return;
    serviceRef.current.updateEdges(newEdges);
  }, []);

  const refresh = useCallback(async (bounds: ViewportBounds) => {
    if (!serviceRef.current) {
      return { nodes: [], edges: [], ghostNodes: [], source: 'cache' as const };
    }
    return serviceRef.current.refresh(bounds);
  }, []);

  const flush = useCallback(async () => {
    if (!serviceRef.current) return;
    await serviceRef.current.flush();
  }, []);

  const hasInMemoryData = useCallback(() => {
    if (!serviceRef.current) return false;
    return serviceRef.current.hasInMemoryData();
  }, []);

  const getInMemoryData = useCallback(() => {
    if (!serviceRef.current) return { nodes: [], edges: [] };
    return serviceRef.current.getInMemoryData();
  }, []);

  const value: StorageContextValue = {
    service: serviceRef.current!,
    isInitialized,
    isLoading,
    isMigrating,
    storageMode,
    nodes,
    edges,
    initialize,
    initializeInMemory,
    migrateToStorage,
    loadViewport,
    getNodesInViewport,
    getEdgesInViewport,
    updateNode,
    addNode,
    deleteNode,
    updateEdges,
    refresh,
    flush,
    hasInMemoryData,
    getInMemoryData,
  };

  return (
    <StorageContext.Provider value={value}>{children}</StorageContext.Provider>
  );
}

export function useStorage(): StorageContextValue {
  const context = useContext(StorageContext);
  if (!context) {
    throw new Error('useStorage must be used within a StorageProvider');
  }
  return context;
}
