// frontend/src/pages/data-store/DataExplorer.tsx — The Data page: Shared State, Collections, Storage
//
// Two distinct concepts live here, and the tab order says which is which
// (ADR-0016):
//
//   Shared State  durable current values shared between automations — always available
//   Collections   optional historical observations, with retention and storage limits
//   Storage       configuration for that historical accumulation
//
// Shared State is NOT a storage mode of the Data Store. It is core state that
// happens to be persisted in the same database.

import { useEffect, useState } from "react";
import {
  Database,
  Layers,
  Settings,
  Share2,
  AlertTriangle,
  AlertCircle,
  LockKeyhole,
} from "lucide-react";
import { useDataStoreStore } from "../../store/data-store-store";
import { CollectionsTab } from "./CollectionsTab";
import { SharedStateExplorer } from "./SharedStateExplorer";
import { SettingsPanel } from "./SettingsPanel";
import { SetupWizard } from "./SetupWizard";
import { useReadOnlyDemo } from "../../hooks/useReadOnlyDemo";

type Tab = "shared-state" | "collections" | "storage";

export function DataExplorer() {
  const readOnly = useReadOnlyDemo();
  // Lands on Shared State: it is the always-available concept, so it is the one
  // view guaranteed to have something to show.
  const [activeTab, setActiveTab] = useState<Tab>("shared-state");

  const fetchStats = useDataStoreStore((s) => s.fetchStats);
  const fetchCollections = useDataStoreStore((s) => s.fetchCollections);
  const fetchSharedStateBuckets = useDataStoreStore((s) => s.fetchSharedStateBuckets);
  const selectCollection = useDataStoreStore((s) => s.selectCollection);
  const stats = useDataStoreStore((s) => s.stats);
  const enabled = useDataStoreStore((s) => s.enabled);

  // Entering the Data page always lands on its home view. `selectedCollection`
  // lives in a module-level store that outlives this route, so without an
  // explicit reset, navigating to another tab and back would silently restore
  // the last-viewed collection detail instead of the collections list.
  useEffect(() => {
    selectCollection(null);
    fetchStats();
    fetchCollections();
    fetchSharedStateBuckets();
  }, [selectCollection, fetchStats, fetchCollections, fetchSharedStateBuckets]);

  // Determine storage warning level
  const storagePercent = stats?.storagePercent ?? 0;
  const storageWarning =
    storagePercent >= 95
      ? "critical"
      : storagePercent >= 80
        ? "warning"
        : "normal";

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "shared-state", label: "Shared State", icon: <Share2 size={14} /> },
    { id: "collections", label: "Collections", icon: <Layers size={14} /> },
    { id: "storage", label: "Storage", icon: <Settings size={14} /> },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#E6EDF3]">Data</h1>
          <p className="mt-1 text-sm text-[#6B7785]">
            Shared current values automations coordinate through, and the optional history they record.
          </p>
        </div>
      </div>

      {readOnly && (
        <div className="flex items-start gap-3 rounded-xl border border-[#31506A] bg-[#0D1822] px-4 py-3">
          <LockKeyhole size={17} className="mt-0.5 shrink-0 text-[#72B7E6]" />
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[#8CC9F0]">
              Public demo · read only
            </div>
            <p className="mt-1 text-xs leading-relaxed text-[#8B9AAA]">
              Aeolus keeps shared current values and historical measurements locally on the edge device.
              Browse the showcase data, then open Storage to see the limits that prevent a small device
              from silently filling its disk. This public demo lets you inspect the real controls without
              saving changes.
            </p>
          </div>
        </div>
      )}

      {/* Summary Bar */}
      <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {/* Shared values */}
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <Share2 size={12} className="text-[#6B7785]" />
              <span className="text-[10px] text-[#6B7785] uppercase tracking-wider">
                Shared Values
              </span>
            </div>
            <p className="text-lg font-semibold text-[#E6EDF3]">
              {stats?.totalBucketEntries ?? 0}
            </p>
          </div>

          {/* Collections */}
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <Layers size={12} className="text-[#6B7785]" />
              <span className="text-[10px] text-[#6B7785] uppercase tracking-wider">
                Collections
              </span>
            </div>
            <p className="text-lg font-semibold text-[#E6EDF3]">
              {stats?.totalCollections ?? 0}
            </p>
          </div>

          {/* Records */}
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <Database size={12} className="text-[#6B7785]" />
              <span className="text-[10px] text-[#6B7785] uppercase tracking-wider">
                Records
              </span>
            </div>
            <p className="text-lg font-semibold text-[#E6EDF3]">
              {stats?.totalRecords?.toLocaleString() ?? 0}
            </p>
          </div>

          {/* Historical storage usage. Shared State is bounded by its own
              per-value and total-entry limits, not by this budget, so it is
              deliberately not counted here. */}
          <div className="col-span-2 space-y-1.5">
            <div className="flex items-center gap-1.5">
              {storageWarning === "critical" ? (
                <AlertCircle size={12} className="text-[#EF4444]" />
              ) : storageWarning === "warning" ? (
                <AlertTriangle size={12} className="text-[#F59E0B]" />
              ) : (
                <Database size={12} className="text-[#6B7785]" />
              )}
              <span className="text-[10px] text-[#6B7785] uppercase tracking-wider">
                History Storage
              </span>
            </div>
            {enabled ? (
              <>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#0D1117]">
                  <div
                    className={`h-full rounded-full transition-all ${
                      storageWarning === "critical"
                        ? "bg-[#EF4444]"
                        : storageWarning === "warning"
                          ? "bg-[#F59E0B]"
                          : "bg-primary"
                    }`}
                    style={{ width: `${Math.min(100, storagePercent)}%` }}
                  />
                </div>
                <p className="text-[10px] text-[#6B7785]">
                  {(stats?.estimatedStorageMb ?? 0).toFixed(1)} MB of {stats?.maxStorageMb ?? 0} MB
                </p>
              </>
            ) : (
              <p className="text-[10px] text-[#6B7785]">Not recording history</p>
            )}
          </div>
        </div>
      </div>

      {/* Tab Switcher */}
      <div className="flex items-center gap-1 bg-[#161B22] border border-[#30363D] rounded-lg p-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              activeTab === tab.id
                ? "bg-primary text-white"
                : "text-[#9AA6B2] hover:text-[#E6EDF3] hover:bg-[#0D1117]"
            }`}
          >
            {tab.icon}
            {tab.label}
            {/* An amber dot marks the optional feature that is switched off, so the
                empty Collections tab reads as a choice rather than a fault. */}
            {tab.id === "collections" && !enabled && (
              <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-[#F59E0B]" title="Historical Collections are not enabled" />
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === "shared-state" && <SharedStateExplorer />}
      {activeTab === "collections" && (
        <CollectionsTab onConfigure={() => setActiveTab("storage")} />
      )}
      {/* Storage is where historical accumulation is configured: the setup flow
          before it is enabled, the live limits afterwards. */}
      {activeTab === "storage" && (enabled ? <SettingsPanel /> : <SetupWizard />)}
    </div>
  );
}
