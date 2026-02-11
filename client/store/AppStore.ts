import { AppState, createInitialState } from './AppState';
import { Action } from './actions';
import { appReducer } from './reducer';
import {
  summarizeNodeIds,
  summarizeTransform,
  viewportDebugLog,
} from '../utils/viewportDebug';

export type Listener = (state: AppState, action: Action) => void;
export type Unsubscribe = () => void;

export class AppStore {
  private state: AppState;
  private listeners = new Set<Listener>();

  constructor(initial?: Partial<AppState>) {
    this.state = initial
      ? { ...createInitialState(), ...initial }
      : createInitialState();
  }

  getState(): AppState {
    return this.state;
  }

  dispatch = (action: Action): void => {
    const prev = this.state;
    this.state = appReducer(prev, action);
    if (this.state !== prev) {
      const shouldLogViewport =
        action.type === 'FOCUS_NODE' ||
        action.type === 'SCOPE_SET' ||
        action.type === 'VIEW_TRANSFORM_SET' ||
        action.type.startsWith('SELECTION_');

      if (shouldLogViewport) {
        viewportDebugLog('store.action', {
          action: action.type,
          scopeId: this.state.currentScopeId,
          selectedNodeIds: summarizeNodeIds(this.state.selectedNodeIds),
          selectionCount: this.state.selectedNodeIds.size,
          viewTransform: summarizeTransform(this.state.viewTransform),
        });
      }

      this.listeners.forEach((fn) => fn(this.state, action));
    }
  };

  subscribe(listener: Listener): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
