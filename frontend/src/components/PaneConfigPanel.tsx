// frontend/src/components/PaneConfigPanel.tsx — Slide-out config panel for pane filters

import { useState, useEffect, useRef } from "react";
import { X, Save } from "lucide-react";
import type { PaneConfig } from "../types/dashboard";
import { useDashboardStore } from "../store/dashboard-store";
import { getPaneEntry } from "../lib/pane-registry";

interface PaneConfigPanelProps {
  paneId: string;
  paneType: string;
  config: PaneConfig;
  onClose: () => void;
}

const DEVICE_TYPE_OPTIONS = ["all", "light", "sensor", "switch", "climate"] as const;
const SYSTEM_SECTIONS = ["host", "cpu", "temperature", "memory", "disk", "network"] as const;

export function PaneConfigPanel({ paneId, paneType, config, onClose }: PaneConfigPanelProps) {
  const updatePaneConfig = useDashboardStore((s) => s.updatePaneConfig);
  const panelRef = useRef<HTMLDivElement>(null);

  // Local form state seeded from current config
  const [room, setRoom] = useState(config.room ?? "");
  const [deviceType, setDeviceType] = useState(config.deviceType ?? "all");
  const [topicPattern, setTopicPattern] = useState(config.topicPattern ?? "");
  const [showSections, setShowSections] = useState<string[]>(
    config.showSections ?? [...SYSTEM_SECTIONS],
  );

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  const toggleSection = (section: string) => {
    setShowSections((prev) =>
      prev.includes(section) ? prev.filter((s) => s !== section) : [...prev, section],
    );
  };

  const handleSave = () => {
    const newConfig: PaneConfig = {};

    switch (paneType) {
      case "device-grid": {
        if (room.trim()) newConfig.room = room.trim();
        if (deviceType && deviceType !== "all") newConfig.deviceType = deviceType;
        break;
      }
      case "sensor-panel": {
        if (room.trim()) newConfig.room = room.trim();
        break;
      }
      case "mqtt-inspector": {
        if (topicPattern.trim()) newConfig.topicPattern = topicPattern.trim();
        break;
      }
      case "system-stats": {
        if (showSections.length > 0 && showSections.length < SYSTEM_SECTIONS.length) {
          newConfig.showSections = [...showSections];
        }
        // If all selected or none, omit to show everything (unfiltered)
        break;
      }
      // hue-lights, automation-rules, topic-tree, event-log: no config fields
    }

    updatePaneConfig(paneId, newConfig);
    onClose();
  };

  const entry = getPaneEntry(paneType);
  const displayName = entry?.displayName ?? paneType;

  // Determine if this pane type has configurable fields
  const hasConfig = ["device-grid", "sensor-panel", "mqtt-inspector", "system-stats"].includes(paneType);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
      <div
        ref={panelRef}
        className="w-full max-w-sm h-full bg-surface border-l border-[#2A3441] shadow-xl flex flex-col animate-slide-in-right"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2A3441]">
          <h3 className="text-sm font-semibold text-[#E6EDF3] truncate">
            Configure: {displayName}
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded text-[#6B7785] hover:text-[#9AA6B2] hover:bg-elevated transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto px-4 py-4 space-y-4">
          {!hasConfig && (
            <p className="text-sm text-[#6B7785]">No configuration options for this pane type.</p>
          )}

          {/* device-grid config */}
          {paneType === "device-grid" && (
            <>
              <FieldLabel label="Room Filter">
                <input
                  type="text"
                  value={room}
                  onChange={(e) => setRoom(e.target.value)}
                  placeholder="e.g. kitchen, living-room"
                  className="w-full px-3 py-2 rounded-lg bg-elevated border border-[#2A3441] text-sm text-[#E6EDF3] placeholder-[#6B7785] focus:outline-none focus:border-primary transition-colors"
                />
              </FieldLabel>
              <FieldLabel label="Device Type">
                <select
                  value={deviceType}
                  onChange={(e) => setDeviceType(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-elevated border border-[#2A3441] text-sm text-[#E6EDF3] focus:outline-none focus:border-primary transition-colors"
                >
                  {DEVICE_TYPE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt.charAt(0).toUpperCase() + opt.slice(1)}
                    </option>
                  ))}
                </select>
              </FieldLabel>
            </>
          )}

          {/* sensor-panel config */}
          {paneType === "sensor-panel" && (
            <FieldLabel label="Room Filter">
              <input
                type="text"
                value={room}
                onChange={(e) => setRoom(e.target.value)}
                placeholder="e.g. kitchen, living-room"
                className="w-full px-3 py-2 rounded-lg bg-elevated border border-[#2A3441] text-sm text-[#E6EDF3] placeholder-[#6B7785] focus:outline-none focus:border-primary transition-colors"
              />
            </FieldLabel>
          )}

          {/* mqtt-inspector config */}
          {paneType === "mqtt-inspector" && (
            <FieldLabel label="Topic Pattern">
              <input
                type="text"
                value={topicPattern}
                onChange={(e) => setTopicPattern(e.target.value)}
                placeholder="e.g. sensor/+/temperature"
                className="w-full px-3 py-2 rounded-lg bg-elevated border border-[#2A3441] text-sm text-[#E6EDF3] placeholder-[#6B7785] focus:outline-none focus:border-primary transition-colors"
              />
            </FieldLabel>
          )}

          {/* system-stats config */}
          {paneType === "system-stats" && (
            <FieldLabel label="Show Sections">
              <div className="space-y-2">
                {SYSTEM_SECTIONS.map((section) => (
                  <label
                    key={section}
                    className="flex items-center gap-2 cursor-pointer text-sm text-[#9AA6B2] hover:text-[#E6EDF3] transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={showSections.includes(section)}
                      onChange={() => toggleSection(section)}
                      className="rounded border-[#2A3441] bg-elevated text-primary focus:ring-primary focus:ring-offset-0"
                    />
                    {section.charAt(0).toUpperCase() + section.slice(1)}
                  </label>
                ))}
              </div>
            </FieldLabel>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-[#2A3441] flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-[#9AA6B2] hover:text-[#E6EDF3] hover:bg-elevated/50 border border-[#2A3441] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-primary hover:bg-primary/80 transition-colors"
          >
            <Save size={13} />
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared field label wrapper
// ---------------------------------------------------------------------------

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-[#9AA6B2]">{label}</label>
      {children}
    </div>
  );
}
