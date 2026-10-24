// frontend/src/pages/SecurityPage.tsx — Unified Security page with section tabs

import { useState, useCallback } from "react";
import { Shield, Users } from "lucide-react";
import { useAuthStore } from "../store/auth-store";
import { PUBLIC_DEMO } from "../lib/env";
import MqttSecurityPage from "./MqttSecurityPage";
import { GroupManagementPage } from "./GroupManagementPage";
import { UserManagementPage } from "./UserManagementPage";

type SecuritySection = "mqtt" | "users";

const SECTIONS: { id: SecuritySection; label: string; icon: typeof Shield }[] = [
  { id: "users", label: "Users & Groups", icon: Users },
  { id: "mqtt", label: "MQTT", icon: Shield },
];

export default function SecurityPage() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === "admin";
  const [activeSection, setActiveSection] = useState<SecuritySection>("users");
  const [groupVersion, setGroupVersion] = useState(0);

  const onGroupsChanged = useCallback(() => {
    setGroupVersion((v) => v + 1);
  }, []);

  // Public-demo sessions get a read-only view of the security model; the
  // underlying pages render without mutating controls (useReadOnlyDemo) and the
  // backend serves the reads scrubbed (real usernames/credentials masked).
  if (!isAdmin && !PUBLIC_DEMO) {
    return (
      <div className="flex items-center justify-center h-full min-h-[60vh]">
        <div className="text-[#6B7785] text-sm">Access denied — admin only</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-[#E6EDF3] mb-1">Security</h1>
        <p className="text-sm text-[#6B7785]">Manage dashboard access and MQTT broker authentication.</p>
        {PUBLIC_DEMO && !isAdmin && <p className="mt-1 text-xs text-[#72B7E6]">Public demo: open the editors and change fields freely. Account, group and broker changes cannot be saved.</p>}
      </div>

      {/* Section tabs */}
      <div className="flex gap-1 border-b border-[#2A3441]">
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveSection(id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors relative ${
              activeSection === id
                ? "text-[#E6EDF3]"
                : "text-[#6B7785] hover:text-[#9AA6B2]"
            }`}
          >
            <Icon size={15} />
            {label}
            {activeSection === id && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#3BA4FF] rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Section content */}
      {activeSection === "mqtt" && <MqttSecurityPage />}
      {activeSection === "users" && (
        <div className="space-y-8">
          <GroupManagementPage onGroupsChanged={onGroupsChanged} />
          <UserManagementPage key={groupVersion} />
        </div>
      )}
    </div>
  );
}
