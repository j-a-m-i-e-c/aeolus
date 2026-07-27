// frontend/src/components/mqtt/SecurityLevelSelector.tsx — Radio-card UI for MQTT security level selection

import { useState } from "react";
import { Key, Shield, Unlock } from "lucide-react";
import { motion } from "framer-motion";
import {
  useMqttProvisioningStore,
  type SecurityLevel,
} from "../../store/mqtt-provisioning-store";

interface LevelOption {
  level: SecurityLevel;
  icon: typeof Unlock;
  title: string;
  description: string;
}

const LEVEL_OPTIONS: LevelOption[] = [
  {
    level: "open",
    icon: Unlock,
    title: "Open",
    description: "No authentication — anyone can connect",
  },
  {
    level: "shared_password",
    icon: Key,
    title: "Shared Password",
    description: "Single credential for all devices",
  },
  {
    level: "per_device",
    icon: Shield,
    title: "Per-Device",
    description: "Unique credentials per device",
  },
];

/** Modes that have active credentials which become inactive on switch */
const MODES_WITH_CREDENTIALS: SecurityLevel[] = [
  "shared_password",
  "per_device",
];

function getConfirmationMessage(currentLevel: SecurityLevel): string {
  if (currentLevel === "per_device") {
    return "Switching away from Per-Device mode will make existing per-device credentials inactive. Continue?";
  }
  if (currentLevel === "shared_password") {
    return "Switching away from Shared Password mode will make the shared credential inactive. Continue?";
  }
  return "";
}

export default function SecurityLevelSelector() {
  const { level, setLevel, loading, managedProvisioningEnabled } = useMqttProvisioningStore();
  const [pending, setPending] = useState(false);

  const handleSelect = async (newLevel: SecurityLevel) => {
    if (
      newLevel === level
      || loading
      || pending
      || (!managedProvisioningEnabled && newLevel !== "open")
    ) return;

    // Show confirmation when switching away from modes with active credentials
    if (MODES_WITH_CREDENTIALS.includes(level)) {
      const message = getConfirmationMessage(level);
      if (!window.confirm(message)) return;
    }

    setPending(true);
    try {
      await setLevel(newLevel);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {LEVEL_OPTIONS.map(({ level: optionLevel, icon: Icon, title, description }) => {
        const isActive = optionLevel === level;
        const isUnderDevelopment = !managedProvisioningEnabled && optionLevel !== "open";
        const isDisabled = loading || pending || isUnderDevelopment;

        return (
          <motion.button
            key={optionLevel}
            type="button"
            disabled={isDisabled}
            onClick={() => handleSelect(optionLevel)}
            className={`relative flex flex-col items-start gap-2 p-4 rounded-xl border-2 transition-colors duration-200 text-left ${
              isActive
                ? "border-[#3BA4FF] bg-surface ring-1 ring-[#3BA4FF]/30"
                : "border-[#2A3441] bg-surface hover:border-[#3BA4FF]/40"
            } ${isDisabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
            whileHover={!isDisabled ? { y: -1 } : undefined}
            whileTap={!isDisabled ? { scale: 0.98 } : undefined}
            transition={{ duration: 0.15, ease: "easeOut" }}
          >
            <Icon
              size={20}
              className={isActive ? "text-[#3BA4FF]" : "text-[#6B7785]"}
            />
            <div className="flex flex-col gap-0.5">
              <span
                className={`text-sm font-medium ${
                  isActive ? "text-primary" : "text-primary"
                }`}
              >
                {title}
              </span>
              <span className="text-xs text-secondary">{description}</span>
              {isUnderDevelopment && (
                <span className="text-xs font-medium text-amber-400">Under development</span>
              )}
            </div>

            {/* Active indicator dot */}
            {isActive && (
              <motion.div
                className="absolute top-3 right-3 w-2 h-2 rounded-full bg-[#3BA4FF]"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
              />
            )}
          </motion.button>
        );
      })}
    </div>
  );
}
