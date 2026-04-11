// frontend/src/components/TabLayout.tsx — Renders active tab panes via react-grid-layout

import { useMemo, useCallback, useRef, useState, useEffect } from "react";
import { ResponsiveGridLayout, verticalCompactor } from "react-grid-layout";
import type { LayoutItem, Layout, ResponsiveLayouts } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { useDashboardStore } from "../store/dashboard-store";
import { getPaneEntry } from "../lib/pane-registry";
import { Settings, X } from "lucide-react";

interface TabLayoutProps {
  tabId: string;
}

export function TabLayout({ tabId }: TabLayoutProps) {
  const panes = useDashboardStore((s) => s.panes);
  const updatePanePosition = useDashboardStore((s) => s.updatePanePosition);
  const updatePaneSize = useDashboardStore((s) => s.updatePaneSize);
  const removePane = useDashboardStore((s) => s.removePane);

  // Track container width for ResponsiveGridLayout
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(1200);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    setContainerWidth(el.clientWidth || 1200);
    return () => ro.disconnect();
  }, []);

  const tabPanes = useMemo(
    () => panes.filter((p) => p.tabId === tabId),
    [panes, tabId],
  );

  const layouts: ResponsiveLayouts = useMemo(() => {
    const lg: LayoutItem[] = tabPanes.map((p) => ({
      i: p.id,
      x: p.x,
      y: p.y,
      w: p.w,
      h: p.h,
      minW: 2,
      minH: 2,
    }));
    return { lg };
  }, [tabPanes]);

  const handleLayoutChange = useCallback(
    (layout: Layout) => {
      for (const item of layout) {
        const pane = tabPanes.find((p) => p.id === item.i);
        if (!pane) continue;
        if (pane.x !== item.x || pane.y !== item.y) {
          updatePanePosition(item.i, item.x, item.y);
        }
        if (pane.w !== item.w || pane.h !== item.h) {
          updatePaneSize(item.i, item.w, item.h);
        }
      }
    },
    [tabPanes, updatePanePosition, updatePaneSize],
  );

  return (
    <div ref={containerRef} className="w-full">
      <ResponsiveGridLayout
        className="layout"
        width={containerWidth}
        layouts={layouts}
        breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
        cols={{ lg: 12, md: 12, sm: 6, xs: 4, xxs: 2 }}
        rowHeight={60}
        onLayoutChange={handleLayoutChange}
        dragConfig={{ enabled: true, handle: ".pane-drag-handle" }}
        resizeConfig={{ enabled: true, handles: ["se"] }}
        compactor={verticalCompactor}
      >
        {tabPanes.map((pane) => {
          const entry = getPaneEntry(pane.paneType);

          return (
            <div
              key={pane.id}
              className="bg-surface border border-[#2A3441] rounded-xl overflow-hidden flex flex-col"
            >
              {/* Header bar */}
              <div className="pane-drag-handle flex items-center justify-between px-3 py-2 border-b border-[#2A3441] cursor-grab bg-elevated/50">
                <span className="text-xs font-medium text-[#9AA6B2] truncate select-none">
                  {entry?.displayName ?? pane.paneType}
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    className="p-1 rounded text-[#6B7785] hover:text-[#9AA6B2] hover:bg-elevated transition-colors"
                    title="Pane settings"
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <Settings size={13} />
                  </button>
                  <button
                    className="p-1 rounded text-[#6B7785] hover:text-[#EF4444] hover:bg-elevated transition-colors"
                    title="Remove pane"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => removePane(pane.id)}
                  >
                    <X size={13} />
                  </button>
                </div>
              </div>

              {/* Pane content */}
              <div className="flex-1 overflow-auto p-2">
                {entry ? (
                  <entry.component config={pane.config} />
                ) : (
                  <div className="flex items-center justify-center h-full text-[#EF4444] text-sm">
                    Unknown pane type: {pane.paneType}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </ResponsiveGridLayout>
    </div>
  );
}
