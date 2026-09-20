// frontend/src/pages/data-store/SharedStateExplorer.tsx — Browse durable shared current values
//
// Shared State is a core Aeolus facility, not a storage mode of the historical
// Data Store (ADR-0016). This view is therefore always available, whether or not
// historical Collections are enabled.

import { useEffect, useState } from "react";
import { Archive, ChevronDown, ChevronRight, Key, Share2 } from "lucide-react";
import { useDataStoreStore } from "../../store/data-store-store";

/**
 * Notes for the showcase's own buckets, so a visitor reading the demo can tell
 * what each namespace is for. Unknown buckets simply render without a note.
 */
const DEMO_BUCKET_NOTES: Record<string, string> = {
  "demo-runtime": "Small values describing this showcase runtime. An example of durable application metadata.",
  "policy-snapshots": "Current control thresholds shared by automations, such as water, mine atmosphere and wildlife response policies.",
  "latest-checkpoints": "The latest useful outcome from longer-running workflows, without treating it like a time-series log.",
  "bunker-summary": "Each bunker subsystem's current summary. The Bunker Overview is triggered by changes here and reads every key to compose its view.",
  "mine-summary": "Each mine subsystem's current summary, composed by the Mine Operations Overview.",
  "vessel-summary": "Each vessel subsystem's current summary, composed by the Mission Overview.",
  "_showcase:seed-ledger": "Which automations and tabs the showcase seeder owns, so a reseed reclaims its own resources and leaves yours alone.",
};

export function SharedStateExplorer() {
  const buckets = useDataStoreStore((s) => s.sharedStateBuckets);
  const fetchBuckets = useDataStoreStore((s) => s.fetchSharedStateBuckets);
  const fetchEntries = useDataStoreStore((s) => s.fetchSharedStateEntries);
  const entries = useDataStoreStore((s) => s.sharedStateEntries);
  const selectedBucket = useDataStoreStore((s) => s.selectedSharedStateBucket);
  const selectBucket = useDataStoreStore((s) => s.selectSharedStateBucket);

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
      fetchEntries(bucketName);
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

  /**
   * What this is for, shown above the list and in the empty state.
   *
   * The contrast with the private per-automation store is drawn explicitly, because
   * that is the distinction the name is carrying: Automation State belongs to one
   * automation, this is the part deliberately shared.
   */
  const explainer = (
    <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-4">
      <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-[#E6EDF3]">
        <Share2 size={13} className="text-[#3BA4FF]" /> Shared Automation State
      </div>
      <p className="text-xs leading-relaxed text-[#6B7785]">
        Small current values that automations intentionally share with each other, grouped
        into buckets. Unlike an automation's own private state, anything here is readable by
        every automation. Values survive restarts, and an automation can be triggered when
        one changes. This holds the latest value only — it is not a history.
      </p>
    </div>
  );

  if (buckets.length === 0) {
    return (
      <div className="space-y-3">
        {explainer}
        <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-8 text-center">
          <Archive size={32} className="text-[#6B7785] mx-auto mb-3" />
          <p className="text-sm text-[#6B7785]">
            No shared values yet. A bucket appears here the first time an automation calls{" "}
            <code className="text-[#9AA6B2] bg-[#0D1117] px-1 rounded">
              shared.set()
            </code>
            .
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {explainer}

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
                  {DEMO_BUCKET_NOTES[bucket.bucket] && (
                    <p className="mt-0.5 max-w-2xl text-[10px] leading-relaxed text-[#6B7785]">
                      {DEMO_BUCKET_NOTES[bucket.bucket]}
                    </p>
                  )}
                </div>
              </div>
              <span className="text-xs text-[#6B7785]">
                {bucket.keyCount} {bucket.keyCount === 1 ? "value" : "values"}
              </span>
            </button>

            {/* Expanded entries */}
            {isExpanded && selectedBucket === bucket.bucket && (
              <div className="border-t border-[#30363D]">
                {entries.length === 0 ? (
                  <div className="px-4 py-3 text-xs text-[#6B7785]">
                    No values
                  </div>
                ) : (
                  <div className="divide-y divide-[#30363D]/50">
                    {entries.map((entry) => (
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
                              {/* The canonical reactive path, which is also what a
                                  shared-state trigger pattern matches against. */}
                              <span className="text-[#6B7785]">{bucket.bucket}/</span>
                              {entry.key}
                            </p>
                            <p className="text-xs text-[#9AA6B2] font-mono mt-0.5 break-all">
                              {typeof entry.value === "object" && entry.value !== null
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
