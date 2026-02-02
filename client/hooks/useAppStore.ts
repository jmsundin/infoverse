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

export function useSelector<T>(
  selector: (state: AppState) => T,
  equalityFn?: (a: T, b: T) => boolean
): T {
  const store = useStore();

  const selectorRef = useRef(selector);
  selectorRef.current = selector;

  // Track previous value for equality comparison
  const prevValueRef = useRef<T | undefined>(undefined);

  const subscribe = useCallback(
    (onStoreChange: () => void) => store.subscribe(onStoreChange),
    [store]
  );

  const getSnapshot = useCallback(() => {
    const newValue = selectorRef.current(store.getState());

    // If equality function provided and values are equal, return previous reference
    if (equalityFn && prevValueRef.current !== undefined) {
      if (equalityFn(prevValueRef.current, newValue)) {
        return prevValueRef.current;
      }
    }

    prevValueRef.current = newValue;
    return newValue;
  }, [store, equalityFn]);

  return useSyncExternalStore(subscribe, getSnapshot);
}

export function useDispatch(): (action: Action) => void {
  const store = useStore();
  return store.dispatch;
}
