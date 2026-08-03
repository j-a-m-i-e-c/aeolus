// frontend/src/pages/data-store/DataExplorer.tsx — Main Data Explorer with SummaryBar and tab switcher

import { useEffect, useState } from "react";
import {
  Database,
  Layers,
  Archive,
  Settings,
  AlertTriangle,
  AlertCircle,
} from "lucide-react";
import { useDataStoreStore } from "../../store/data-store-store";
import { CollectionList } from "./CollectionList";
import { CollectionDetail } from "./CollectionDetail";
import { BucketList } from "./BucketList";
import { SettingsPanel } from "./SettingsPanel";
import { useReadOnlyDemo } from "../../hooks/useReadOnlyDemo";

type Tab = "collections" | "buckets" | "settings";

export function DataExplorer() {
  const readOnly = useReadOnlyDemo();
  const [activeTab, setActiveTab] = useState<Tab>("collections");

  const fetchStats = useDataStoreStore((s) => s.fetchStats);
  const fetchCollections = useDataStoreStore((s) => s.fetchCollections);
  const fetchBuckets = useDataStoreStore((s) => s.fetchBuckets);
  const stats = useDataStoreStore((s) => s.stats);
  const selectedCollection = useDataStoreStore((s) => s.selectedCollection);

  useEffect(() => {
    fetchStats();
    fetchCollections();
    fetchBuckets();
  }, [fetchStats, fetchCollections, fetchBuckets]);

  // Determine storage warning level
  const storagePercent = stats?.storagePercent ?? 0;
  const storageWarning =
    storagePercent >= 95
      ? "critical"
      : storagePercent >= 80
        ? "warning"
        : "normal";

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "collections", label: "Collections", icon: <Layers size={14} /> },
    { id: "buckets", label: "Buckets", icon: <Archive size={14} /> },
    // The Settings tab is the Data Store config-mutation surface — hidden in the
    // read-only public demo.
    ...(readOnly ? [] : [{ id: "settings" as Tab, label: "Settings", icon: <Settings size={14} /> }]),
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#E6EDF3]">Data Store</h1>
      </div>

      {/* Summary Bar */}
      <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
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

          {/* Buckets */}
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <Archive size={12} className="text-[#6B7785]" />
              <span className="text-[10px] text-[#6B7785] uppercase tracking-wider">
                Buckets
              </span>
            </div>
            <p className="text-lg font-semibold text-[#E6EDF3]">
              {stats?.totalBucketEntries ?? 0}
            </p>
          </div>

          {/* Storage Usage */}
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
                Storage
              </span>
              <span
                className={`text-[10px] font-medium ml-auto ${
                  storageWarning === "critical"
                    ? "text-[#EF4444]"
                    : storageWarning === "warning"
                      ? "text-[#F59E0B]"
                      : "text-[#9AA6B2]"
                }`}
              >
                {stats?.estimatedStorageMb?.toFixed(1) ?? 0} /{" "}
                {stats?.maxStorageMb ?? 0} MB
              </span>
            </div>
            {/* Progress bar */}
            <div className="w-full h-2 bg-[#0D1117] rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  storageWarning === "critical"
                    ? "bg-[#EF4444]"
                    : storageWarning === "warning"
                      ? "bg-[#F59E0B]"
                      : "bg-primary"
                }`}
                style={{ width: `${Math.min(storagePercent, 100)}%` }}
              />
            </div>
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
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === "collections" && (
        <>
          {selectedCollection ? (
            <CollectionDetail />
          ) : (
            <CollectionList />
          )}
        </>
      )}
      {activeTab === "buckets" && <BucketList />}
      {activeTab === "settings" && <SettingsPanel />}
    </div>
  );
}
