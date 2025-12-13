
import React, { useState, useMemo } from 'react';
import { GraphNode, NodeType } from '../types';
import { NODE_COLORS } from '../constants';

interface NodeListDrawerProps {
  nodes: GraphNode[];
  isOpen: boolean;
  onClose: () => void;
  onSelectNode: (nodeId: string) => void;
  onUpdateNode: (id: string, updates: Partial<GraphNode>) => void;
}

export const NodeListDrawer: React.FC<NodeListDrawerProps> = ({ nodes, isOpen, onClose, onSelectNode, onUpdateNode }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | NodeType>('ALL');
  const filterOptions = useMemo<{ label: string; value: 'ALL' | NodeType }[]>(() => [
    { label: 'All', value: 'ALL' },
    { label: 'Chat', value: NodeType.CHAT },
    { label: 'Note', value: NodeType.NOTE },
  ], []);

  const filterCounts = useMemo<Record<'ALL' | NodeType, number>>(() => {
    const chatCount = nodes.filter(node => node.type === NodeType.CHAT).length;
    const noteCount = nodes.filter(node => node.type === NodeType.NOTE).length;
    return {
      ALL: nodes.length,
      [NodeType.CHAT]: chatCount,
      [NodeType.NOTE]: noteCount,
    };
  }, [nodes]);

  const filteredNodes = useMemo(() => {
    const scopedNodes = typeFilter === 'ALL' ? nodes : nodes.filter(node => node.type === typeFilter);

    if (!searchTerm.trim()) {
      return [...scopedNodes].sort((a, b) => (a.content || 'Untitled').localeCompare(b.content || 'Untitled'));
    }

    const lowerTerm = searchTerm.toLowerCase();
    const terms = lowerTerm.split(/\s+/).filter(t => t.length > 0);

    return scopedNodes.filter(node => {
      const content = (node.content || '').toLowerCase();
      // "Fuzzy" check: all typed terms must appear in the content
      return terms.every(term => content.includes(term));
    }).sort((a, b) => (a.content || 'Untitled').localeCompare(b.content || 'Untitled'));
  }, [nodes, searchTerm, typeFilter]);

  const handleStartEdit = (e: React.MouseEvent | React.TouchEvent, node: GraphNode) => {
      e.stopPropagation();
      setEditingNodeId(node.id);
      setEditValue(node.content);
  };

  const handleSaveEdit = () => {
      if (editingNodeId && editValue.trim()) {
          onUpdateNode(editingNodeId, { content: editValue });
      }
      setEditingNodeId(null);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex font-sans">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity animate-in fade-in duration-200" 
        onClick={onClose}
      />
      
      {/* Drawer */}
      <div className="relative w-80 bg-slate-900 border-r border-slate-700 shadow-2xl flex flex-col h-full transform transition-transform animate-in slide-in-from-left duration-200">
        <div className="p-4 border-b border-slate-800 flex flex-col gap-3 shrink-0 bg-slate-900 z-10">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
              <span className="text-xl">☰</span> Node List
              <span className="text-xs font-normal text-slate-500 bg-slate-800 px-2 py-0.5 rounded-full">{nodes.length}</span>
            </h2>
            <button onClick={onClose} className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </div>
          
          {/* Drawer Search */}
          <div className="space-y-2">
            <div className="relative">
               <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
                  <svg className="h-3.5 w-3.5 text-slate-500" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
               </div>
               <input 
                  type="text"
                  placeholder="Find a node..."
                  className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg py-1.5 pl-8 pr-3 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-all placeholder-slate-500"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  autoFocus={!editingNodeId}
               />
            </div>
            <div className="grid grid-cols-3 gap-1.5 text-[11px] font-bold uppercase w-full max-w-[180px]">
              {filterOptions.map(option => {
                const isActive = typeFilter === option.value;
                return (
                  <button
                    key={option.value}
                    onClick={() => setTypeFilter(option.value)}
                    className={`px-2 py-1 rounded-md border transition-colors flex items-center justify-between gap-1 ${
                      isActive
                        ? 'border-sky-500 bg-sky-900/40 text-sky-300'
                        : 'border-slate-700 bg-slate-800/80 text-slate-400 hover:border-slate-600'
                    }`}
                  >
                    <span className="text-[10px] font-normal tracking-wide text-slate-500">
                      {filterCounts[option.value]}
                    </span>
                    <span>{option.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-2 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
          {filteredNodes.length === 0 ? (
            <div className="text-slate-500 text-center p-8 flex flex-col items-center gap-2">
               {searchTerm ? (
                 <>
                   <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="opacity-50"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                   <p className="text-sm">No nodes found for "{searchTerm}"</p>
                 </>
               ) : typeFilter !== 'ALL' ? (
                 <>
                   <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="opacity-50"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                   <p className="text-sm">No {typeFilter.toLowerCase()} nodes yet.</p>
                 </>
               ) : (
                 <>
                   <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="opacity-50"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                   <p className="text-sm">No nodes created yet.</p>
                 </>
               )}
            </div>
          ) : (
            <ul className="space-y-1">
              {filteredNodes.map(node => {
                const colorKey = node.color || 'slate';
                const color = NODE_COLORS[colorKey];
                const isEditing = editingNodeId === node.id;

                return (
                  <li key={node.id}>
                    <div
                      className={`w-full text-left p-3 rounded-lg ${isEditing ? 'bg-slate-800 ring-1 ring-sky-500' : 'hover:bg-slate-800 border border-transparent hover:border-slate-700/50'} transition-all flex items-center gap-3 group relative cursor-pointer`}
                      onClick={() => !isEditing && onSelectNode(node.id)}
                    >
                      <div className={`w-3 h-3 rounded-full ${color.indicator} shadow-[0_0_8px_rgba(0,0,0,0.5)] group-hover:scale-110 transition-transform shrink-0`} />
                      
                      <div className="flex-1 min-w-0">
                        {isEditing ? (
                             <input 
                                type="text"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onBlur={handleSaveEdit}
                                onKeyDown={(e) => e.key === 'Enter' && handleSaveEdit()}
                                className="w-full bg-black/30 border border-slate-600 rounded px-1.5 py-0.5 text-sm text-white focus:outline-none focus:border-sky-500"
                                autoFocus
                                onClick={(e) => e.stopPropagation()}
                             />
                        ) : (
                            <div 
                                className="text-slate-200 font-medium truncate text-sm group-hover:text-sky-400 transition-colors"
                                onDoubleClick={(e) => handleStartEdit(e, node)}
                                title="Double click to rename"
                            >
                                {node.content || 'Untitled Node'}
                            </div>
                        )}

                        <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] uppercase font-bold text-slate-500 bg-slate-800/50 px-1.5 py-0.5 rounded border border-slate-700/50">
                                {node.type}
                            </span>
                            {node.messages && node.messages.length > 0 && (
                                <span className="text-[10px] text-slate-500 flex items-center gap-0.5">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                                    {node.messages.length}
                                </span>
                            )}
                        </div>
                      </div>
                      
                      {/* Edit Button (visible on hover) */}
                      {!isEditing && (
                          <button 
                             className="p-1.5 text-slate-500 hover:text-sky-400 opacity-0 group-hover:opacity-100 transition-opacity"
                             onClick={(e) => handleStartEdit(e, node)}
                             title="Rename Node"
                          >
                             <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                          </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};
