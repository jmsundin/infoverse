import { useState, useCallback, useMemo } from "react";
import { SidePanelLayout, SidePanelDockPosition } from "../components/SidePanel";

export type ActiveSidePane = {
  id: string;
  type: "web" | "node";
  data: string;
  layout?: SidePanelLayout;
  initialDockPosition?: SidePanelDockPosition;
  initialWidthPercent?: number;
};

export const useSidePanes = () => {
  const [activeSidePanes, setActiveSidePanes] = useState<ActiveSidePane[]>([]);
  const [sidePanelLayouts, setSidePanelLayouts] = useState<Record<string, SidePanelLayout>>({});

  const handleCloseSidePane = useCallback((id: string) => {
    setActiveSidePanes((prevPanes) => prevPanes.filter((pane) => pane.id !== id));
    setSidePanelLayouts((prevLayouts) => {
      const newLayouts = { ...prevLayouts };
      delete newLayouts[id];
      return newLayouts;
    });
  }, []);

  const handleSidePanelLayoutChange = useCallback((id: string, layout: SidePanelLayout) => {
    setSidePanelLayouts((prev) => ({ ...prev, [id]: layout }));
  }, []);

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

