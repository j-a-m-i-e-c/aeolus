// frontend/src/pages/data-store/BucketList.tsx — Expandable list of buckets with key-value pairs

import { useEffect, useState } from "react";
import { Archive, ChevronDown, ChevronRight, Key } from "lucide-react";
import { useDataStoreStore } from "../../store/data-store-store";

export function BucketList() {
  const buckets = useDataStoreStore((s) => s.buckets);
  const fetchBuckets = useDataStoreStore((s) => s.fetchBuckets);
  const fetchBucketEntries = useDataStoreStore((s) => s.fetchBucketEntries);
  const bucketEntries = useDataStoreStore((s) => s.bucketEntries);
  const selectedBucket = useDataStoreStore((s) => s.selectedBucket);
  const selectBucket = useDataStoreStore((s) => s.selectBucket);

  const [expandedBucket, setExpandedBucket] = useState<string | null>(null);

  useEffect(() => {
    fetchBuckets();
  }, [fetchBuckets]);

  const handleToggle = (bucketName: string) => {
    if (expandedBucket === bucketName) {
      setExpandedBucket(null);
      selectBucket(null);
    } else {
      setExpandedBucket(bucketName);
      selectBucket(bucketName);
      fetchBucketEntries(bucketName);
    }
  };

  function formatTimestamp(ts: number): string {
    return new Date(ts).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  if (buckets.length === 0) {
    return (
      <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-8 text-center">
        <Archive size={32} className="text-[#6B7785] mx-auto mb-3" />
        <p className="text-sm text-[#6B7785]">
          No buckets yet. Buckets are created automatically when automations use{" "}
          <code className="text-[#9AA6B2] bg-[#0D1117] px-1 rounded">
            db.set()
          </code>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-[#6B7785]">
        Key-value buckets store persistent named values that can be read and written from any automation. Use them for cross-rule shared state, computed results, or configuration that needs to survive restarts.
      </p>

      {buckets.map((bucket) => {
        const isExpanded = expandedBucket === bucket.bucket;

        return (
          <div
            key={bucket.bucket}
            className="bg-[#161B22] border border-[#30363D] rounded-xl overflow-hidden"
          >
            {/* Bucket header */}
            <button
              onClick={() => handleToggle(bucket.bucket)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#0D1117]/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                {isExpanded ? (
                  <ChevronDown size={14} className="text-[#6B7785]" />
                ) : (
                  <ChevronRight size={14} className="text-[#6B7785]" />
                )}
                <Archive size={14} className="text-primary" />
                <span className="text-sm font-medium text-[#E6EDF3]">
                  {bucket.bucket}
                </span>
              </div>
              <span className="text-xs text-[#6B7785]">
                {bucket.keyCount} {bucket.keyCount === 1 ? "key" : "keys"}
              </span>
            </button>

            {/* Expanded entries */}
            {isExpanded && selectedBucket === bucket.bucket && (
              <div className="border-t border-[#30363D]">
                {bucketEntries.length === 0 ? (
                  <div className="px-4 py-3 text-xs text-[#6B7785]">
                    No entries
                  </div>
                ) : (
                  <div className="divide-y divide-[#30363D]/50">
                    {bucketEntries.map((entry) => (
                      <div
                        key={entry.key}
                        className="px-4 py-2.5 flex items-start justify-between gap-4"
                      >
                        <div className="flex items-start gap-2 min-w-0 flex-1">
                          <Key
                            size={12}
                            className="text-[#6B7785] mt-0.5 shrink-0"
                          />
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-[#E6EDF3] truncate">
                              {entry.key}
                            </p>
                            <p className="text-xs text-[#9AA6B2] font-mono mt-0.5 break-all">
                              {typeof entry.value === "object"
                                ? JSON.stringify(entry.value)
                                : String(entry.value)}
                            </p>
                          </div>
                        </div>
                        <span className="text-[10px] text-[#6B7785] whitespace-nowrap shrink-0">
                          {formatTimestamp(entry.updatedAt)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
