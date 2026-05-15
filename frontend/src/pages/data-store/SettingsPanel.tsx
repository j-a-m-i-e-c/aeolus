// frontend/src/pages/data-store/SettingsPanel.tsx — View and edit DataStore configuration

import { useEffect, useState } from "react";
import { Settings, AlertTriangle, Check } from "lucide-react";
import { useDataStoreStore } from "../../store/data-store-store";

const API_URL =
  import.meta.env.VITE_API_URL ||
  `http://${window.location.hostname}:3001`;

export function SettingsPanel() {
  const config = useDataStoreStore((s) => s.config);
  const fetchConfig = useDataStoreStore((s) => s.fetchConfig);

  const [maxStorageMb, setMaxStorageMb] = useState(0);
  const [maxRecordsPerCollection, setMaxRecordsPerCollection] = useState(0);
  const [maxCollections, setMaxCollections] = useState(0);

  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Initialize form from config
  useEffect(() => {
    if (config) {
      setMaxStorageMb(config.maxStorageMb);
      setMaxRecordsPerCollection(config.maxRecordsPerCollection);
      setMaxCollections(config.maxCollections);
    }
  }, [config]);

  const hasChanges =
    config &&
    (maxStorageMb !== config.maxStorageMb ||
      maxRecordsPerCollection !== config.maxRecordsPerCollection ||
      maxCollections !== config.maxCollections);

  const handleSave = () => {
    setShowConfirm(true);
    setError(null);
    setSuccess(false);
  };

  const handleConfirmSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/data-store/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          maxStorageMb,
          maxRecordsPerCollection,
          maxCollections,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error || `Failed: ${res.status}`);
      }
      setShowConfirm(false);
      setSuccess(true);
      await fetchConfig();
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update config");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 max-w-xl">
      <p className="text-sm text-[#6B7785]">
        Manage Data Store limits and configuration.
      </p>

      {/* Configuration form */}
      <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Settings size={16} className="text-[#9AA6B2]" />
          <h3 className="text-sm font-semibold text-[#E6EDF3]">
            Storage Configuration
          </h3>
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
              value={maxStorageMb}
              onChange={(e) => setMaxStorageMb(Number(e.target.value) || 0)}
              className="w-full text-sm bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-[#E6EDF3] font-mono focus:outline-none focus:border-primary transition-colors"
            />
            <p className="text-[10px] text-[#6B7785]">
              Total disk space the Data Store can use. Writes are rejected when
              this limit is reached.
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
              value={maxRecordsPerCollection}
              onChange={(e) =>
                setMaxRecordsPerCollection(Number(e.target.value) || 0)
              }
              className="w-full text-sm bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-[#E6EDF3] font-mono focus:outline-none focus:border-primary transition-colors"
            />
            <p className="text-[10px] text-[#6B7785]">
              When exceeded, oldest records are automatically evicted (FIFO).
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
              value={maxCollections}
              onChange={(e) => setMaxCollections(Number(e.target.value) || 0)}
              className="w-full text-sm bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-[#E6EDF3] font-mono focus:outline-none focus:border-primary transition-colors"
            />
            <p className="text-[10px] text-[#6B7785]">
              Maximum number of named collections that can be created.
            </p>
          </div>
        </div>

        {/* Save button */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={!hasChanges}
            className="flex items-center gap-1.5 bg-primary hover:bg-primary/90 text-white rounded-lg px-4 py-2 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Check size={14} />
            Save Changes
          </button>
          {success && (
            <span className="text-xs text-[#22C55E]">
              Configuration updated successfully
            </span>
          )}
        </div>
      </div>

      {/* Confirmation dialog */}
      {showConfirm && (
        <div className="bg-[#F59E0B]/5 border border-[#F59E0B]/20 rounded-xl p-4 space-y-3">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="text-[#F59E0B] mt-0.5 shrink-0" />
            <div className="space-y-2">
              <p className="text-sm text-[#E6EDF3] font-medium">
                Confirm Configuration Change
              </p>
              <p className="text-xs text-[#9AA6B2]">
                Changing these settings takes effect immediately:
              </p>
              <ul className="text-xs text-[#9AA6B2] space-y-1 ml-4 list-disc">
                {maxStorageMb !== config?.maxStorageMb && (
                  <li>
                    Storage limit:{" "}
                    <span className="text-[#6B7785]">{config?.maxStorageMb} MB</span>
                    {" → "}
                    <span className="text-[#E6EDF3]">{maxStorageMb} MB</span>
                    {maxStorageMb < (config?.maxStorageMb ?? 0) && (
                      <span className="text-[#F59E0B]">
                        {" "}(reducing may reject future writes sooner)
                      </span>
                    )}
                  </li>
                )}
                {maxRecordsPerCollection !== config?.maxRecordsPerCollection && (
                  <li>
                    Records per collection:{" "}
                    <span className="text-[#6B7785]">
                      {config?.maxRecordsPerCollection?.toLocaleString()}
                    </span>
                    {" → "}
                    <span className="text-[#E6EDF3]">
                      {maxRecordsPerCollection.toLocaleString()}
                    </span>
                    {maxRecordsPerCollection < (config?.maxRecordsPerCollection ?? 0) && (
                      <span className="text-[#F59E0B]">
                        {" "}(existing collections may trigger FIFO eviction)
                      </span>
                    )}
                  </li>
                )}
                {maxCollections !== config?.maxCollections && (
                  <li>
                    Max collections:{" "}
                    <span className="text-[#6B7785]">{config?.maxCollections}</span>
                    {" → "}
                    <span className="text-[#E6EDF3]">{maxCollections}</span>
                  </li>
                )}
              </ul>
            </div>
          </div>

          {error && (
            <div className="bg-[#EF4444]/10 border border-[#EF4444]/20 rounded-lg px-3 py-2">
              <p className="text-xs text-[#EF4444]">{error}</p>
            </div>
          )}

          <div className="flex items-center gap-2 ml-6">
            <button
              onClick={handleConfirmSave}
              disabled={saving}
              className="flex items-center gap-1.5 bg-primary hover:bg-primary/90 text-white rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
            >
              {saving ? (
                <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Check size={12} />
              )}
              Apply Changes
            </button>
            <button
              onClick={() => { setShowConfirm(false); setError(null); }}
              className="text-[#9AA6B2] hover:text-[#E6EDF3] border border-[#30363D] rounded-lg px-3 py-1.5 text-xs transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
