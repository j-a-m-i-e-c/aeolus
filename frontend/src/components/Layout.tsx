// frontend/src/components/Layout.tsx — Main application shell.

import { useState } from "react";
import { Menu } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { DemoBanner } from "./DemoBanner";
import { AeolusLogo } from "./AeolusLogo";

export function Layout({ children }: { children: React.ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <DemoBanner />
      <div className="md:hidden sticky top-0 z-40 h-14 px-3 flex items-center gap-3 border-b border-[#2A3441] bg-surface/95 backdrop-blur">
        <button type="button" onClick={() => setMobileNavOpen(true)} className="w-10 h-10 inline-flex items-center justify-center rounded-lg border border-[#2A3441] text-[#9AA6B2] hover:text-[#E6EDF3] hover:bg-elevated/60 transition-colors" aria-label="Open navigation" aria-expanded={mobileNavOpen}>
          <Menu size={19} />
        </button>
        <AeolusLogo size={30} />
        <span className="font-semibold text-primary">Aeolus</span>
      </div>

      <div className="flex flex-1 min-h-0">
        <Sidebar mobileOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
        {mobileNavOpen && <button type="button" className="md:hidden fixed inset-0 z-40 bg-black/60" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation" />}
        <main className="flex-1 min-w-0 p-2.5 sm:p-4 md:p-6 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
