// frontend/src/pages/DataStorePage.tsx — Top-level Data Store page
// Fetches config on mount; renders SetupWizard if disabled, DataExplorer if enabled.

import { useEffect } from "react";
import { useDataStoreStore } from "../store/data-store-store";
import { SetupWizard } from "./data-store/SetupWizard";
import { DataExplorer } from "./data-store/DataExplorer";

export function DataStorePage() {
  const fetchConfig = useDataStoreStore((s) => s.fetchConfig);
  const config = useDataStoreStore((s) => s.config);
  const enabled = useDataStoreStore((s) => s.enabled);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  // Loading state while config hasn't been fetched yet
  if (config === null) {
    return (
      <div className="flex items-center justify-center h-full min-h-[60vh]">
        <div className="text-[#6B7785] text-sm animate-pulse">Loading Data Store…</div>
      </div>
    );
  }

  if (!enabled) {
    return <SetupWizard />;
  }

  return <DataExplorer />;
}
