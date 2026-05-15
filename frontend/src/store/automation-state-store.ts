// frontend/src/store/automation-state-store.ts — Zustand store for per-rule automation state

import { create } from "zustand";

const API_URL =
  import.meta.env.VITE_API_URL ||
  `http://${window.location.hostname}:3001`;

interface AutomationStateState {
  /** Per-rule state stored as plain objects for Zustand compatibility */
  stateByRule: Record<string, Record<string, unknown>>;
  /** Merge a single key-value into a rule's state */
  setRuleState: (ruleId: string, key: string, value: unknown) => void;
  /** Set the full state snapshot for a rule (from API response) */
  initRuleState: (ruleId: string, state: Record<string, unknown>) => void;
  /** Remove all state for a rule */
  clearRuleState: (ruleId: string) => void;
}

export const useAutomationStateStore = create<AutomationStateState>((set) => ({
  stateByRule: {},
  setRuleState: (ruleId, key, value) =>
    set((prev) => ({
      stateByRule: {
        ...prev.stateByRule,
        [ruleId]: { ...(prev.stateByRule[ruleId] || {}), [key]: value },
      },
    })),
  initRuleState: (ruleId, state) =>
    set((prev) => ({
      stateByRule: { ...prev.stateByRule, [ruleId]: state },
    })),
  clearRuleState: (ruleId) =>
    set((prev) => {
      const { [ruleId]: _, ...rest } = prev.stateByRule;
      return { stateByRule: rest };
    }),
}));

/** Send a state update to the backend (used as props.stateSet in custom components) */
export function sendStateUpdate(ruleId: string, key: string, value: unknown): void {
  fetch(`${API_URL}/api/automations/${ruleId}/state`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, value }),
  }).catch(() => {
    // Silently degrade — WebSocket will sync state
  });
}
