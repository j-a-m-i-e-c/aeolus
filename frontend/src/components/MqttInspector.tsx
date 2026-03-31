// frontend/src/components/MqttInspector.tsx — Live MQTT message feed

import { useState } from "react";
import { useDeviceStore } from "../store/device-store";
import { Radio, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export function MqttInspector() {
  const messages = useDeviceStore((s) => s.mqttMessages);
  const clearMessages = useDeviceStore((s) => s.clearMqttMessages);
  const [expanded, setExpanded] = useState(true);
  const [filter, setFilter] = useState("");

  const filtered = filter
    ? messages.filter((m) => m.topic.toLowerCase().includes(filter.toLowerCase()))
    : messages;

  return (
    <div className="bg-surface border border-[#2A3441] rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#2A3441]">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-sm font-semibold text-[#9AA6B2] uppercase tracking-wider hover:text-[#E6EDF3] transition-colors"
        >
          <Radio size={14} className="text-primary" />
          MQTT Inspector
          {messages.length > 0 && (
            <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded-full font-mono">
              {messages.length}
            </span>
          )}
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        <div className="flex items-center gap-2">
          {expanded && (
            <input
              type="text"
              placeholder="Filter topics..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="text-xs bg-background border border-[#2A3441] rounded px-2 py-1 text-[#E6EDF3] placeholder-[#6B7785] w-40 focus:outline-none focus:border-primary"
            />
          )}
          <button
            onClick={clearMessages}
            className="text-[#6B7785] hover:text-[#EF4444] transition-colors"
            title="Clear messages"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Message feed */}
      {expanded && (
        <div className="max-h-64 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-[#6B7785] text-xs">
              {messages.length === 0
                ? "Waiting for MQTT messages..."
                : "No messages match filter"}
            </div>
          ) : (
            <div className="divide-y divide-[#2A3441]">
              <AnimatePresence initial={false}>
                {filtered.map((msg, i) => (
                  <motion.div
                    key={`${msg.timestamp}-${i}`}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.15 }}
                    className="px-4 py-2 flex items-start gap-4 text-xs hover:bg-elevated/50"
                  >
                    <span className="text-[#6B7785] font-mono shrink-0 w-16">
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </span>
                    <span className="text-primary font-mono shrink-0 min-w-0 truncate max-w-[200px]" title={msg.topic}>
                      {msg.topic}
                    </span>
                    <span className="text-accent font-mono truncate" title={msg.payload}>
                      {msg.payload}
                    </span>
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
