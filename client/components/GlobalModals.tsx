import React from 'react';
import { useSelector, useDispatch } from '../hooks/useAppStore';
import { useAuth } from '../context/AuthContext';
import {
  selectModalsSlice,
  selectGraphCold,
  selectStorageSlice,
  selectAuthSlice,
  shallowEqual,
} from '../store/selectors';
import { PendingExpansion } from '../types';
import { AuthPage } from './AuthPage';
import { ProfilePage } from './ProfilePage';
import { LimitModal } from './LimitModal';
import { UpgradeModal } from './UpgradeModal';
import { DuplicateWarningModal } from './DuplicateWarningModal';
import { Toast } from './Toast';
import { ErrorBoundary } from './ErrorBoundary';
import { MigrationProgressBar } from './MigrationProgressBar';

interface GlobalModalsProps {
  // Expansion-related
  pendingExpansion: PendingExpansion | null;
  onCreateAllAnyway: () => void;
  onLinkToExisting: (mapping: Map<number, string>) => void;
  onCancelExpansion: () => void;

  // Profile-related
  onOpenStorage: () => Promise<void>;
  onStartMigration: () => Promise<void>;
  onLogout: () => Promise<void>;
}

export const GlobalModals: React.FC<GlobalModalsProps> = ({
  pendingExpansion,
  onCreateAllAnyway,
  onLinkToExisting,
  onCancelExpansion,
  onOpenStorage,
  onStartMigration,
  onLogout,
}) => {
  const dispatch = useDispatch();
  const { login } = useAuth();

  const modals = useSelector(selectModalsSlice, shallowEqual);
  const graphCold = useSelector(selectGraphCold, shallowEqual);
  const storage = useSelector(selectStorageSlice, shallowEqual);
  const auth = useSelector(selectAuthSlice, shallowEqual);
  const toast = useSelector((s) => s.toast);

  return (
    <>
      {/* Auth Modal */}
      {modals.showAuth && (
        <div className="fixed inset-0 z-[100]">
          <ErrorBoundary>
            <AuthPage
              initialMode={modals.authMode}
              onLogin={async (u) => {
                login(u);
                dispatch({ type: 'MODAL_AUTH_HIDE' });
              }}
              onCancel={() => dispatch({ type: 'MODAL_AUTH_HIDE' })}
            />
          </ErrorBoundary>
        </div>
      )}

      {/* Profile Modal */}
      {modals.showProfile && auth.user && (
        <ErrorBoundary>
          <ProfilePage
            user={auth.user}
            aiProvider={graphCold.aiProvider}
            onSetAiProvider={(provider) => dispatch({ type: 'AI_PROVIDER_SET', provider })}
            onClose={() => dispatch({ type: 'MODAL_PROFILE_HIDE' })}
            onUpdateUser={(upd) => dispatch({ type: 'AUTH_USER_UPDATE', updates: upd })}
            onLogout={onLogout}
            storageConnected={!!storage.dirHandle || !!auth.user?.storagePath}
            storageDirName={storage.dirName || auth.user?.storagePath || null}
            onOpenStorage={onOpenStorage}
            onStartMigration={onStartMigration}
            migrationProgress={storage.migrationProgress}
            physicsConfig={graphCold.physicsConfig}
            onPhysicsConfigChange={(config) => dispatch({ type: 'PHYSICS_CONFIG_SET', config })}
            isSimulating={false}
            onStopSimulation={() => {}}
          />
        </ErrorBoundary>
      )}

      {/* Upgrade Modal */}
      <UpgradeModal
        isOpen={modals.showUpgradeModal}
        onClose={() => dispatch({ type: 'MODAL_UPGRADE_HIDE' })}
      />

      {/* Limit Modal */}
      <LimitModal
        isOpen={modals.showLimitModal}
        onClose={() => dispatch({ type: 'MODAL_LIMIT_HIDE' })}
        onLogin={() => {
          dispatch({ type: 'MODAL_LIMIT_HIDE' });
          dispatch({ type: 'MODAL_AUTH_SHOW', mode: 'login' });
        }}
        onSignup={() => {
          dispatch({ type: 'MODAL_LIMIT_HIDE' });
          dispatch({ type: 'MODAL_AUTH_SHOW', mode: 'signup' });
        }}
      />

      {/* Duplicate Warning Modal */}
      <DuplicateWarningModal
        isOpen={!!pendingExpansion}
        duplicates={pendingExpansion?.duplicates || []}
        onCreateAll={onCreateAllAnyway}
        onLinkToExisting={onLinkToExisting}
        onCancel={onCancelExpansion}
      />

      {/* Toast */}
      <Toast
        message={toast.message}
        visible={toast.visible}
        onUndo={toast.action}
        onClose={() => dispatch({ type: 'TOAST_HIDE' })}
      />

      {/* Migration Progress Bar */}
      {storage.migrationProgress?.isRunning && (
        <MigrationProgressBar
          progress={storage.migrationProgress}
          onCancel={() => {
            // Import getMigrationService dynamically to avoid circular deps
            import('../services/migration/MigrationService').then(({ getMigrationService }) => {
              getMigrationService().cancel();
            });
          }}
        />
      )}
    </>
  );
};
