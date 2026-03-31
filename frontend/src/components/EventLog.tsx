// frontend/src/components/EventLog.tsx — Automation event log

import { useState } from "react";
import { useDeviceStore } from "../store/device-store";
import { Zap, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export function EventLog() {
  const events = useDeviceStore((s) => s.automationEvents);
  const clearEvents = useDeviceStore((s) => s.clearAutomationEvents);
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="bg-surface border border-[#2A3441] rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#2A3441]">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-sm font-semibold text-[#9AA6B2] uppercase tracking-wider hover:text-[#E6EDF3] transition-colors"
        >
          <Zap size={14} className="text-accent" />
          Event Log
          {events.length > 0 && (
            <span className="text-[10px] bg-accent/20 text-accent px-1.5 py-0.5 rounded-full font-mono">
              {events.length}
            </span>
          )}
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        <button
          onClick={clearEvents}
          className="text-[#6B7785] hover:text-[#EF4444] transition-colors"
          title="Clear events"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {expanded && (
        <div className="max-h-48 overflow-y-auto">
          {events.length === 0 ? (
            <div className="px-4 py-6 text-center text-[#6B7785] text-xs">
              No automation events yet — rules fire when matching MQTT messages arrive
            </div>
          ) : (
            <div className="divide-y divide-[#2A3441]">
              <AnimatePresence initial={false}>
                {events.map((event, i) => (
                  <motion.div
                    key={`${event.timestamp}-${i}`}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.15 }}
                    className="px-4 py-2 flex items-start gap-3 text-xs hover:bg-elevated/50"
                  >
                    <span className="text-[#6B7785] font-mono shrink-0 w-16">
                      {new Date(event.timestamp).toLocaleTimeString()}
                    </span>
                    <Zap size={10} className="text-accent shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <span className="text-accent font-medium">{event.ruleName}</span>
                      <span className="text-[#6B7785] mx-1">triggered by</span>
                      <span className="text-primary font-mono">{event.topic}</span>
                      <span className="text-[#6B7785] mx-1">→</span>
                      <span className="text-[#9AA6B2] font-mono">{event.deviceId}</span>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
