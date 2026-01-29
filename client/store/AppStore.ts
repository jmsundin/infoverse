import { AppState, createInitialState } from './AppState';
import { Action } from './actions';
import { appReducer } from './reducer';

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
