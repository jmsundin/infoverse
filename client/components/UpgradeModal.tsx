import React, { useState } from 'react';

interface UpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const UpgradeModal: React.FC<UpgradeModalProps> = ({ isOpen, onClose }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleUpgrade = async () => {
    setIsLoading(true);
    setError('');
    try {
      const apiBase = (import.meta as any).env.VITE_API_URL || '/api';
      const res = await fetch(`${apiBase}/billing/checkout`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        }
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setError('Failed to start checkout. Please try again.');
        setIsLoading(false);
      }
    } catch (e) {
      console.error(e);
      setError('Error starting checkout. Please try again.');
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl max-w-md w-full overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="p-6 text-center">
          <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
            </svg>
          </div>
          
          <h2 className="text-2xl font-bold text-white mb-2">Upgrade to Unlimited</h2>
          <p className="text-slate-400 mb-6">
            You've reached the free limit of 100 nodes. 
            <br/><br/>
            Upgrade to the Pro Plan for just <strong>$8/month</strong> to get unlimited cloud storage, priority support, and advanced AI features.
          </p>
          
          {error && (
            <div className="bg-red-900/50 text-red-200 text-sm p-3 rounded mb-4">
              {error}
            </div>
          )}

          <div className="flex flex-col gap-3">
            <button
              onClick={handleUpgrade}
              disabled={isLoading}
              className="w-full py-3 bg-green-600 hover:bg-green-500 text-white font-bold rounded-lg shadow-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                   <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                   </svg>
                   Processing...
                </>
              ) : (
                'Upgrade Now ($8/mo)'
              )}
            </button>
            <button
              onClick={onClose}
              className="text-slate-500 hover:text-slate-400 text-sm mt-2"
            >
              No thanks, I'll delete some nodes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

