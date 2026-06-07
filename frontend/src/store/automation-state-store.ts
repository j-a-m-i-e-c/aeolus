// frontend/src/store/automation-state-store.ts — Zustand store for per-rule automation state

import { create } from "zustand";
import { authFetch } from "../lib/auth-fetch";

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

/** Send a state update to the backend (used as aeolus.save in custom components) */
export function sendStateUpdate(ruleId: string, key: string, value: unknown): void {
  fetch(`${API_URL}/api/automations/${ruleId}/state`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, value }),
  }).catch(() => {
    // Silently degrade — WebSocket will sync state
  });
}

/**
 * Persist a state value AND immediately fire the Logic tab with
 * topic "ui/{ruleId}/state-set" and state { key, value }.
 */
export function sendStateUpdateAndFire(ruleId: string, key: string, value: unknown): void {
  // 1. Persist to state store
  sendStateUpdate(ruleId, key, value);

  // 2. Fire the Logic tab with context override
  authFetch(`${API_URL}/api/automations/${ruleId}/fire`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      context: {
        topic: `ui/${ruleId}/state-set`,
        state: { key, value },
      },
    }),
  }).catch(() => {
    // Silently degrade
  });
}
