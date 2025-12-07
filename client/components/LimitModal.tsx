import React from 'react';

interface LimitModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLogin: () => void;
  onSignup: () => void;
}

export const LimitModal: React.FC<LimitModalProps> = ({ isOpen, onClose, onLogin, onSignup }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl max-w-md w-full overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="p-6 text-center">
          <div className="w-16 h-16 bg-amber-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path>
            </svg>
          </div>
          
          <h2 className="text-2xl font-bold text-white mb-2">Daily Limit Reached</h2>
          <p className="text-slate-400 mb-6">
            You've reached your free limit of 10 requests for the next 5 hours.
            <br/><br/>
            Please sign up or log in to continue exploring freely and save your graphs.
          </p>

          <div className="flex flex-col gap-3">
            <button
              onClick={onSignup}
              className="w-full py-3 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded-lg shadow-lg transition-all"
            >
              Create Free Account
            </button>
            <button
              onClick={onLogin}
              className="w-full py-3 bg-slate-700 hover:bg-slate-600 text-white font-bold rounded-lg transition-all"
            >
              Log In
            </button>
            <button
              onClick={onClose}
              className="text-slate-500 hover:text-slate-400 text-sm mt-2"
            >
              Maybe later
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

