// frontend/src/pages/MqttSecurityPage.tsx — MQTT security level management page

import { useEffect, useState } from "react";
import { Shield, Loader2 } from "lucide-react";
import { useMqttProvisioningStore } from "../store/mqtt-provisioning-store";
import SecurityLevelSelector from "../components/mqtt/SecurityLevelSelector";
import SharedPasswordPanel from "../components/mqtt/SharedPasswordPanel";
import DeviceCredentialList from "../components/mqtt/DeviceCredentialList";

export default function MqttSecurityPage() {
  const { level, loading, brokerManagementAvailable, fetchStatus } = useMqttProvisioningStore();
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
      <div className="flex items-center gap-2">
        <Shield size={18} className="text-primary" />
        <h1 className="text-lg font-semibold text-primary">MQTT Security</h1>
      </div>

      <div className="bg-surface border border-border rounded-xl p-5">
        <SecurityLevelSelector />
      </div>

      {!brokerManagementAvailable && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
          This runtime is not connected to Aeolus&apos; managed Mosquitto configuration. The standard Docker Compose
          deployment includes this integration automatically.
        </div>
      )}

      {brokerManagementAvailable && level === "shared_password" && (
        <div className="bg-surface border border-border rounded-xl p-5">
          <SharedPasswordPanel />
        </div>
      )}

      {brokerManagementAvailable && level === "per_device" && (
        <div className="bg-surface border border-border rounded-xl p-5">
          <DeviceCredentialList />
        </div>
      )}
    </div>
  );
}
