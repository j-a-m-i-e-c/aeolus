// frontend/src/components/TabLayout.tsx — Renders active tab panes via react-grid-layout

import { useMemo, useCallback, useRef, useState, useEffect } from "react";
import { ResponsiveGridLayout, verticalCompactor } from "react-grid-layout";
import type { LayoutItem, Layout, ResponsiveLayouts } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { useDashboardStore } from "../store/dashboard-store";
import { getPaneEntry } from "../lib/pane-registry";
import { Settings, X, Plus, Zap } from "lucide-react";
import { PanePicker } from "./PanePicker";
import { PaneConfigPanel } from "./PaneConfigPanel";
import { motion } from "framer-motion";
import { useTabPermission } from "../hooks/useTabPermission";
import { PUBLIC_DEMO } from "../lib/env";

interface TabLayoutProps {
  tabId: string;
}

export function TabLayout({ tabId }: TabLayoutProps) {
  const panes = useDashboardStore((s) => s.panes);
  const updatePanePosition = useDashboardStore((s) => s.updatePanePosition);
  const updatePaneSize = useDashboardStore((s) => s.updatePaneSize);
  const removePane = useDashboardStore((s) => s.removePane);
  const resetLayout = useDashboardStore((s) => s.resetLayout);

  // Permission-based controls
  const { canInteract, canWrite: _canWrite, isAdmin } = useTabPermission(tabId);

  // Structural editing (add/remove/configure panes) remains admin-only. In the
  // hosted public demo, however, visitors may drag/resize the existing panes as
  // a local workspace experiment. dashboard-store deliberately never persists
  // those public-demo mutations, so another visitor can never inherit them.
  const canEditLayout = isAdmin;

  // PanePicker visibility
  const [showPicker, setShowPicker] = useState(false);

  // PaneConfigPanel state — tracks which pane is being configured
  const [configPaneId, setConfigPaneId] = useState<string | null>(null);

  // Add pane helper
  const addPane = useDashboardStore((s) => s.addPane);

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

  const isMobile = containerWidth < 768;
  const canArrangeLayout = (isAdmin || PUBLIC_DEMO) && !isMobile;

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
      minW: 1,
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

  const configPane = configPaneId ? tabPanes.find((p) => p.id === configPaneId) : null;

  const handleRemovePane = useCallback(
    (paneId: string) => {
      // Remove the pane only — do NOT delete the underlying automation.
      // Automation deletion is now an explicit, confirmed operation from the
      // automation editor/management surface (pre-promotion-release-gates Req 6.1, 6.4).
      removePane(paneId);
    },
    [removePane],
  );

  return (
    <div ref={containerRef} className="w-full">
      {/* Header area: admins get structural tools; public-demo visitors only get
          the compact reset action. Drag/resize is intentionally discoverable from
          the pane chrome itself rather than repeated explanatory copy on every tab. */}
      {(canEditLayout || (PUBLIC_DEMO && !isAdmin)) && (
      <div className="flex items-center justify-between gap-2 px-4 py-2">
        <div />
        <div className="flex items-center gap-2">
        {canEditLayout && (<>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          onClick={() => addPane(tabId, "automation")}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white border border-primary/40 transition-colors"
          style={{
            background: "linear-gradient(135deg, #3BA4FF, #5CE1E6)",
          }}
        >
          <Zap size={13} />
          New Automation Pane
        </motion.button>
        <button
          onClick={() => setShowPicker(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[#9AA6B2] hover:text-[#E6EDF3] hover:bg-elevated/50 border border-[#2A3441] transition-colors"
        >
          <Plus size={14} />
          Browse Panes
        </button>
        </>)}
        {PUBLIC_DEMO && !isAdmin && (<>
          <button onClick={() => addPane(tabId, "automation", { demoDraft: true, ruleName: "Demo Draft" })} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#5CE1E6] bg-[#3BA4FF]/10 hover:bg-[#3BA4FF]/20 border border-[#3BA4FF]/30 transition-colors">
            <Zap size={13} /> Try a New Automation
          </button>
          <button onClick={() => void resetLayout()} className="px-3 py-1.5 rounded-lg text-xs font-medium text-[#9AA6B2] hover:text-[#E6EDF3] hover:bg-elevated/50 border border-[#2A3441] transition-colors">Reset layout</button>
        </>)}
        </div>
      </div>
      )}

      {/* PanePicker modal */}
      {showPicker && (
        <PanePicker tabId={tabId} onClose={() => setShowPicker(false)} />
      )}

      <ResponsiveGridLayout
        className="layout"
        width={containerWidth}
        layouts={layouts}
        breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
        cols={{ lg: 12, md: 12, sm: 6, xs: 1, xxs: 1 }}
        rowHeight={60}
        onLayoutChange={(layout) => { if (!isMobile) handleLayoutChange(layout); }}
        dragConfig={{ enabled: canArrangeLayout, handle: ".pane-drag-handle" }}
        resizeConfig={{ enabled: canArrangeLayout, handles: ["se"] }}
        compactor={verticalCompactor}
      >
        {tabPanes.map((pane) => {
          const entry = getPaneEntry(pane.paneType);

          return (
            <div
              key={pane.id}
              className="relative bg-surface border border-[#2A3441] rounded-xl overflow-hidden flex flex-col"
            >
              {/* Header bar */}
              <div className={`pane-drag-handle flex items-center justify-between px-3 py-2 border-b border-[#2A3441] ${canArrangeLayout ? "cursor-grab" : "cursor-default"} bg-elevated/50`}>
                <span className="text-xs font-medium text-[#9AA6B2] truncate select-none">
                  {(pane.config.ruleName as string) || entry?.displayName || pane.paneType}
                </span>
                {(canEditLayout || (PUBLIC_DEMO && pane.config.demoDraft === true)) && (
                <div className="flex items-center gap-1 shrink-0">
                  {canEditLayout && <button className="p-1 rounded text-[#6B7785] hover:text-[#9AA6B2] hover:bg-elevated transition-colors" title="Pane settings" onMouseDown={(e) => e.stopPropagation()} onClick={() => setConfigPaneId(pane.id)}><Settings size={13} /></button>}
                  <button className="p-1 rounded text-[#6B7785] hover:text-[#EF4444] hover:bg-elevated transition-colors" title={PUBLIC_DEMO && pane.config.demoDraft === true ? "Discard local draft" : "Remove pane"} onMouseDown={(e) => e.stopPropagation()} onClick={() => handleRemovePane(pane.id)}><X size={13} /></button>
                </div>
                )}
              </div>

              {/* Pane content — wrapped with read-only overlay for read permission */}
              <div className={`flex-1 overflow-auto p-2 ${!canInteract ? "pointer-events-none opacity-75" : ""}`}>
                {entry ? (
                  <entry.component config={pane.config} paneId={pane.id} />
                ) : (
                  <div className="flex items-center justify-center h-full text-[#EF4444] text-sm">
                    Unknown pane type: {pane.paneType}
                  </div>
                )}
              </div>

              {/* Resize grip indicator — admins and public-demo visitors can arrange panes. */}
              {canArrangeLayout && (
              <div className="absolute bottom-1 right-1 text-[#2A3441] hover:text-[#6B7785] transition-colors pointer-events-none">
                <svg width="12" height="12" viewBox="0 0 12 12">
                  <circle cx="9" cy="9" r="1.5" fill="currentColor" />
                  <circle cx="5" cy="9" r="1.5" fill="currentColor" />
                  <circle cx="9" cy="5" r="1.5" fill="currentColor" />
                </svg>
              </div>
              )}
            </div>
          );
        })}
      </ResponsiveGridLayout>

      {/* PaneConfigPanel slide-out */}
      {configPane && (
        <PaneConfigPanel
          paneId={configPane.id}
          paneType={configPane.paneType}
          config={configPane.config}
          onClose={() => setConfigPaneId(null)}
        />
      )}
    </div>
  );
}
