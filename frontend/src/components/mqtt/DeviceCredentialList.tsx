// frontend/src/components/mqtt/DeviceCredentialList.tsx — Per-device credential management

import { useEffect, useState } from "react";
import { Shield, Plus, Trash2 } from "lucide-react";
import { useMqttProvisioningStore } from "../../store/mqtt-provisioning-store";
import type { MqttCredential } from "../../store/mqtt-provisioning-store";
import CredentialCreatedDialog from "./CredentialCreatedDialog";

export default function DeviceCredentialList() {
  const { credentials, fetchCredentials, createCredential, revokeCredential } =
    useMqttProvisioningStore();

  const [deviceName, setDeviceName] = useState("");
  const [createdCredential, setCreatedCredential] = useState<MqttCredential | null>(null);

  useEffect(() => {
    fetchCredentials();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = deviceName.trim();
    if (!name) return;

    try {
      const credential = await createCredential(name);
      setCreatedCredential(credential);
      setDeviceName("");
    } catch {
      // Store already logs the error
    }
  };

  const handleRevoke = (id: string, name: string) => {
    const confirmed = window.confirm(
      `Revoke credential for "${name}"? The device will no longer be able to connect.`,
    );
    if (confirmed) {
      revokeCredential(id);
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Shield size={16} className="text-primary" />
        <h2 className="text-sm font-semibold text-primary-text">Device Credentials</h2>
      </div>

      {/* Create credential form */}
      <form onSubmit={handleCreate} className="flex items-center gap-2">
        <input
          type="text"
          value={deviceName}
          onChange={(e) => setDeviceName(e.target.value)}
          placeholder="Device name"
          className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm text-primary-text placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-primary"
          maxLength={64}
        />
        <button
          type="submit"
          disabled={!deviceName.trim()}
          className="flex items-center gap-1.5 px-3 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Plus size={14} />
          Create
        </button>
      </form>

      {/* Credentials table */}
      {credentials.length === 0 ? (
        <p className="text-sm text-muted py-4 text-center">No device credentials yet</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="pb-2 font-medium text-secondary">Device Name</th>
                <th className="pb-2 font-medium text-secondary">Username</th>
                <th className="pb-2 font-medium text-secondary">Created</th>
                <th className="pb-2 font-medium text-secondary text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {credentials.map((cred) => (
                <tr key={cred.id} className="border-b border-border/50 last:border-0">
                  <td className="py-2.5 text-primary-text">{cred.deviceName}</td>
                  <td className="py-2.5 font-mono text-xs text-secondary">{cred.username}</td>
                  <td className="py-2.5 text-secondary">{formatDate(cred.createdAt)}</td>
                  <td className="py-2.5 text-right">
                    <button
                      onClick={() => handleRevoke(cred.id, cred.deviceName)}
                      className="p-1.5 rounded-md text-muted hover:text-red-400 hover:bg-red-400/10 transition-colors"
                      title={`Revoke credential for ${cred.deviceName}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Credential created dialog */}
      {createdCredential && (
        <CredentialCreatedDialog
          credential={createdCredential}
          onClose={() => setCreatedCredential(null)}
        />
      )}
    </div>
  );
}
