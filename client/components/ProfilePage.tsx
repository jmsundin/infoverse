import React, { useState } from 'react';

interface ProfilePageProps {
  user: {
    id: string;
    username: string;
    email?: string;
    isPaid?: boolean;
  };
  aiProvider: 'gemini' | 'huggingface';
  onSetAiProvider: (provider: 'gemini' | 'huggingface') => void;
  onClose: () => void;
  onUpdateUser: (updates: any) => void;
  onLogout: () => void;
}

export const ProfilePage: React.FC<ProfilePageProps> = ({ user, aiProvider, onSetAiProvider, onClose, onUpdateUser, onLogout }) => {
  const [activeTab, setActiveTab] = useState<'settings' | 'billing'>('settings');
  const [username, setUsername] = useState(user.username);
  const [email, setEmail] = useState(user.email || '');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setMessage('');

    try {
      const apiBase = (import.meta as any).env.VITE_API_URL || '';
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
        setMessage('Profile updated successfully');
        onUpdateUser({ username: data.user.username, email: data.user.email });
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

  return (
    <div className="fixed inset-0 bg-slate-900/90 z-[60] flex items-center justify-center p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
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
        </div>
      </div>
    </div>
  );
};

