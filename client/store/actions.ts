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

// --- Graph Actions ---

export type GraphAction =
  | { type: 'NODES_SET'; nodes: GraphNode[] }
  | { type: 'NODES_ADD'; nodes: GraphNode[] }
  | { type: 'NODES_REMOVE'; ids: string[] }
  | { type: 'NODE_UPDATE'; id: string; updates: Partial<GraphNode> }
  | { type: 'NODES_MERGE'; nodes: GraphNode[] }
  | { type: 'NODES_UPDATE'; updater: (prev: GraphNode[]) => GraphNode[] }
  | { type: 'EDGES_SET'; edges: GraphEdge[] }
  | { type: 'EDGE_ADD'; edge: GraphEdge }
  | { type: 'EDGES_ADD'; edges: GraphEdge[] }
  | { type: 'EDGES_REMOVE_BY_NODE'; nodeIds: string[] }
  | { type: 'EDGES_UPDATE'; updater: (prev: GraphEdge[]) => GraphEdge[] }
  | { type: 'SCOPE_SET'; scopeId: string | null }
  | { type: 'SELECTION_SET'; ids: Set<string> }
  | { type: 'SELECTION_ADD'; id: string }
  | { type: 'SELECTION_REMOVE'; id: string }
  | { type: 'SELECTION_CLEAR' }
  | { type: 'SELECTION_UPDATE'; updater: (prev: Set<string>) => Set<string> }
  | { type: 'GRAPH_LOADED_SET'; loaded: boolean };

// --- Auth Actions ---

export type AuthAction =
  | { type: 'AUTH_USER_SET'; user: User | null }
  | { type: 'AUTH_USER_UPDATE'; updates: Partial<User> }
  | { type: 'AUTH_LOADING_SET'; loading: boolean };

// --- Storage Actions ---

export type StorageAction =
  | { type: 'STORAGE_MODE_SET'; mode: StorageMode }
  | { type: 'STORAGE_MIGRATING_SET'; migrating: boolean }
  | { type: 'STORAGE_DIR_HANDLE_SET'; handle: FileSystemDirectoryHandle | null }
  | { type: 'STORAGE_DIR_NAME_SET'; name: string | null };

// --- UI Actions ---

export type UIAction =
  | { type: 'VIEW_TRANSFORM_SET'; transform: ViewportTransform }
  | { type: 'VIEW_MODE_TOGGLE' }
  | { type: 'CONNECTING_NODE_SET'; id: string | null }
  | { type: 'SELECTION_TOOLTIP_SET'; tooltip: SelectionTooltipState | null }
  | { type: 'TOAST_SHOW'; message: string; action?: () => void }
  | { type: 'TOAST_HIDE' }
  | { type: 'SEARCH_EXPANDED_SET'; expanded: boolean }
  | { type: 'OUTLINE_PANEL_TOGGLE' }
  | { type: 'OUTLINE_PANEL_SET'; open: boolean }
  | { type: 'CANVAS_SHIFT_SET'; x: number; y: number }
  | { type: 'WINDOW_SIZE_SET'; width: number; height: number };

// --- Settings Actions ---

export type SettingsAction =
  | { type: 'AUTO_GRAPH_SET'; enabled: boolean }
  | { type: 'AI_PROVIDER_SET'; provider: 'gemini' | 'huggingface' }
  | { type: 'PHYSICS_CONFIG_SET'; config: Partial<PhysicsConfig> }
  | { type: 'SELECTION_HISTORY_PUSH'; id: string };

// --- Modal Actions ---

export type ModalAction =
  | { type: 'MODAL_AUTH_SHOW'; mode: 'login' | 'signup' }
  | { type: 'MODAL_AUTH_HIDE' }
  | { type: 'MODAL_PROFILE_SHOW' }
  | { type: 'MODAL_PROFILE_HIDE' }
  | { type: 'MODAL_LIMIT_SHOW' }
  | { type: 'MODAL_LIMIT_HIDE' }
  | { type: 'MODAL_UPGRADE_SHOW' }
  | { type: 'MODAL_UPGRADE_HIDE' }
  | { type: 'USAGE_NOTIFICATION_SHOW'; message: string }
  | { type: 'USAGE_NOTIFICATION_HIDE' };

// --- Expansion Actions ---

export type ExpansionAction =
  | { type: 'EXPANDING_NODE_ADD'; id: string }
  | { type: 'EXPANDING_NODE_REMOVE'; id: string }
  | { type: 'PENDING_EXPANSION_SET'; expansion: PendingExpansion | null };

// --- Side Panel Actions ---

export type SidePanelAction =
  | { type: 'SIDE_PANE_ADD'; pane: ActiveSidePane }
  | { type: 'SIDE_PANE_REMOVE'; id: string }
  | { type: 'SIDE_PANES_SET'; panes: ActiveSidePane[] }
  | { type: 'SIDE_PANE_UPDATE'; id: string; updates: Partial<ActiveSidePane> }
  | { type: 'SIDE_PANEL_LAYOUT_SET'; id: string; layout: SidePanelLayout }
  | { type: 'SIDE_PANEL_LAYOUT_REMOVE'; id: string };

// --- Misc Actions ---

export type MiscAction =
  | { type: 'CUT_NODE_SET'; id: string | null }
  | { type: 'MIGRATION_PROGRESS_SET'; progress: MigrationProgress | null }
  | { type: 'SIMULATING_SET'; simulating: boolean };

// --- Compound Actions ---

export type CompoundAction =
  | {
      type: 'DELETE_NODES';
      ids: string[];
    }
  | {
      type: 'RESTORE_NODES';
      nodes: GraphNode[];
      edges: GraphEdge[];
    }
  | { type: 'LOGOUT' }
  | {
      type: 'GRAPH_LOAD_FROM_STORAGE';
      nodes: GraphNode[];
      edges: GraphEdge[];
    }
  | {
      type: 'FOCUS_NODE';
      nodeId: string;
      transform: ViewportTransform;
      pushHistory?: boolean;
      select?: boolean;
    };

// --- Union ---

export type Action =
  | GraphAction
  | AuthAction
  | StorageAction
  | UIAction
  | SettingsAction
  | ModalAction
  | ExpansionAction
  | SidePanelAction
  | MiscAction
  | CompoundAction;
