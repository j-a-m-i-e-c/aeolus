// frontend/src/pages/data-store/BucketList.tsx — Expandable list of buckets with key-value pairs

import { useEffect, useState } from "react";
import { Archive, ChevronDown, ChevronRight, Key, Clock3 } from "lucide-react";
import { useDataStoreStore } from "../../store/data-store-store";

const DEMO_BUCKET_NOTES: Record<string, string> = {
  "demo-runtime": "Small values describing this showcase runtime. Useful as an example of durable application metadata.",
  "policy-snapshots": "Current control thresholds shared by automations, such as water, mine atmosphere and wildlife response policies.",
  "latest-checkpoints": "The latest useful outcome from longer-running workflows, without treating it like a time-series log.",
};

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
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-4">
          <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-[#E6EDF3]"><Clock3 size={13} className="text-[#5CE1E6]" /> Collections</div>
          <p className="text-xs leading-relaxed text-[#6B7785]">History: many timestamped measurements or events that you query over a time window and chart.</p>
        </div>
        <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-4">
          <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-[#E6EDF3]"><Key size={13} className="text-[#3BA4FF]" /> Buckets</div>
          <p className="text-xs leading-relaxed text-[#6B7785]">Current shared values: named configuration, checkpoints or computed state that should survive restarts.</p>
        </div>
      </div>

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
                <div className="text-left">
                  <span className="text-sm font-medium text-[#E6EDF3]">{bucket.bucket}</span>
                  {DEMO_BUCKET_NOTES[bucket.bucket] && <p className="mt-0.5 max-w-2xl text-[10px] leading-relaxed text-[#6B7785]">{DEMO_BUCKET_NOTES[bucket.bucket]}</p>}
                </div>
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
