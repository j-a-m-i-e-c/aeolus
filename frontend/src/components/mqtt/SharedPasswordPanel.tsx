// frontend/src/components/mqtt/SharedPasswordPanel.tsx — Shared credential display with copy and regenerate

import { useState } from "react";
import { Key, Copy, Check, RefreshCw, Loader2 } from "lucide-react";
import { useMqttProvisioningStore } from "../../store/mqtt-provisioning-store";

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      onClick={handleCopy}
      className="p-1.5 rounded-md text-[#6B7785] hover:text-[#9AA6B2] hover:bg-[#1A2330] transition-colors duration-150"
      aria-label="Copy to clipboard"
    >
      {copied ? <Check size={14} className="text-[#22C55E]" /> : <Copy size={14} />}
    </button>
  );
}

export default function SharedPasswordPanel() {
  const { sharedCredential, loading, regenerateSharedPassword } =
    useMqttProvisioningStore();

  if (!sharedCredential) return null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Key size={16} className="text-[#3BA4FF]" />
        <h2 className="text-sm font-semibold text-[#E6EDF3]">Shared Credential</h2>
      </div>

      {/* Credential fields */}
      <div className="space-y-3">
        {/* Username */}
        <div className="flex items-center justify-between bg-[#0B0F14] rounded-lg px-3 py-2 border border-[#2A3441]">
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[11px] uppercase tracking-wider text-[#6B7785]">Username</span>
            <span className="text-sm font-mono text-[#E6EDF3] truncate">
              {sharedCredential.username}
            </span>
          </div>
          <CopyButton value={sharedCredential.username} />
        </div>

        {/* Password */}
        <div className="flex items-center justify-between bg-[#0B0F14] rounded-lg px-3 py-2 border border-[#2A3441]">
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[11px] uppercase tracking-wider text-[#6B7785]">Password</span>
            <span className="text-sm font-mono text-[#E6EDF3] truncate">
              {sharedCredential.password}
            </span>
          </div>
          <CopyButton value={sharedCredential.password} />
        </div>
      </div>

      {/* Regenerate button */}
      <button
        onClick={regenerateSharedPassword}
        disabled={loading}
        className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-[#9AA6B2] bg-[#1A2330] border border-[#2A3441] hover:text-[#E6EDF3] hover:border-[#3BA4FF]/30 transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <RefreshCw size={14} />
        )}
        Regenerate Password
      </button>
    </div>
  );
}
