import React, { useEffect, useState, useRef } from 'react';

interface ToastProps {
  message: string;
  onUndo?: () => void;
  duration?: number;
  onClose: () => void;
  visible: boolean;
}

export const Toast: React.FC<ToastProps> = ({ 
  message, 
  onUndo, 
  duration = 5000, 
  onClose,
  visible 
}) => {
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (visible && duration > 0) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        onClose();
      }, duration);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [visible, duration, onClose]);

  if (!visible) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-4 bg-slate-800 text-white px-6 py-3 rounded-full shadow-2xl border border-slate-700 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <span className="text-sm font-medium">{message}</span>
      {onUndo && (
        <button 
          onClick={onUndo}
          className="text-sky-400 hover:text-sky-300 text-sm font-bold uppercase tracking-wide hover:underline focus:outline-none"
        >
          Undo
        </button>
      )}
      <button 
        onClick={onClose}
        className="ml-2 text-slate-500 hover:text-white"
        title="Dismiss"
      >
        ✕
      </button>
    </div>
  );
};

