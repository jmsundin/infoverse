import React, { useState, useCallback } from 'react';
import { MigrationProgress } from '../services/migration/types';
import { PhysicsConfig } from '../types';
import { DEFAULT_PHYSICS_CONFIG } from '../constants';
import { Slider } from './PhysicsSettingsPanel';

interface ProfilePageProps {
  user: {
    id: string;
    username: string;
    email?: string;
    isPaid?: boolean;
    isAdmin?: boolean;
    storagePath?: string;
  };
  aiProvider: 'gemini' | 'huggingface';
  onSetAiProvider: (provider: 'gemini' | 'huggingface') => void;
  onClose: () => void;
  onUpdateUser: (updates: any) => void;
  onLogout: () => void;
  // Storage tab props
  storageConnected?: boolean;
  storageDirName?: string | null;
  onOpenStorage?: () => void;
  onStartMigration?: () => void;
  migrationProgress?: MigrationProgress | null;
  // Physics props
  physicsConfig: PhysicsConfig;
  onPhysicsConfigChange: (config: Partial<PhysicsConfig>) => void;
  isSimulating?: boolean;
  onStopSimulation?: () => void;
}

export const ProfilePage: React.FC<ProfilePageProps> = ({
  user,
  aiProvider,
  onSetAiProvider,
  onClose,
  onUpdateUser,
  onLogout,
  storageConnected = false,
  storageDirName = null,
  onOpenStorage,
  onStartMigration,
  migrationProgress = null,
  physicsConfig,
  onPhysicsConfigChange,
  isSimulating = false,
  onStopSimulation,
}) => {
  const [activeTab, setActiveTab] = useState<'settings' | 'billing' | 'storage' | 'physics'>('settings');
  const [username, setUsername] = useState(user.username);
  const [email, setEmail] = useState(user.email || '');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [localPath, setLocalPath] = useState(user.storagePath || '');

  const handlePickPath = async () => {
    try {
       const apiBase = (import.meta as any).env.VITE_API_URL || '';
       const res = await fetch(`${apiBase}/api/system/pick-path`, { credentials: 'include' });
       const data = await res.json();
       if (data.path) {
         setLocalPath(data.path);
       }
    } catch (e) {
      console.error('Picker error:', e);
    }
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setMessage('');

    try {
      const apiBase = (import.meta as any).env.VITE_API_URL || '';
      
      // Update basic profile
      const res = await fetch(`${apiBase}/api/user/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          username,
          email,
          currentPassword: password,
          newPassword: newPassword || undefined
        }),
      });

      const data = await res.json();

      if (res.ok) {
         // Also update storage path setting if changed
         if (localPath !== user.storagePath) {
             const settingsRes = await fetch(`${apiBase}/api/user/settings`, {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json' },
                 credentials: 'include',
                 body: JSON.stringify({ storagePath: localPath })
             });
             if (settingsRes.ok) {
                 const settingsData = await settingsRes.json();
                 // Merge user data
                 onUpdateUser({ ...data.user, ...settingsData.user });
             } else {
                 onUpdateUser({ ...data.user });
                 setMessage('Profile updated but failed to save storage path');
                 setIsLoading(false);
                 return;
             }
         } else {
             onUpdateUser({ username: data.user.username, email: data.user.email });
         }

        setMessage('Profile updated successfully');
        setPassword('');
        setNewPassword('');
      } else {
        setMessage(data.message || 'Failed to update profile');
      }
    } catch (err) {
      setMessage('An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpgrade = async () => {
    try {
      const apiBase = (import.meta as any).env.VITE_API_URL || '';
      const res = await fetch(`${apiBase}/api/billing/checkout`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        credentials: 'include'
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setMessage('Failed to start checkout');
      }
    } catch (e) {
      console.error(e);
      setMessage('Error starting checkout');
    }
  };

  const handlePortal = async () => {
    try {
      const apiBase = (import.meta as any).env.VITE_API_URL || '';
      const res = await fetch(`${apiBase}/api/billing/portal`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        credentials: 'include'
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setMessage('Failed to open billing portal');
      }
    } catch (e) {
      console.error(e);
      setMessage('Error opening billing portal');
    }
  };

  const handleResetPhysics = useCallback(() => {
    onPhysicsConfigChange(DEFAULT_PHYSICS_CONFIG);
  }, [onPhysicsConfigChange]);

  const handleTogglePhysics = useCallback(() => {
    const newEnabled = !physicsConfig.physicsEnabled;
    if (!newEnabled && onStopSimulation) {
      onStopSimulation();
    }
    onPhysicsConfigChange({ physicsEnabled: newEnabled });
  }, [physicsConfig.physicsEnabled, onPhysicsConfigChange, onStopSimulation]);

  const isPhysicsEnabled = physicsConfig.physicsEnabled !== false;

  return (
    <div className="fixed inset-0 bg-slate-900/90 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-slate-700 flex justify-between items-center bg-slate-900/50">
          <h2 className="text-xl font-bold text-white">Account Settings</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">✕</button>
        </div>

        <div className="flex border-b border-slate-700">
          <button
            onClick={() => setActiveTab('settings')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              activeTab === 'settings' 
                ? 'bg-slate-700 text-sky-400 border-b-2 border-sky-400' 
                : 'text-slate-400 hover:bg-slate-750 hover:text-white'
            }`}
          >
            Profile & Security
          </button>
          <button
            onClick={() => setActiveTab('billing')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              activeTab === 'billing'
                ? 'bg-slate-700 text-sky-400 border-b-2 border-sky-400'
                : 'text-slate-400 hover:bg-slate-750 hover:text-white'
            }`}
          >
            Billing & Plan
          </button>
          <button
            onClick={() => setActiveTab('storage')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              activeTab === 'storage'
                ? 'bg-slate-700 text-sky-400 border-b-2 border-sky-400'
                : 'text-slate-400 hover:bg-slate-750 hover:text-white'
            }`}
          >
            Storage
          </button>
          <button
            onClick={() => setActiveTab('physics')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              activeTab === 'physics'
                ? 'bg-slate-700 text-sky-400 border-b-2 border-sky-400'
                : 'text-slate-400 hover:bg-slate-750 hover:text-white'
            }`}
          >
            Physics
            {isSimulating && (
              <span className="ml-2 inline-block w-2 h-2 bg-sky-500 rounded-full animate-pulse" />
            )}
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          {activeTab === 'settings' && (
            <form onSubmit={handleUpdateProfile} className="space-y-6">
              {message && (
                <div className={`p-3 rounded text-sm ${message.includes('success') ? 'bg-green-900/50 text-green-200' : 'bg-red-900/50 text-red-200'}`}>
                  {message}
                </div>
              )}
              
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-white border-b border-slate-700 pb-2">Personal Information</h3>
                
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">Username</label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white focus:border-sky-500 focus:outline-none"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">Email Address</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white focus:border-sky-500 focus:outline-none"
                    placeholder="your@email.com"
                  />
                </div>

                <div>
                   <label className="block text-sm font-medium text-slate-400 mb-1">Local Storage Path (Legacy)</label>
                   <div className="flex gap-2">
                       <input
                           type="text"
                           value={localPath}
                           onChange={(e) => setLocalPath(e.target.value)}
                           className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white focus:border-sky-500 focus:outline-none text-sm"
                           placeholder="/path/to/notes"
                       />
                       <button
                           type="button"
                           onClick={handlePickPath}
                           className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors text-sm"
                       >
                           Browse...
                       </button>
                   </div>
                   <p className="text-xs text-slate-500 mt-1">
                       Optional: Set a path on the server to store notes locally instead of the cloud.
                   </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">AI Provider</label>
                  <select
                    value={aiProvider}
                    onChange={(e) => onSetAiProvider(e.target.value as 'gemini' | 'huggingface')}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white focus:border-sky-500 focus:outline-none"
                  >
                    <option value="gemini">Google Gemini (Default)</option>
                    <option value="huggingface">Hugging Face (Open Models)</option>
                  </select>
                  <p className="text-xs text-slate-500 mt-1">
                    Choose which AI service powers the chat and expansion features.
                  </p>
                </div>
              </div>

              <div className="space-y-4 pt-4">
                <h3 className="text-lg font-semibold text-white border-b border-slate-700 pb-2">Change Password</h3>
                <p className="text-xs text-slate-500">Leave blank if you don't want to change it. Current password required for any changes.</p>
                
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">New Password</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white focus:border-sky-500 focus:outline-none"
                    placeholder="New password (optional)"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">Current Password <span className="text-red-400">*</span></label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white focus:border-sky-500 focus:outline-none"
                    required
                    placeholder="Required to save changes"
                  />
                </div>
              </div>

              <div className="pt-4 flex justify-between items-center border-t border-slate-700 mt-6">
                <button
                  type="button"
                  onClick={onLogout}
                  className="text-red-400 hover:text-red-300 text-sm font-bold hover:underline"
                >
                  Sign Out
                </button>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="px-6 py-2 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded-lg shadow-lg transition-all disabled:opacity-50"
                >
                  {isLoading ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          )}

          {activeTab === 'billing' && (
            <div className="space-y-6">
              <div className="bg-slate-900 rounded-lg p-6 border border-slate-700">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-lg font-bold text-white">Current Plan</h3>
                    <p className="text-slate-400 mt-1">
                      {user.isPaid ? 'Unlimited Pro Plan' : 'Free Plan'}
                    </p>
                  </div>
                  <div className={`px-3 py-1 rounded-full text-xs font-bold ${user.isPaid ? 'bg-green-900 text-green-200' : 'bg-slate-700 text-slate-300'}`}>
                    {user.isPaid ? 'ACTIVE' : 'FREE'}
                  </div>
                </div>

                <div className="mt-6 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Cloud Storage</span>
                    <span className="text-white">{user.isPaid ? 'Unlimited' : '100 Nodes'}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">AI Features</span>
                    <span className="text-white">Enabled</span>
                  </div>
                </div>

                {!user.isPaid && (
                  <div className="mt-6 pt-6 border-t border-slate-800">
                    <h4 className="text-white font-bold mb-2">Upgrade to Pro</h4>
                    <p className="text-sm text-slate-400 mb-4">Get unlimited cloud storage and priority support for just $8/month.</p>
                    <button 
                        onClick={handleUpgrade}
                        className="w-full py-2 bg-green-600 hover:bg-green-500 text-white font-bold rounded-lg transition-colors"
                    >
                      Upgrade Now ($8/mo)
                    </button>
                  </div>
                )}

                {user.isPaid && (
                  <div className="mt-6 pt-6 border-t border-slate-800">
                    <button
                        onClick={handlePortal}
                        className="text-sm text-red-400 hover:text-red-300 hover:underline"
                    >
                      Manage / Cancel Subscription
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'storage' && (
            <div className="space-y-6">
              {/* Directory Connection Section */}
              <div className="bg-slate-900 rounded-lg p-6 border border-slate-700">
                <h3 className="text-lg font-bold text-white mb-4">Local Storage</h3>

                {/* Connection Status */}
                <div className="flex items-center gap-3 mb-4">
                  <div
                    className={`w-3 h-3 rounded-full ${
                      storageConnected ? 'bg-green-500' : 'bg-slate-500'
                    }`}
                  />
                  <span className="text-slate-300">
                    {storageConnected ? storageDirName || 'Connected' : 'Not connected'}
                  </span>
                </div>

                {/* Directory Picker Button */}
                {onOpenStorage && (
                  <button
                    onClick={onOpenStorage}
                    className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg transition-colors"
                  >
                    {storageConnected ? 'Change Directory' : 'Select Directory'}
                  </button>
                )}
              </div>

              {/* Schema Migration Section */}
              <div className="bg-slate-900 rounded-lg p-6 border border-slate-700">
                <h3 className="text-lg font-bold text-white mb-2">Schema Migration</h3>
                <p className="text-sm text-slate-400 mb-4">
                  Validate and repair node metadata to match current schema requirements.
                  This will generate missing titles and fix invalid field values.
                </p>

                {/* Migration Controls */}
                {onStartMigration && (
                  <button
                    onClick={onStartMigration}
                    disabled={!storageConnected || migrationProgress?.isRunning}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
                  >
                    {migrationProgress?.isRunning ? 'Migration Running...' : 'Start Migration'}
                  </button>
                )}

                {/* Progress Display */}
                {migrationProgress && migrationProgress.totalNodes > 0 && (
                  <div className="mt-4 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">Progress</span>
                      <span className="text-white">
                        {migrationProgress.processedNodes} / {migrationProgress.totalNodes}
                      </span>
                    </div>
                    <div className="w-full bg-slate-700 rounded-full h-2">
                      <div
                        className="bg-sky-500 h-2 rounded-full transition-all"
                        style={{
                          width: `${
                            migrationProgress.totalNodes > 0
                              ? (migrationProgress.processedNodes / migrationProgress.totalNodes) * 100
                              : 0
                          }%`,
                        }}
                      />
                    </div>
                    <p className="text-xs text-slate-500">{migrationProgress.currentStatus}</p>
                    {migrationProgress.nodesNeedingUpdates > 0 && (
                      <p className="text-xs text-amber-400">
                        {migrationProgress.nodesNeedingUpdates} nodes updated
                      </p>
                    )}
                  </div>
                )}

                {/* Last Migration Info */}
                {migrationProgress?.lastMigrationTimestamp && !migrationProgress.isRunning && (
                  <p className="mt-4 text-xs text-slate-500">
                    Last migration: {new Date(migrationProgress.lastMigrationTimestamp).toLocaleString()}
                  </p>
                )}
              </div>
            </div>
          )}

          {activeTab === 'physics' && (
            <div className="space-y-6">
              <div className="bg-slate-900 rounded-lg p-6 border border-slate-700">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-bold text-white">Physics Simulation</h3>
                    {isSimulating && (
                      <span className="w-2 h-2 bg-sky-500 rounded-full animate-pulse" />
                    )}
                  </div>
                  <button
                    onClick={handleTogglePhysics}
                    className={`relative w-11 h-6 rounded-full transition-colors ${
                      isPhysicsEnabled ? 'bg-sky-500' : 'bg-slate-600'
                    }`}
                    title={isPhysicsEnabled ? 'Disable physics' : 'Enable physics'}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                        isPhysicsEnabled ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
                <p className="text-sm text-slate-400 mb-4">
                  Configure how nodes interact with physics forces on the canvas.
                </p>

                <div className={`space-y-1 ${!isPhysicsEnabled ? 'opacity-50 pointer-events-none' : ''}`}>
                  <Slider
                    label="Spring Strength"
                    value={physicsConfig.springConstant}
                    min={0.01}
                    max={0.2}
                    step={0.01}
                    onChange={(v) => onPhysicsConfigChange({ springConstant: v })}
                  />

                  <Slider
                    label="Spring Length"
                    value={physicsConfig.springLength}
                    min={50}
                    max={500}
                    step={10}
                    unit="px"
                    onChange={(v) => onPhysicsConfigChange({ springLength: v })}
                  />

                  <Slider
                    label="Child Follow Tightness"
                    value={physicsConfig.childFollowTightness}
                    min={0.05}
                    max={1}
                    step={0.05}
                    onChange={(v) => onPhysicsConfigChange({ childFollowTightness: v })}
                  />

                  <Slider
                    label="Damping"
                    value={physicsConfig.dampingFactor}
                    min={0.5}
                    max={0.99}
                    step={0.01}
                    onChange={(v) => onPhysicsConfigChange({ dampingFactor: v })}
                  />

                  <Slider
                    label="Gravity"
                    value={physicsConfig.gravityConstant}
                    min={0}
                    max={0.2}
                    step={0.01}
                    onChange={(v) => onPhysicsConfigChange({ gravityConstant: v })}
                  />

                  <Slider
                    label="Subtree Repulsion"
                    value={Math.abs(physicsConfig.subtreeRepulsionConstant)}
                    min={0}
                    max={5000}
                    step={100}
                    onChange={(v) => onPhysicsConfigChange({ subtreeRepulsionConstant: -v })}
                  />
                </div>

                <div className="mt-4 pt-4 border-t border-slate-700">
                  <button
                    onClick={handleResetPhysics}
                    className="w-full px-4 py-2 text-sm font-medium text-slate-400
                      bg-slate-700/50 hover:bg-slate-700 hover:text-white
                      rounded-lg transition-colors"
                  >
                    Reset to Defaults
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

