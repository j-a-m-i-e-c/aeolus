// frontend/src/components/Layout.tsx — Main application shell.

import { useState } from "react";
import { Menu } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { DemoBanner } from "./DemoBanner";
import { AeolusLogo } from "./AeolusLogo";
import { AeolusWordmark } from "./AeolusWordmark";
import { useDashboardStore } from "../store/dashboard-store";

export function Layout({ children }: { children: React.ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const layoutConflict = useDashboardStore((s) => s.layoutConflict);
  const resetLayout = useDashboardStore((s) => s.resetLayout);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <div className="shrink-0"><DemoBanner /></div>
      {layoutConflict && (
        <div className="shrink-0 flex items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-100">
          <span>The dashboard changed in another browser. Your unsaved layout was not overwritten.</span>
          <button type="button" onClick={() => void resetLayout()} className="shrink-0 rounded-md border border-amber-400/40 px-3 py-1 font-medium hover:bg-amber-400/10">
            Reload latest layout
          </button>
        </div>
      )}
      <div className="md:hidden shrink-0 z-40 h-14 px-3 flex items-center gap-3 border-b border-[#2A3441] bg-surface/95 backdrop-blur">
        <button type="button" onClick={() => setMobileNavOpen(true)} className="w-10 h-10 inline-flex items-center justify-center rounded-lg border border-[#2A3441] text-[#9AA6B2] hover:text-[#E6EDF3] hover:bg-elevated/60 transition-colors" aria-label="Open navigation" aria-expanded={mobileNavOpen}>
          <Menu size={19} />
        </button>
        <AeolusLogo size={30} />
        <AeolusWordmark compact />
      </div>

      <div className="flex flex-1 min-h-0">
        <Sidebar mobileOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
        {mobileNavOpen && <button type="button" className="md:hidden fixed inset-0 z-40 bg-black/60" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation" />}
        <main className="flex-1 min-w-0 p-2.5 sm:p-4 md:p-6 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
