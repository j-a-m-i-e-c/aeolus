// frontend/src/pages/DataStorePage.tsx — Top-level Data page
//
// Fetches Data Store config on mount and renders the explorer. It deliberately
// does NOT gate the whole page on historical Data Store enablement any more
// (ADR-0016): Shared State is a core facility and stays browseable, so the
// enable/setup flow belongs inside the Collections and Storage tabs rather than
// in front of everything.

import { useEffect } from "react";
import { useDataStoreStore } from "../store/data-store-store";
import { DataExplorer } from "./data-store/DataExplorer";

export function DataStorePage() {
  const fetchConfig = useDataStoreStore((s) => s.fetchConfig);
  const config = useDataStoreStore((s) => s.config);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  // Config is still needed before rendering, because it decides what the
  // Collections and Storage tabs show — but not whether the page appears.
  if (config === null) {
    return (
      <div className="flex items-center justify-center h-full min-h-[60vh]">
        <div className="text-[#6B7785] text-sm animate-pulse">Loading Data…</div>
      </div>
    );
  }

  return <DataExplorer />;
}
