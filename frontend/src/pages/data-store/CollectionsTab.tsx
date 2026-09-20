// frontend/src/pages/data-store/CollectionsTab.tsx — Historical Collections, with its own setup gate
//
// Historical accumulation is optional because it grows without bound and can fill
// a constrained edge device, so it stays behind an explicit enable step. That gate
// lives HERE rather than in front of the whole Data page: Shared Automation State is
// core and must remain browseable whether or not history is being recorded (ADR-0016).

import { Clock3, Layers } from "lucide-react";
import { useDataStoreStore } from "../../store/data-store-store";
import { CollectionList } from "./CollectionList";
import { CollectionDetail } from "./CollectionDetail";

export function CollectionsTab({ onConfigure }: { onConfigure: () => void }) {
  const enabled = useDataStoreStore((s) => s.enabled);
  const selectedCollection = useDataStoreStore((s) => s.selectedCollection);

  if (!enabled) {
    return (
      <div className="space-y-3">
        <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-4">
          <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-[#E6EDF3]">
            <Clock3 size={13} className="text-[#5CE1E6]" /> Collections
          </div>
          <p className="text-xs leading-relaxed text-[#6B7785]">
            History: many timestamped observations that you query over a time window and chart.
          </p>
        </div>

        <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-8 text-center">
          <Layers size={32} className="text-[#6B7785] mx-auto mb-3" />
          <h2 className="text-sm font-semibold text-[#E6EDF3]">
            Historical Collections are not enabled
          </h2>
          <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-[#6B7785]">
            Recording observations over time accumulates without bound, so it needs storage
            limits and retention before it starts. Shared Automation State needs none of that
            and is available now.
          </p>
          <button
            onClick={onConfigure}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-primary/90"
          >
            Set up historical storage
          </button>
        </div>
      </div>
    );
  }

  return selectedCollection ? <CollectionDetail /> : <CollectionList />;
}
