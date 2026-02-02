import React, { useCallback, useMemo } from 'react';
import { useSelector, useDispatch } from '../hooks/useAppStore';
import {
  selectGraphHot,
  selectGraphCold,
  selectPanelsSlice,
  shallowEqual,
} from '../store/selectors';
import { SidePanel, WebContent } from './SidePanel';
import { GraphNodeComponent } from './GraphNode';
import { ErrorBoundary } from './ErrorBoundary';
import { GraphNode } from '../types';

interface SidePanelsRendererProps {
  onExpandNode: (id: string, topic: string) => void;
  onNavigateToNode: (title: string) => void;
  onOpenLink: (url: string) => void;
}

export const SidePanelsRenderer: React.FC<SidePanelsRendererProps> = ({
  onExpandNode,
  onNavigateToNode,
  onOpenLink,
}) => {
  const dispatch = useDispatch();
  const graphHot = useSelector(selectGraphHot, shallowEqual);
  const graphCold = useSelector(selectGraphCold, shallowEqual);
  const panels = useSelector(selectPanelsSlice, shallowEqual);

  const handleCloseSidePane = useCallback((id: string) => {
    dispatch({ type: 'SIDE_PANE_REMOVE', id });
  }, [dispatch]);

  const handleSidePanelLayoutChange = useCallback((id: string, layout: any) => {
    dispatch({ type: 'SIDE_PANEL_LAYOUT_SET', id, layout });
  }, [dispatch]);

  const handleUpdateNode = useCallback(
    (id: string, updates: Partial<GraphNode>) => {
      dispatch({ type: 'NODE_UPDATE', id, updates });
    },
    [dispatch]
  );

  const handleDeleteNode = useCallback((id: string) => {
    dispatch({ type: 'DELETE_NODES', ids: [id] });
  }, [dispatch]);

  const handleMaximizeNode = useCallback(
    (id: string) => {
      const existing = panels.activeSidePanes.find((p) => p.type === 'node' && p.data === id);
      if (existing) {
        dispatch({ type: 'SIDE_PANE_REMOVE', id: existing.id });
      } else {
        dispatch({
          type: 'SIDE_PANE_ADD',
          pane: { id: crypto.randomUUID(), type: 'node', data: id, initialDockPosition: 'right' },
        });
      }
    },
    [panels.activeSidePanes, dispatch]
  );

  const getSidePanelContent = useCallback(
    (pane: any) => {
      const node = pane.type === 'node' ? graphHot.nodes.find((n) => n.id === pane.data) : null;
      return (
        <ErrorBoundary>
          {pane.type === 'web' ? (
            <WebContent
              url={pane.data}
              onClose={() => handleCloseSidePane(pane.id)}
              onWikipediaLinkClick={onOpenLink}
            />
          ) : node ? (
            <GraphNodeComponent
              node={node}
              allNodes={graphHot.nodes}
              viewMode="sidebar"
              onUpdate={handleUpdateNode}
              onExpand={onExpandNode}
              onDelete={handleDeleteNode}
              onToggleMaximize={handleMaximizeNode}
              onOpenLink={onOpenLink}
              onNavigateToNode={onNavigateToNode}
              autoGraphEnabled={graphCold.autoGraphEnabled}
              onSetAutoGraphEnabled={(v) => dispatch({ type: 'AUTO_GRAPH_SET', enabled: v })}
              cutNodeId={graphCold.cutNodeId}
              aiProvider={graphCold.aiProvider}
            />
          ) : (
            <div className="p-4 text-slate-500">Node not found.</div>
          )}
        </ErrorBoundary>
      );
    },
    [
      graphHot.nodes,
      graphCold.autoGraphEnabled,
      graphCold.cutNodeId,
      graphCold.aiProvider,
      handleCloseSidePane,
      handleUpdateNode,
      handleDeleteNode,
      handleMaximizeNode,
      onExpandNode,
      onNavigateToNode,
      onOpenLink,
      dispatch,
    ]
  );

  const sidePanels = useMemo(
    () =>
      panels.activeSidePanes.map((p) => (
        <SidePanel
          key={p.id}
          id={p.id}
          onClose={handleCloseSidePane}
          initialWidthPercent={p.initialWidthPercent}
          initialDockPosition={p.initialDockPosition}
          hideDefaultDragHandle={p.type === 'node'}
          onLayoutChange={handleSidePanelLayoutChange}
        >
          {getSidePanelContent(p)}
        </SidePanel>
      )),
    [panels.activeSidePanes, handleCloseSidePane, handleSidePanelLayoutChange, getSidePanelContent]
  );

  return <>{sidePanels}</>;
};
