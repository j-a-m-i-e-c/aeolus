// frontend/src/pages/data-store/SetupWizard.tsx — Setup wizard for enabling the Data Store

import { useState, useEffect } from "react";
import { Database, HardDrive, Settings, Check, Info, Cpu } from "lucide-react";
import { useDataStoreStore } from "../../store/data-store-store";

// ---- Types ----

interface SystemInfo {
  diskAvailableGb: number;
  totalRamGb: number;
  currentDbSizeMb: number;
}

interface ConfigFormValues {
  maxStorageMb: number;
  maxRecordsPerCollection: number;
  maxCollections: number;
}

// ---- Tier-based defaults ----

function getRecommendedDefaults(diskGb: number): ConfigFormValues {
  if (diskGb < 8) {
    return { maxStorageMb: 200, maxRecordsPerCollection: 50000, maxCollections: 50 };
  }
  if (diskGb <= 32) {
    return { maxStorageMb: 500, maxRecordsPerCollection: 100000, maxCollections: 50 };
  }
  return { maxStorageMb: 2000, maxRecordsPerCollection: 500000, maxCollections: 50 };
}

function getTierLabel(diskGb: number): string {
  if (diskGb < 8) return "Constrained (< 8 GB free)";
  if (diskGb <= 32) return "Standard (8–32 GB free)";
  return "Generous (> 32 GB free)";
}

// ---- API helper (same pattern as the store) ----

const API_URL =
  (import.meta as any).env?.VITE_API_URL ||
  `http://${window.location.hostname}:3001`;

async function enableDataStore(config: ConfigFormValues): Promise<void> {
  const res = await fetch(`${API_URL}/api/data-store/enable`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      enabled: true,
      maxStorageMb: config.maxStorageMb,
      maxRecordsPerCollection: config.maxRecordsPerCollection,
      maxCollections: config.maxCollections,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Failed to enable Data Store: ${res.status}`);
  }
}

// ---- Component ----

export function SetupWizard() {
  const fetchConfig = useDataStoreStore((s) => s.fetchConfig);

  // System info — fetched from stats or use placeholders
  const [systemInfo, setSystemInfo] = useState<SystemInfo>({
    diskAvailableGb: 16,
    totalRamGb: 4,
    currentDbSizeMb: 12,
  });

  // Config form state
  const [config, setConfig] = useState<ConfigFormValues>(() =>
    getRecommendedDefaults(16),
  );

  const [enabling, setEnabling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Try to fetch system info from stats endpoint on mount
  useEffect(() => {
    async function loadSystemInfo() {
      try {
        const res = await fetch(`${API_URL}/api/data-store/stats`);
        if (res.ok) {
          const stats = await res.json();
          if (stats.estimatedStorageMb !== undefined) {
            setSystemInfo((prev) => ({
              ...prev,
              currentDbSizeMb: stats.estimatedStorageMb,
            }));
          }
        }
      } catch {
        // Stats endpoint may not be available yet — use placeholders
      }
    }
    loadSystemInfo();
  }, []);

  // Update config when system info changes
  useEffect(() => {
    const defaults = getRecommendedDefaults(systemInfo.diskAvailableGb);
    setConfig(defaults);
  }, [systemInfo.diskAvailableGb]);

  const handleEnable = async () => {
    setEnabling(true);
    setError(null);
    try {
      await enableDataStore(config);
      await fetchConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to enable Data Store");
    } finally {
      setEnabling(false);
    }
  };

  const tierLabel = getTierLabel(systemInfo.diskAvailableGb);

  return (
    <div className="max-w-2xl mx-auto py-8 px-4 space-y-6">
      {/* Header */}
      <div className="text-center space-y-3">
        <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center mx-auto">
          <Database size={28} className="text-primary" />
        </div>
        <h1 className="text-2xl font-bold text-[#E6EDF3]">Enable Data Store</h1>
        <p className="text-sm text-[#6B7785] max-w-md mx-auto">
          Set up persistent time-series and key-value storage for your automations.
        </p>
      </div>

      {/* Explanation card */}
      <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Info size={16} className="text-primary" />
          <h2 className="text-sm font-semibold text-[#E6EDF3]">What is the Data Store?</h2>
        </div>
        <p className="text-xs text-[#9AA6B2] leading-relaxed">
          The Data Store lets your automations accumulate structured data over time — energy readings,
          irrigation logs, sensor history, and more. It provides two storage modes:
        </p>
        <ul className="text-xs text-[#9AA6B2] space-y-1.5 ml-4 list-disc">
          <li>
            <span className="text-[#E6EDF3] font-medium">Collections</span> — time-series records
            with timestamps, tags, and aggregation queries
          </li>
          <li>
            <span className="text-[#E6EDF3] font-medium">Buckets</span> — key-value storage shared
            across automations for computed values and state
          </li>
        </ul>
        <p className="text-xs text-[#6B7785] leading-relaxed">
          Retention policies automatically prune old data to keep storage manageable on your device.
          You can configure per-collection retention or rely on the global storage limit.
        </p>
      </div>

      {/* System info card */}
      <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Settings size={16} className="text-[#9AA6B2]" />
          <h2 className="text-sm font-semibold text-[#E6EDF3]">System Information</h2>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <HardDrive size={12} className="text-[#6B7785]" />
              <span className="text-[10px] text-[#6B7785] uppercase tracking-wider">Disk Available</span>
            </div>
            <p className="text-lg font-semibold text-[#E6EDF3]">{systemInfo.diskAvailableGb} GB</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <Cpu size={12} className="text-[#6B7785]" />
              <span className="text-[10px] text-[#6B7785] uppercase tracking-wider">Total RAM</span>
            </div>
            <p className="text-lg font-semibold text-[#E6EDF3]">{systemInfo.totalRamGb} GB</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <Database size={12} className="text-[#6B7785]" />
              <span className="text-[10px] text-[#6B7785] uppercase tracking-wider">Current DB</span>
            </div>
            <p className="text-lg font-semibold text-[#E6EDF3]">{systemInfo.currentDbSizeMb} MB</p>
          </div>
        </div>
        <div className="text-xs text-[#6B7785]">
          Detected tier: <span className="text-primary font-medium">{tierLabel}</span>
        </div>
      </div>

      {/* Configuration form card */}
      <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#E6EDF3]">Storage Configuration</h2>
          <button
            onClick={() => setConfig(getRecommendedDefaults(systemInfo.diskAvailableGb))}
            className="text-[10px] text-primary hover:text-primary/80 transition-colors"
          >
            Reset to recommended
          </button>
        </div>

        <div className="space-y-4">
          {/* Max Storage */}
          <div className="space-y-1.5">
            <label className="text-[10px] text-[#6B7785] uppercase tracking-wider block">
              Maximum Storage (MB)
            </label>
            <input
              type="number"
              min={50}
              max={10000}
              value={config.maxStorageMb}
              onChange={(e) =>
                setConfig((prev) => ({ ...prev, maxStorageMb: Number(e.target.value) || 0 }))
              }
              className="w-full text-sm bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-[#E6EDF3] font-mono focus:outline-none focus:border-primary transition-colors"
            />
            <p className="text-[10px] text-[#6B7785]">
              Total disk space the Data Store can use. Writes are rejected when this limit is reached.
            </p>
          </div>

          {/* Max Records Per Collection */}
          <div className="space-y-1.5">
            <label className="text-[10px] text-[#6B7785] uppercase tracking-wider block">
              Max Records Per Collection
            </label>
            <input
              type="number"
              min={1000}
              max={10000000}
              value={config.maxRecordsPerCollection}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  maxRecordsPerCollection: Number(e.target.value) || 0,
                }))
              }
              className="w-full text-sm bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-[#E6EDF3] font-mono focus:outline-none focus:border-primary transition-colors"
            />
            <p className="text-[10px] text-[#6B7785]">
              When exceeded, oldest records are automatically evicted (FIFO) to make room for new writes.
            </p>
          </div>

          {/* Max Collections */}
          <div className="space-y-1.5">
            <label className="text-[10px] text-[#6B7785] uppercase tracking-wider block">
              Max Collections
            </label>
            <input
              type="number"
              min={5}
              max={500}
              value={config.maxCollections}
              onChange={(e) =>
                setConfig((prev) => ({ ...prev, maxCollections: Number(e.target.value) || 0 }))
              }
              className="w-full text-sm bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-[#E6EDF3] font-mono focus:outline-none focus:border-primary transition-colors"
            />
            <p className="text-[10px] text-[#6B7785]">
              Maximum number of named collections that can be created.
            </p>
          </div>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="bg-[#EF4444]/10 border border-[#EF4444]/20 rounded-lg px-4 py-3">
          <p className="text-xs text-[#EF4444]">{error}</p>
        </div>
      )}

      {/* Enable button */}
      <button
        onClick={handleEnable}
        disabled={enabling || config.maxStorageMb <= 0 || config.maxRecordsPerCollection <= 0 || config.maxCollections <= 0}
        className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-white rounded-lg px-4 py-3 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {enabling ? (
          <>
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Enabling…
          </>
        ) : (
          <>
            <Check size={16} />
            Enable Data Store
          </>
        )}
      </button>
    </div>
  );
}
