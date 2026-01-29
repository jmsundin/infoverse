import {
  GraphNode,
  GraphEdge,
  ViewportTransform,
  SelectionTooltipState,
  PhysicsConfig,
  PendingExpansion,
} from '../types';
import { ActiveSidePane } from '../hooks/useSidePanes';
import { SidePanelLayout } from '../components/SidePanel';
import { MigrationProgress } from '../services/migration/types';
import { StorageMode } from '../context/StorageContext';
import { User } from '../context/AuthContext';
import {
  getAIProvider,
  getPhysicsConfig,
  getSelectionHistory,
} from '../services/settingsService';
import { createDefaultGraphNodes } from '../utils/graphUtils';

export interface AppState {
  // --- Graph Data ---
  nodes: GraphNode[];
  edges: GraphEdge[];
  currentScopeId: string | null;
  selectedNodeIds: Set<string>;
  isGraphLoaded: boolean;

  // --- Auth ---
  user: User | null;
  authLoading: boolean;

  // --- Storage ---
  storageMode: StorageMode;
  isMigrating: boolean;
  dirHandle: FileSystemDirectoryHandle | null;
  dirName: string | null;

  // --- UI ---
  viewTransform: ViewportTransform;
  viewMode: 'graph' | 'chat';
  connectingNodeId: string | null;
  selectionTooltip: SelectionTooltipState | null;
  toast: { visible: boolean; message: string; action?: () => void };
  searchExpanded: boolean;
  isOutlinePanelOpen: boolean;
  canvasShiftX: number;
  canvasShiftY: number;
  windowSize: { width: number; height: number };

  // --- Settings ---
  autoGraphEnabled: boolean;
  aiProvider: 'gemini' | 'huggingface';
  physicsConfig: PhysicsConfig;
  selectionHistory: string[];

  // --- Modals ---
  showAuth: boolean;
  authMode: 'login' | 'signup';
  showProfile: boolean;
  showLimitModal: boolean;
  showUpgradeModal: boolean;
  usageNotification: { message: string; visible: boolean };

  // --- Expansion ---
  expandingNodeIds: string[];
  pendingExpansion: PendingExpansion | null;

  // --- Side Panels ---
  activeSidePanes: ActiveSidePane[];
  sidePanelLayouts: Record<string, SidePanelLayout>;

  // --- Misc ---
  cutNodeId: string | null;
  migrationProgress: MigrationProgress | null;
  isSimulating: boolean;
}

export function createInitialState(): AppState {
  return {
    // Graph Data
    nodes: createDefaultGraphNodes(),
    edges: [],
    currentScopeId: null,
    selectedNodeIds: new Set(),
    isGraphLoaded: false,

    // Auth
    user: null,
    authLoading: true,

    // Storage
    storageMode: 'memory',
    isMigrating: false,
    dirHandle: null,
    dirName: null,

    // UI
    viewTransform: { x: 0, y: 0, k: 1 },
    viewMode: 'graph',
    connectingNodeId: null,
    selectionTooltip: null,
    toast: { visible: false, message: '' },
    searchExpanded: false,
    isOutlinePanelOpen: false,
    canvasShiftX: 0,
    canvasShiftY: 0,
    windowSize: {
      width: typeof window !== 'undefined' ? window.innerWidth : 1024,
      height: typeof window !== 'undefined' ? window.innerHeight : 768,
    },

    // Settings
    autoGraphEnabled: true,
    aiProvider: getAIProvider(),
    physicsConfig: getPhysicsConfig(),
    selectionHistory: getSelectionHistory(),

    // Modals
    showAuth: false,
    authMode: 'login',
    showProfile: false,
    showLimitModal: false,
    showUpgradeModal: false,
    usageNotification: { message: '', visible: false },

    // Expansion
    expandingNodeIds: [],
    pendingExpansion: null,

    // Side Panels
    activeSidePanes: [],
    sidePanelLayouts: {},

    // Misc
    cutNodeId: null,
    migrationProgress: null,
    isSimulating: false,
  };
}
