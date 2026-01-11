import React, { useState, useCallback } from 'react';
import { PhysicsConfig } from '../types';
import { DEFAULT_PHYSICS_CONFIG } from '../constants';

interface PhysicsSettingsPanelProps {
  config: PhysicsConfig;
  onConfigChange: (config: Partial<PhysicsConfig>) => void;
  isSimulating?: boolean;
  onStopSimulation?: () => void;
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  unit?: string;
}

const Slider: React.FC<SliderProps> = ({
  label,
  value,
  min,
  max,
  step,
  onChange,
  unit = '',
}) => {
  return (
    <div className="mb-3">
      <div className="flex justify-between text-xs text-slate-400 mb-1">
        <span>{label}</span>
        <span className="font-mono">
          {value.toFixed(step < 1 ? 2 : 0)}{unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer
          [&::-webkit-slider-thumb]:appearance-none
          [&::-webkit-slider-thumb]:w-3
          [&::-webkit-slider-thumb]:h-3
          [&::-webkit-slider-thumb]:rounded-full
          [&::-webkit-slider-thumb]:bg-sky-500
          [&::-webkit-slider-thumb]:hover:bg-sky-400
          [&::-webkit-slider-thumb]:transition-colors"
      />
    </div>
  );
};

export const PhysicsSettingsPanel: React.FC<PhysicsSettingsPanelProps> = ({
  config,
  onConfigChange,
  isSimulating = false,
  onStopSimulation,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(true);

  const handleReset = useCallback(() => {
    onConfigChange(DEFAULT_PHYSICS_CONFIG);
  }, [onConfigChange]);

  const handleTogglePhysics = useCallback(() => {
    const newEnabled = !config.physicsEnabled;
    if (!newEnabled && onStopSimulation) {
      onStopSimulation();
    }
    onConfigChange({ physicsEnabled: newEnabled });
  }, [config.physicsEnabled, onConfigChange, onStopSimulation]);

  const isEnabled = config.physicsEnabled !== false;

  if (isCollapsed) {
    return (
      <button
        onClick={() => setIsCollapsed(false)}
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 px-3 py-2
          bg-slate-800/90 backdrop-blur border border-slate-700 rounded-lg
          text-slate-300 hover:bg-slate-700 hover:text-white transition-colors
          shadow-lg"
        title="Physics Settings"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-4 h-4"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        <span className="text-xs font-medium">Physics</span>
        {isSimulating && (
          <span className="w-2 h-2 bg-sky-500 rounded-full animate-pulse" />
        )}
      </button>
    );
  }

  return (
    <div
      className="fixed bottom-4 right-4 z-40 w-72 bg-slate-800/95 backdrop-blur
        border border-slate-700 rounded-lg shadow-xl"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700">
        <div className="flex items-center gap-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-4 h-4 text-slate-400"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          <span className="text-sm font-medium text-slate-200">Physics Settings</span>
          {isSimulating && (
            <span className="w-2 h-2 bg-sky-500 rounded-full animate-pulse" />
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Toggle switch */}
          <button
            onClick={handleTogglePhysics}
            className={`relative w-9 h-5 rounded-full transition-colors ${
              isEnabled ? 'bg-sky-500' : 'bg-slate-600'
            }`}
            title={isEnabled ? 'Disable physics' : 'Enable physics'}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                isEnabled ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
          <button
            onClick={() => setIsCollapsed(true)}
            className="p-1 text-slate-400 hover:text-white transition-colors"
            title="Collapse"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-4 h-4"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
      </div>

      {/* Sliders */}
      <div className={`p-3 space-y-1 ${!isEnabled ? 'opacity-50 pointer-events-none' : ''}`}>
        <Slider
          label="Spring Strength"
          value={config.springConstant}
          min={0.01}
          max={0.2}
          step={0.01}
          onChange={(v) => onConfigChange({ springConstant: v })}
        />

        <Slider
          label="Spring Length"
          value={config.springLength}
          min={50}
          max={500}
          step={10}
          unit="px"
          onChange={(v) => onConfigChange({ springLength: v })}
        />

        <Slider
          label="Child Follow Tightness"
          value={config.childFollowTightness}
          min={0.05}
          max={1}
          step={0.05}
          onChange={(v) => onConfigChange({ childFollowTightness: v })}
        />

        <Slider
          label="Damping"
          value={config.dampingFactor}
          min={0.5}
          max={0.99}
          step={0.01}
          onChange={(v) => onConfigChange({ dampingFactor: v })}
        />

        <Slider
          label="Gravity"
          value={config.gravityConstant}
          min={0}
          max={0.2}
          step={0.01}
          onChange={(v) => onConfigChange({ gravityConstant: v })}
        />

        <Slider
          label="Subtree Repulsion"
          value={Math.abs(config.subtreeRepulsionConstant)}
          min={0}
          max={5000}
          step={100}
          onChange={(v) => onConfigChange({ subtreeRepulsionConstant: -v })}
        />
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-slate-700">
        <button
          onClick={handleReset}
          className="w-full px-3 py-1.5 text-xs font-medium text-slate-400
            bg-slate-700/50 hover:bg-slate-700 hover:text-white
            rounded transition-colors"
        >
          Reset to Defaults
        </button>
      </div>
    </div>
  );
};
