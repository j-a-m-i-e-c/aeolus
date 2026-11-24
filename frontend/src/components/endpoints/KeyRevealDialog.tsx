// frontend/src/components/endpoints/KeyRevealDialog.tsx — the only place a full API key
// is ever shown. The key arrives in the issue or rotate response, lives in the parent's
// component state until this dialog closes, and is then gone: the server keeps only a
// hash, and nothing here writes it to storage, logs or the URL.

import { useId } from "react";
import { KeyRound } from "lucide-react";
import type { IssuedKey } from "../../lib/project-api";
import { formatWhen } from "./endpoint-format";
import { Button, CopyButton, Notice, Overlay } from "./ui";

export function KeyRevealDialog({ issued, clientName, rotated, onClose }: {
  issued: IssuedKey;
  clientName: string;
  rotated: boolean;
  onClose: () => void;
}) {
  const titleId = useId();
  const keyId = useId();
  return <Overlay>{(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="w-full max-w-lg space-y-4 rounded-xl border border-[#2A3441] bg-[#10161F] p-5 shadow-xl">
        <div className="flex items-center gap-2">
          <KeyRound size={14} className="text-[#5CE1E6]" />
          <h3 id={titleId} className="text-sm font-semibold text-[#E6EDF3]">{rotated ? "Replacement key" : "New API key"} for {clientName}</h3>
        </div>
        <Notice tone="warn">
          Copy this key now. Aeolus stores only a hash of it, so it cannot be shown again. If it is lost, rotate the key.
        </Notice>
        <div className="space-y-1">
          <label htmlFor={keyId} className="text-[10px] font-medium text-[#9AA6B2]">API key</label>
          <div className="flex items-center gap-2">
            <input
              id={keyId}
              readOnly
              value={issued.key}
              autoComplete="off"
              spellCheck={false}
              onFocus={(event) => event.currentTarget.select()}
              className="min-w-0 flex-1 rounded-md border border-[#2A3441] bg-[#0B0F14] px-2 py-1.5 font-mono text-[11px] text-[#E6EDF3]"
            />
            <CopyButton text={issued.key} label="Copy API key" />
          </div>
          <div className="text-[10px] text-[#7E8A98]">
            Expires: {issued.credential.expiresAt === null ? "never" : formatWhen(issued.credential.expiresAt)}. Send it only in the
            <code className="mx-1 font-mono text-[#B9C4CF]">Authorization: Bearer</code>header, never in a URL.
          </div>
        </div>
        <div className="flex justify-end">
          <Button tone="primary" onClick={onClose}>I have saved the key</Button>
        </div>
      </div>
    </div>
  )}</Overlay>;
}
