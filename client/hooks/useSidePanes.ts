import { useCallback, useMemo } from "react";
import { useSelector, useDispatch } from "./useAppStore";
import { SidePanelLayout, SidePanelDockPosition } from "../components/SidePanel";

export type ActiveSidePane = {
  id: string;
  type: "web" | "node";
  data: string;
  layout?: SidePanelLayout;
  initialDockPosition?: SidePanelDockPosition;
  initialWidthPercent?: number;
};

/**
 * Hook for managing side panels via the AppStore.
 * Thin adapter that wraps store selectors and dispatches.
 */
export const useSidePanes = () => {
  const dispatch = useDispatch();
  const activeSidePanes = useSelector((s) => s.activeSidePanes);
  const sidePanelLayouts = useSelector((s) => s.sidePanelLayouts);

  const setActiveSidePanes = useCallback(
    (panes: ActiveSidePane[] | ((prev: ActiveSidePane[]) => ActiveSidePane[])) => {
      if (typeof panes === 'function') {
        dispatch({ type: 'SIDE_PANES_SET', panes: panes(activeSidePanes) });
      } else {
        dispatch({ type: 'SIDE_PANES_SET', panes });
      }
    },
    [dispatch, activeSidePanes]
  );

  const setSidePanelLayouts = useCallback(
    (layouts: Record<string, SidePanelLayout> | ((prev: Record<string, SidePanelLayout>) => Record<string, SidePanelLayout>)) => {
      // For now, we don't have a bulk layout set action, so this is a no-op
      // Individual layout changes should use handleSidePanelLayoutChange
      console.warn('setSidePanelLayouts is deprecated, use handleSidePanelLayoutChange instead');
    },
    []
  );

  const handleCloseSidePane = useCallback((id: string) => {
    dispatch({ type: 'SIDE_PANE_REMOVE', id });
  }, [dispatch]);

  const handleSidePanelLayoutChange = useCallback((id: string, layout: SidePanelLayout) => {
    dispatch({ type: 'SIDE_PANEL_LAYOUT_SET', id, layout });
  }, [dispatch]);

  const isAnyPanelResizing = useMemo(
    () => Object.values(sidePanelLayouts).some((l) => l.isResizing),
    [sidePanelLayouts]
  );

  return {
    activeSidePanes,
    setActiveSidePanes,
    sidePanelLayouts,
    setSidePanelLayouts,
    handleCloseSidePane,
    handleSidePanelLayoutChange,
    isAnyPanelResizing,
  };
};
