import React, { createContext, useContext, useSyncExternalStore, useCallback, useRef } from 'react';
import { AppStore, AppState, Action } from '../store';

const StoreContext = createContext<AppStore | null>(null);

export function AppStoreProvider({
  store,
  children,
}: {
  store: AppStore;
  children: React.ReactNode;
}) {
  return React.createElement(StoreContext.Provider, { value: store }, children);
}

export function useStore(): AppStore {
  const store = useContext(StoreContext);
  if (!store) {
    throw new Error('useStore must be used within an AppStoreProvider');
  }
  return store;
}

export function useSelector<T>(selector: (state: AppState) => T): T {
  const store = useStore();

  const selectorRef = useRef(selector);
  selectorRef.current = selector;

  const subscribe = useCallback(
    (onStoreChange: () => void) => store.subscribe(onStoreChange),
    [store]
  );

  const getSnapshot = useCallback(() => selectorRef.current(store.getState()), [store]);

  return useSyncExternalStore(subscribe, getSnapshot);
}

export function useDispatch(): (action: Action) => void {
  const store = useStore();
  return store.dispatch;
}
