// frontend/src/store/panel-state-store.ts — Zustand store for per-panel custom panel state

import { create } from "zustand";

const API_URL =
  (import.meta as any).env?.VITE_API_URL ||
  `http://${window.location.hostname}:3001`;

interface PanelStateState {
  /** Per-panel state stored as plain objects for Zustand compatibility */
  stateByPanel: Record<string, Record<string, unknown>>;
  /** Merge a single key-value into a panel's state */
  setPanelState: (panelId: string, key: string, value: unknown) => void;
  /** Set the full state snapshot for a panel (from API response) */
  initPanelState: (panelId: string, state: Record<string, unknown>) => void;
  /** Remove all state for a panel */
  clearPanelState: (panelId: string) => void;
}

export const usePanelStateStore = create<PanelStateState>((set) => ({
  stateByPanel: {},
  setPanelState: (panelId, key, value) =>
    set((prev) => ({
      stateByPanel: {
        ...prev.stateByPanel,
        [panelId]: { ...(prev.stateByPanel[panelId] || {}), [key]: value },
      },
    })),
  initPanelState: (panelId, state) =>
    set((prev) => ({
      stateByPanel: { ...prev.stateByPanel, [panelId]: state },
    })),
  clearPanelState: (panelId) =>
    set((prev) => {
      const { [panelId]: _, ...rest } = prev.stateByPanel;
      return { stateByPanel: rest };
    }),
}));

/** Send a state update to the backend (used as props.stateSet in custom panel components) */
export function sendPanelStateUpdate(panelId: string, key: string, value: unknown): void {
  fetch(`${API_URL}/api/panels/${panelId}/state`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, value }),
  }).catch(() => {
    // Silently degrade — WebSocket will sync state
  });
}
