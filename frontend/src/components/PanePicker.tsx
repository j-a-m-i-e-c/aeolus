// frontend/src/components/PanePicker.tsx — Modal overlay listing available pane types

import { useEffect, useRef } from "react";
import * as icons from "lucide-react";
import { X } from "lucide-react";
import { PANE_REGISTRY } from "../lib/pane-registry";
import { useDashboardStore } from "../store/dashboard-store";

// ---------------------------------------------------------------------------
// Dynamic Lucide icon helper (same pattern as Sidebar.tsx)
// ---------------------------------------------------------------------------

function DynamicIcon({ name, size, className }: { name: string; size?: number; className?: string }) {
  const Icon = (icons as Record<string, unknown>)[
    name.charAt(0).toUpperCase() + name.slice(1).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
  ] as React.ComponentType<{ size?: number; className?: string }> | undefined;
  if (!Icon) return <icons.Layout size={size} className={className} />;
  return <Icon size={size} className={className} />;
}

// ---------------------------------------------------------------------------
// PanePicker
// ---------------------------------------------------------------------------

interface PanePickerProps {
  tabId: string;
  onClose: () => void;
}

const paneEntries = Object.entries(PANE_REGISTRY);

export function PanePicker({ tabId, onClose }: PanePickerProps) {
  const addPane = useDashboardStore((s) => s.addPane);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (overlayRef.current && !overlayRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const handleSelect = (paneType: string) => {
    addPane(tabId, paneType);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        ref={overlayRef}
        className="bg-surface border border-[#2A3441] rounded-xl p-4 w-full max-w-md shadow-xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-[#E6EDF3]">Add Pane</h3>
          <button
            onClick={onClose}
            className="p-1 rounded text-[#6B7785] hover:text-[#9AA6B2] hover:bg-elevated transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Pane type grid */}
        <div className="grid grid-cols-2 gap-2">
          {paneEntries.map(([key, entry]) => (
            <button
              key={key}
              onClick={() => handleSelect(key)}
              className="flex items-center gap-3 px-3 py-3 rounded-lg text-left text-sm text-[#9AA6B2] hover:text-[#E6EDF3] hover:bg-elevated/50 border border-transparent hover:border-[#2A3441] transition-colors"
            >
              <DynamicIcon name={entry.defaultIcon} size={18} className="shrink-0 text-primary" />
              <span className="truncate">{entry.displayName}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
