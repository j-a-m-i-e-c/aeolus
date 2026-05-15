// frontend/src/pages/data-store/CollectionList.tsx — Card grid of collections with creation form

import { useState } from "react";
import {
  Plus,
  Clock,
  Database,
  Calendar,
  HardDrive,
  X,
} from "lucide-react";
import { useDataStoreStore } from "../../store/data-store-store";

const API_URL =
  import.meta.env.VITE_API_URL ||
  `http://${window.location.hostname}:3001`;

export function CollectionList() {
  const collections = useDataStoreStore((s) => s.collections);
  const selectCollection = useDataStoreStore((s) => s.selectCollection);
  const fetchCollections = useDataStoreStore((s) => s.fetchCollections);

  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [retentionDays, setRetentionDays] = useState<string>("");

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/data-store/collections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          retentionDays: retentionDays ? Number(retentionDays) : undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error || `Failed: ${res.status}`);
      }
      setName("");
      setDescription("");
      setRetentionDays("");
      setShowCreate(false);
      await fetchCollections();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create collection");
    } finally {
      setCreating(false);
    }
  };

  function formatTimestamp(ts: number | null): string {
    if (!ts) return "—";
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  function estimateSize(recordCount: number): string {
    // Rough estimate: ~200 bytes per record
    const bytes = recordCount * 200;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <div className="space-y-4">
      {/* Header with New Collection button */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-[#6B7785]">
          Browse collections and view time-series data.
        </p>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 bg-primary hover:bg-primary/90 text-white rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
        >
          <Plus size={14} />
          New Collection
        </button>
      </div>

      {/* Creation form */}
      {showCreate && (
        <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[#E6EDF3]">
              Create Collection
            </h3>
            <button
              onClick={() => { setShowCreate(false); setError(null); }}
              className="text-[#6B7785] hover:text-[#E6EDF3] transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-[10px] text-[#6B7785] uppercase tracking-wider block">
                Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. energy-daily"
                className="w-full text-sm bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-[#E6EDF3] placeholder:text-[#6B7785] focus:outline-none focus:border-primary transition-colors"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] text-[#6B7785] uppercase tracking-wider block">
                Description (optional)
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What this collection stores"
                className="w-full text-sm bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-[#E6EDF3] placeholder:text-[#6B7785] focus:outline-none focus:border-primary transition-colors"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] text-[#6B7785] uppercase tracking-wider block">
                Retention (days, leave empty for forever)
              </label>
              <input
                type="number"
                value={retentionDays}
                onChange={(e) => setRetentionDays(e.target.value)}
                placeholder="e.g. 30"
                min={1}
                className="w-full text-sm bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-[#E6EDF3] placeholder:text-[#6B7785] focus:outline-none focus:border-primary transition-colors"
              />
            </div>
          </div>

          {error && (
            <div className="bg-[#EF4444]/10 border border-[#EF4444]/20 rounded-lg px-3 py-2">
              <p className="text-xs text-[#EF4444]">{error}</p>
            </div>
          )}

          <button
            onClick={handleCreate}
            disabled={creating || !name.trim()}
            className="flex items-center gap-1.5 bg-primary hover:bg-primary/90 text-white rounded-lg px-4 py-2 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {creating ? (
              <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Plus size={14} />
            )}
            Create
          </button>
        </div>
      )}

      {/* Collection cards grid */}
      {collections.length === 0 ? (
        <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-8 text-center">
          <Database size={32} className="text-[#6B7785] mx-auto mb-3" />
          <p className="text-sm text-[#6B7785]">
            No collections yet. Create one to start storing time-series data.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {collections.map((col) => (
            <button
              key={col.name}
              onClick={() => selectCollection(col.name)}
              className="bg-[#161B22] border border-[#30363D] rounded-xl p-4 text-left hover:border-primary/50 transition-colors group"
            >
              <div className="flex items-start justify-between mb-2">
                <h3 className="text-sm font-semibold text-[#E6EDF3] group-hover:text-primary transition-colors truncate">
                  {col.name}
                </h3>
              </div>

              {col.description && (
                <p className="text-xs text-[#6B7785] mb-3 line-clamp-2">
                  {col.description}
                </p>
              )}

              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <div className="flex items-center gap-1 text-[#9AA6B2]">
                  <Database size={10} className="text-[#6B7785]" />
                  <span>{col.recordCount.toLocaleString()} records</span>
                </div>
                <div className="flex items-center gap-1 text-[#9AA6B2]">
                  <Clock size={10} className="text-[#6B7785]" />
                  <span>
                    {col.retentionDays ? `${col.retentionDays}d retention` : "Forever"}
                  </span>
                </div>
                <div className="flex items-center gap-1 text-[#9AA6B2]">
                  <Calendar size={10} className="text-[#6B7785]" />
                  <span>{formatTimestamp(col.newestRecord)}</span>
                </div>
                <div className="flex items-center gap-1 text-[#9AA6B2]">
                  <HardDrive size={10} className="text-[#6B7785]" />
                  <span>{estimateSize(col.recordCount)}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
