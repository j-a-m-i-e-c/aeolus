// frontend/src/components/panes/DataCollectionPane.tsx — Live view of one Data Store collection.
//
// Reads config.collection, fetches its recent records, and appends new records
// live via the per-collection realtime signal in the data-store store (fed by
// the scoped data-store-write WebSocket events). Each pane is independent, so
// multiple collections can be shown on the same dashboard.

import { useEffect, useState } from "react";
import { Database } from "lucide-react";
import type { PaneConfig } from "../../types/dashboard";
import { useDataStoreStore, type DataRecord } from "../../store/data-store-store";
import { API_URL } from "../../lib/env";

const LIMIT = 25;

interface Props {
  config: PaneConfig;
}

export function DataCollectionPane({ config }: Props) {
  const collection = typeof config.collection === "string" ? config.collection : "";
  const [records, setRecords] = useState<DataRecord[]>([]);
  const [loading, setLoading] = useState(false);

  // Latest realtime record for this collection (undefined until one arrives).
  const latest = useDataStoreStore((s) =>
    collection ? s.latestRecordByCollection[collection] : undefined,
  );

  // Initial fetch whenever the configured collection changes.
  useEffect(() => {
    if (!collection) {
      setRecords([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const { authFetch } = await import("../../lib/auth-fetch");
        const res = await authFetch(
          `${API_URL}/api/data-store/collections/${encodeURIComponent(collection)}/records?limit=${LIMIT}`,
        );
        const data = (await res.json()) as { records?: DataRecord[] };
        if (!cancelled) setRecords(Array.isArray(data.records) ? data.records : []);
      } catch {
        if (!cancelled) setRecords([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [collection]);

  // Append live records, newest first, de-duplicated by id and capped.
  useEffect(() => {
    if (!latest || latest.collection !== collection) return;
    setRecords((prev) =>
      prev.some((r) => r.id === latest.id) ? prev : [latest, ...prev].slice(0, LIMIT),
    );
  }, [latest, collection]);

  if (!collection) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-secondary text-sm">
        <Database size={20} className="opacity-60" />
        <span>Configure a collection to display its records.</span>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#2A3441] text-sm font-medium text-[#E6EDF3]">
        <Database size={14} className="text-primary" />
        <span className="truncate">{collection}</span>
        <span className="ml-auto text-xs text-secondary">{records.length} recent</span>
      </div>
      <div className="flex-1 overflow-auto">
        {loading && records.length === 0 ? (
          <div className="p-3 text-sm text-secondary">Loading…</div>
        ) : records.length === 0 ? (
          <div className="p-3 text-sm text-secondary">No records yet.</div>
        ) : (
          <table className="w-full text-xs">
            <tbody>
              {records.map((record) => (
                <tr key={record.id} className="border-b border-[#1E2733] align-top">
                  <td className="px-3 py-1.5 whitespace-nowrap text-secondary">
                    {new Date(record.timestamp).toLocaleTimeString()}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-[#9AA6B2] break-all">
                    {JSON.stringify(record.payload)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
