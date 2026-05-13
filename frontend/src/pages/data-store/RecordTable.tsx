// frontend/src/pages/data-store/RecordTable.tsx — Paginated table of records

import { ChevronLeft, ChevronRight } from "lucide-react";
import type { DataRecord } from "../../store/data-store-store";

interface RecordTableProps {
  records: DataRecord[];
  total: number;
  loading: boolean;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function RecordTable({
  records,
  total,
  loading,
  page,
  pageSize,
  onPageChange,
}: RecordTableProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasNext = page < totalPages - 1;
  const hasPrev = page > 0;

  // Collect all payload keys across records for column headers
  const payloadKeys = Array.from(
    new Set(records.flatMap((r) => Object.keys(r.payload))),
  ).slice(0, 6); // Limit to 6 columns for readability

  // Check if any records have tags
  const hasTags = records.some(
    (r) => r.tags && Object.keys(r.tags).length > 0,
  );

  return (
    <div className="bg-[#161B22] border border-[#30363D] rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#30363D]">
        <h3 className="text-xs font-semibold text-[#E6EDF3]">
          Records{" "}
          <span className="text-[#6B7785] font-normal">
            ({total.toLocaleString()} total)
          </span>
        </h3>

        {/* Pagination controls */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[#6B7785]">
            Page {page + 1} of {totalPages}
          </span>
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={!hasPrev}
            className="p-1 rounded text-[#9AA6B2] hover:text-[#E6EDF3] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            onClick={() => onPageChange(page + 1)}
            disabled={!hasNext}
            className="p-1 rounded text-[#9AA6B2] hover:text-[#E6EDF3] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-8">
          <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      )}

      {/* Table */}
      {!loading && records.length === 0 && (
        <div className="flex items-center justify-center py-8">
          <span className="text-sm text-[#6B7785]">No records found</span>
        </div>
      )}

      {!loading && records.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#30363D]">
                <th className="text-left px-4 py-2 text-[10px] text-[#6B7785] uppercase tracking-wider font-medium">
                  Timestamp
                </th>
                {payloadKeys.map((key) => (
                  <th
                    key={key}
                    className="text-left px-4 py-2 text-[10px] text-[#6B7785] uppercase tracking-wider font-medium"
                  >
                    {key}
                  </th>
                ))}
                {hasTags && (
                  <th className="text-left px-4 py-2 text-[10px] text-[#6B7785] uppercase tracking-wider font-medium">
                    Tags
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr
                  key={record.id}
                  className="border-b border-[#30363D]/50 hover:bg-[#0D1117]/50 transition-colors"
                >
                  <td className="px-4 py-2 text-[#9AA6B2] font-mono whitespace-nowrap">
                    {formatTimestamp(record.timestamp)}
                  </td>
                  {payloadKeys.map((key) => {
                    const val = record.payload[key];
                    return (
                      <td
                        key={key}
                        className="px-4 py-2 text-[#E6EDF3] font-mono"
                      >
                        {val === undefined || val === null
                          ? <span className="text-[#6B7785]">—</span>
                          : typeof val === "object"
                            ? JSON.stringify(val)
                            : String(val)}
                      </td>
                    );
                  })}
                  {hasTags && (
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(record.tags || {}).map(([k, v]) => (
                          <span
                            key={k}
                            className="inline-flex items-center px-1.5 py-0.5 rounded bg-[#0D1117] text-[10px] text-[#9AA6B2] border border-[#30363D]"
                          >
                            {k}={v}
                          </span>
                        ))}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
