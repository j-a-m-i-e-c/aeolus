// frontend/src/components/CommandPalette.tsx — Cmd+K quick search

import { useState, useEffect, useRef, useMemo } from "react";
import { useDeviceStore } from "../store/device-store";
import { sendAction, publishMqtt } from "../lib/api-client";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Lightbulb, Thermometer, ToggleLeft, Wind, Send } from "lucide-react";

const TYPE_ICONS = { light: Lightbulb, sensor: Thermometer, switch: ToggleLeft, climate: Wind };

interface CommandPaletteProps {
  onSelectDevice: (id: string) => void;
}

export function CommandPalette({ onSelectDevice }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const devices = useDeviceStore((s) => s.devices);

  // Cmd+K / Ctrl+K to toggle
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        setQuery("");
        setSelectedIdx(0);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const results = useMemo(() => {
    const items: { id: string; label: string; detail: string; type: "device" | "publish"; deviceType?: string }[] = [];

    // Device results
    for (const device of Object.values(devices)) {
      if (!query || device.name.toLowerCase().includes(query.toLowerCase()) || device.id.includes(query.toLowerCase())) {
        items.push({
          id: device.id,
          label: device.name,
          detail: `${device.type} · ${device.id}`,
          type: "device",
          deviceType: device.type,
        });
      }
    }

    // Publish action if query looks like a topic
    if (query.includes("/")) {
      items.push({
        id: "publish",
        label: `Publish to ${query}`,
        detail: "Send MQTT message",
        type: "publish",
      });
    }

    return items.slice(0, 10);
  }, [devices, query]);

  useEffect(() => { setSelectedIdx(0); }, [query]);

  const handleSelect = async (item: typeof results[0]) => {
    if (item.type === "device") {
      onSelectDevice(item.id);
    } else if (item.type === "publish") {
      const payload = prompt("Payload:");
      if (payload !== null) {
        await publishMqtt(query, payload);
      }
    }
    setOpen(false);
    setQuery("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[selectedIdx]) {
      handleSelect(results[selectedIdx]);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] bg-black/50 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="bg-surface border border-[#2A3441] rounded-xl w-full max-w-md shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 px-4 py-3 border-b border-[#2A3441]">
              <Search size={16} className="text-[#6B7785]" />
              <input
                ref={inputRef}
                type="text"
                placeholder="Search devices or type a topic to publish..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                className="flex-1 bg-transparent text-sm text-[#E6EDF3] placeholder-[#6B7785] outline-none"
              />
              <kbd className="text-[10px] text-[#6B7785] bg-elevated px-1.5 py-0.5 rounded border border-[#2A3441]">ESC</kbd>
            </div>
            {results.length > 0 && (
              <div className="max-h-64 overflow-y-auto py-1">
                {results.map((item, i) => {
                  const Icon = item.type === "publish" ? Send : TYPE_ICONS[item.deviceType as keyof typeof TYPE_ICONS] || ToggleLeft;
                  return (
                    <div
                      key={item.id}
                      className={`flex items-center gap-3 px-4 py-2 cursor-pointer text-sm ${
                        i === selectedIdx ? "bg-primary/10 text-[#E6EDF3]" : "text-[#9AA6B2] hover:bg-elevated/50"
                      }`}
                      onClick={() => handleSelect(item)}
                      onMouseEnter={() => setSelectedIdx(i)}
                    >
                      <Icon size={14} className={i === selectedIdx ? "text-primary" : "text-[#6B7785]"} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate">{item.label}</div>
                        <div className="text-[10px] text-[#6B7785] font-mono truncate">{item.detail}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {results.length === 0 && query && (
              <div className="px-4 py-6 text-center text-[#6B7785] text-xs">No results</div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}