import { useEffect } from 'react';
import { useAuth } from './context/AuthContext';
import { useStorage } from './context/StorageContext';
import { useDispatch } from './hooks/useAppStore';
import { useAutoSave } from './hooks/useAutoSave';
import { useWindowResize } from './hooks/useWindowResize';
import {
  setSelectionHistory as saveSelectionHistory,
  setAIProvider as saveAIProvider,
  setPhysicsConfig as savePhysicsConfig,
} from './services/settingsService';
import { useSelector } from './hooks/useAppStore';

/**
 * Component that syncs external context state (Auth, Storage) into the AppStore,
 * and mounts global effect hooks (auto-save, window resize).
 *
 * Rendered inside AppStoreProvider, AuthProvider, and StorageProvider.
 */
export function AppEffects() {
  const dispatch = useDispatch();
  const { user, isLoading: authLoading } = useAuth();
  const { storageMode, isMigrating } = useStorage();

  // Sync auth state to store
  useEffect(() => {
    dispatch({ type: 'AUTH_USER_SET', user });
  }, [user, dispatch]);

  useEffect(() => {
    dispatch({ type: 'AUTH_LOADING_SET', loading: authLoading });
  }, [authLoading, dispatch]);

  // Sync storage state to store
  useEffect(() => {
    dispatch({ type: 'STORAGE_MODE_SET', mode: storageMode });
  }, [storageMode, dispatch]);

  useEffect(() => {
    dispatch({ type: 'STORAGE_MIGRATING_SET', migrating: isMigrating });
  }, [isMigrating, dispatch]);

  // Persist settings changes to localStorage
  const selectionHistory = useSelector((s) => s.selectionHistory);
  useEffect(() => {
    saveSelectionHistory(selectionHistory);
  }, [selectionHistory]);

  const aiProvider = useSelector((s) => s.aiProvider);
  useEffect(() => {
    saveAIProvider(aiProvider);
  }, [aiProvider]);

  const physicsConfig = useSelector((s) => s.physicsConfig);
  useEffect(() => {
    savePhysicsConfig(physicsConfig);
  }, [physicsConfig]);

  // Mount effect hooks
  useAutoSave();
  useWindowResize();

  return null;
}
