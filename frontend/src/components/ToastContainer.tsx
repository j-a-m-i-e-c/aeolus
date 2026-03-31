// frontend/src/components/ToastContainer.tsx — Animated toast notifications

import { useEffect, useRef } from "react";
import { useDeviceStore } from "../store/device-store";
import { motion, AnimatePresence } from "framer-motion";
import { Zap, Radio, X } from "lucide-react";
import { create } from "zustand";

interface Toast {
  id: string;
  type: "automation" | "device";
  message: string;
  detail?: string;
  timestamp: number;
}

interface ToastState {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, "id">) => void;
  removeToast: (id: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  addToast: (toast) =>
    set((prev) => ({
      toasts: [
        ...prev.toasts,
        { ...toast, id: `${toast.timestamp}-${Math.random().toString(36).slice(2, 6)}` },
      ].slice(-5), // Keep max 5
    })),
  removeToast: (id) =>
    set((prev) => ({ toasts: prev.toasts.filter((t) => t.id !== id) })),
}));

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);
  const addToast = useToastStore((s) => s.addToast);
  const automationEvents = useDeviceStore((s) => s.automationEvents);
  const lastEventRef = useRef(0);

  // Watch for new automation events
  useEffect(() => {
    if (automationEvents.length === 0) return;
    const latest = automationEvents[0];
    if (latest.timestamp > lastEventRef.current) {
      lastEventRef.current = latest.timestamp;
      addToast({
        type: "automation",
        message: latest.ruleName,
        detail: `${latest.topic} → ${latest.deviceId}`,
        timestamp: latest.timestamp,
      });
    }
  }, [automationEvents, addToast]);

  // Auto-dismiss after 4 seconds
  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = setTimeout(() => {
      removeToast(toasts[0].id);
    }, 4000);
    return () => clearTimeout(timer);
  }, [toasts, removeToast]);

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 100, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="pointer-events-auto bg-surface border border-[#2A3441] rounded-lg px-4 py-3 shadow-xl shadow-black/30 flex items-start gap-3 min-w-[280px] max-w-[360px]"
          >
            {toast.type === "automation" ? (
              <Zap size={14} className="text-accent shrink-0 mt-0.5" />
            ) : (
              <Radio size={14} className="text-primary shrink-0 mt-0.5" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-[#E6EDF3] truncate">{toast.message}</div>
              {toast.detail && (
                <div className="text-[10px] text-[#6B7785] font-mono truncate mt-0.5">{toast.detail}</div>
              )}
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="text-[#6B7785] hover:text-[#E6EDF3] transition-colors shrink-0"
            >
              <X size={12} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
