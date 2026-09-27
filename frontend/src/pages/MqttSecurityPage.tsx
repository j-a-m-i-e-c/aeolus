// frontend/src/pages/MqttSecurityPage.tsx — MQTT security level management page

import { useEffect, useState } from "react";
import { Shield, Loader2 } from "lucide-react";
import { useMqttProvisioningStore } from "../store/mqtt-provisioning-store";
import SecurityLevelSelector from "../components/mqtt/SecurityLevelSelector";
import SharedPasswordPanel from "../components/mqtt/SharedPasswordPanel";
import DeviceCredentialList from "../components/mqtt/DeviceCredentialList";

export default function MqttSecurityPage() {
  const { level, loading, managedProvisioningEnabled, fetchStatus } = useMqttProvisioningStore();
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    fetchStatus().then(() => setInitialized(true));
  }, [fetchStatus]);

  if (!initialized && loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={20} className="animate-spin text-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center gap-2">
        <Shield size={18} className="text-primary" />
        <h1 className="text-lg font-semibold text-primary">MQTT Security</h1>
      </div>

      {/* Security level selector — always visible */}
      <div className="bg-surface border border-border rounded-xl p-5">
        <SecurityLevelSelector />
      </div>

      {!managedProvisioningEnabled && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
          Managed broker provisioning is not enabled in this deployment, so Aeolus will not write Mosquitto&apos;s
          configuration. Set <code className="font-mono text-xs">MQTT_MANAGED_PROVISIONING_ENABLED=true</code> to
          manage Shared Password from here; Per-Device mode is still under development. These are standard broker
          configurations either way, so you can also set them up on the host.
        </div>
      )}

      {/* Conditional panels based on active security level */}
      {managedProvisioningEnabled && level === "shared_password" && (
        <div className="bg-surface border border-border rounded-xl p-5">
          <SharedPasswordPanel />
        </div>
      )}

      {managedProvisioningEnabled && level === "per_device" && (
        <>
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
            Per-Device mode is under development. Credentials are created and enforced by the broker, but
            revocation is not yet conclusively verified: deleting a credential is checked with a probe that
            cannot prove the previous password stopped working. Prefer Shared Password for a deployment you are
            relying on.
          </div>
          <div className="bg-surface border border-border rounded-xl p-5">
            <DeviceCredentialList />
          </div>
        </>
      )}
    </div>
  );
}
