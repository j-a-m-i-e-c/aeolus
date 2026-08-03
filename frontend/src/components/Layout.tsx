// frontend/src/components/Layout.tsx — Main layout with sidebar

import { Sidebar } from "./Sidebar";
import { DemoBanner } from "./DemoBanner";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* Persistent public-demo banner (renders only in demo mode). */}
      <DemoBanner />
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <main className="flex-1 p-6 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
