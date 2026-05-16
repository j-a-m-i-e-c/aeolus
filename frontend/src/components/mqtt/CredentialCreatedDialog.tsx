// frontend/src/components/mqtt/CredentialCreatedDialog.tsx — One-time password display dialog

import { useState } from "react";
import { Copy, Check, AlertTriangle, X } from "lucide-react";
import type { MqttCredential } from "../../store/mqtt-provisioning-store";

interface CredentialCreatedDialogProps {
  credential: MqttCredential;
  onClose: () => void;
}

export default function CredentialCreatedDialog({
  credential,
  onClose,
}: CredentialCreatedDialogProps) {
  const [copiedField, setCopiedField] = useState<"username" | "password" | null>(null);

  const copyToClipboard = async (text: string, field: "username" | "password") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      // Fallback for non-secure contexts
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-surface border border-border rounded-xl p-6 w-full max-w-md shadow-xl space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-primary-text">Credential Created</h3>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-muted hover:text-primary-text transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Warning */}
        <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
          <AlertTriangle size={14} className="text-amber-400 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-300">
            Save this password now. It won't be shown again.
          </p>
        </div>

        {/* Username field */}
        <div className="space-y-1">
          <label className="text-xs text-secondary font-medium">Username</label>
          <div className="flex items-center gap-2 bg-background border border-border rounded-lg px-3 py-2">
            <span className="flex-1 font-mono text-xs text-primary-text truncate">
              {credential.username}
            </span>
            <button
              onClick={() => copyToClipboard(credential.username, "username")}
              className="p-1 rounded text-muted hover:text-primary-text transition-colors"
              title="Copy username"
            >
              {copiedField === "username" ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
            </button>
          </div>
        </div>

        {/* Password field */}
        <div className="space-y-1">
          <label className="text-xs text-secondary font-medium">Password</label>
          <div className="flex items-center gap-2 bg-background border border-border rounded-lg px-3 py-2">
            <span className="flex-1 font-mono text-xs text-primary-text truncate">
              {credential.password}
            </span>
            <button
              onClick={() => copyToClipboard(credential.password, "password")}
              className="p-1 rounded text-muted hover:text-primary-text transition-colors"
              title="Copy password"
            >
              {copiedField === "password" ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
            </button>
          </div>
        </div>

        {/* Dismiss button */}
        <button
          onClick={onClose}
          className="w-full py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  );
}
