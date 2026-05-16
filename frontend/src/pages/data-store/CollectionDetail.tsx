// frontend/src/pages/data-store/CollectionDetail.tsx — Detail view with chart, record table, and management controls

import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Download,
  Pencil,
  Trash2,
  X,
  Check,
} from "lucide-react";
import { useDataStoreStore } from "../../store/data-store-store";
import { TimeSeriesChart } from "./TimeSeriesChart";
import { RecordTable } from "./RecordTable";
import { authFetch } from "../../lib/auth-fetch";

const API_URL =
  import.meta.env.VITE_API_URL ||
  `http://${window.location.hostname}:3001`;

export function CollectionDetail() {
  const selectedCollection = useDataStoreStore((s) => s.selectedCollection);
  const collections = useDataStoreStore((s) => s.collections);
  const selectCollection = useDataStoreStore((s) => s.selectCollection);
  const fetchCollections = useDataStoreStore((s) => s.fetchCollections);
  const fetchRecords = useDataStoreStore((s) => s.fetchRecords);
  const records = useDataStoreStore((s) => s.records);
  const recordsTotal = useDataStoreStore((s) => s.recordsTotal);
  const recordsLoading = useDataStoreStore((s) => s.recordsLoading);
  const timeRange = useDataStoreStore((s) => s.timeRange);

  const [showEdit, setShowEdit] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [editDescription, setEditDescription] = useState("");
  const [editRetention, setEditRetention] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Pagination
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const collection = collections.find((c) => c.name === selectedCollection);

  // Fetch records when collection or time range changes
  useEffect(() => {
    if (selectedCollection) {
      fetchRecords(selectedCollection, {
        from: timeRange,
        limit: pageSize,
        offset: page * pageSize,
      });
    }
  }, [selectedCollection, timeRange, page, fetchRecords]);

  // Initialize edit form
  useEffect(() => {
    if (collection) {
      setEditDescription(collection.description || "");
      setEditRetention(collection.retentionDays?.toString() || "");
    }
  }, [collection]);

  if (!selectedCollection || !collection) return null;

  const handleBack = () => selectCollection(null);

  const handleExportCsv = () => {
    const url = `${API_URL}/api/data-store/collections/${encodeURIComponent(selectedCollection)}/export`;
    window.open(url, "_blank");
  };

  const handleSaveEdit = async () => {
    setSaving(true);
    try {
      const res = await authFetch(
        `${API_URL}/api/data-store/collections/${encodeURIComponent(selectedCollection)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            description: editDescription.trim() || null,
            retentionDays: editRetention ? Number(editRetention) : null,
          }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed: ${res.status}`);
      }
      setShowEdit(false);
      await fetchCollections();
    } catch (err) {
      console.error("Failed to update collection:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await authFetch(
        `${API_URL}/api/data-store/collections/${encodeURIComponent(selectedCollection)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed: ${res.status}`);
      }
      selectCollection(null);
      await fetchCollections();
    } catch (err) {
      console.error("Failed to delete collection:", err);
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={handleBack}
            className="text-[#6B7785] hover:text-[#E6EDF3] transition-colors"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h2 className="text-lg font-semibold text-[#E6EDF3]">
              {collection.name}
            </h2>
            {collection.description && (
              <p className="text-xs text-[#6B7785]">{collection.description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCsv}
            className="flex items-center gap-1.5 text-[#9AA6B2] hover:text-[#E6EDF3] border border-[#30363D] rounded-lg px-3 py-1.5 text-xs transition-colors"
          >
            <Download size={12} />
            Export CSV
          </button>
          <button
            onClick={() => setShowEdit(!showEdit)}
            className="flex items-center gap-1.5 text-[#9AA6B2] hover:text-[#E6EDF3] border border-[#30363D] rounded-lg px-3 py-1.5 text-xs transition-colors"
          >
            <Pencil size={12} />
            Edit
          </button>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="flex items-center gap-1.5 text-[#EF4444] hover:text-[#EF4444]/80 border border-[#30363D] rounded-lg px-3 py-1.5 text-xs transition-colors"
          >
            <Trash2 size={12} />
            Delete
          </button>
        </div>
      </div>

      {/* Edit panel */}
      {showEdit && (
        <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-[#E6EDF3]">
              Edit Collection
            </h3>
            <button
              onClick={() => setShowEdit(false)}
              className="text-[#6B7785] hover:text-[#E6EDF3]"
            >
              <X size={14} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] text-[#6B7785] uppercase tracking-wider block">
                Description
              </label>
              <input
                type="text"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                className="w-full text-sm bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-[#E6EDF3] focus:outline-none focus:border-primary transition-colors"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-[#6B7785] uppercase tracking-wider block">
                Retention (days, empty = forever)
              </label>
              <input
                type="number"
                value={editRetention}
                onChange={(e) => setEditRetention(e.target.value)}
                min={1}
                className="w-full text-sm bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-[#E6EDF3] focus:outline-none focus:border-primary transition-colors"
              />
            </div>
          </div>
          <button
            onClick={handleSaveEdit}
            disabled={saving}
            className="flex items-center gap-1.5 bg-primary hover:bg-primary/90 text-white rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
          >
            {saving ? (
              <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Check size={12} />
            )}
            Save
          </button>
        </div>
      )}

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div className="bg-[#EF4444]/5 border border-[#EF4444]/20 rounded-xl p-4 space-y-3">
          <p className="text-sm text-[#E6EDF3]">
            Are you sure you want to delete{" "}
            <span className="font-semibold">{collection.name}</span>? This will
            permanently remove all {collection.recordCount.toLocaleString()}{" "}
            records.
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="flex items-center gap-1.5 bg-[#EF4444] hover:bg-[#EF4444]/90 text-white rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
            >
              {deleting ? (
                <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Trash2 size={12} />
              )}
              Delete Forever
            </button>
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="text-[#9AA6B2] hover:text-[#E6EDF3] border border-[#30363D] rounded-lg px-3 py-1.5 text-xs transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Time-series chart */}
      <TimeSeriesChart records={records} />

      {/* Record table */}
      <RecordTable
        records={records}
        total={recordsTotal}
        loading={recordsLoading}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
      />
    </div>
  );
}
