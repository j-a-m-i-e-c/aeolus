// frontend/src/store/configuration-invalidation-store.ts — remote authoring invalidations.

import { create } from "zustand";

export interface AutomationInvalidation {
  id: string;
  revision: number | null;
  deleted: boolean;
  mutationId?: string | null;
  sequence: number;
}

interface ConfigurationInvalidationState {
  automationById: Record<string, AutomationInvalidation>;
  automationSequence: number;
  reconcileSequence: number;
  noteAutomation: (change: Omit<AutomationInvalidation, "sequence">) => void;
  noteReconcile: () => void;
}

let sequence = 0;

export const useConfigurationInvalidationStore = create<ConfigurationInvalidationState>((set) => ({
  automationById: {},
  automationSequence: 0,
  reconcileSequence: 0,
  noteAutomation: (change) => {
    sequence += 1;
    const next = { ...change, sequence };
    set((state) => ({
      automationById: { ...state.automationById, [change.id]: next },
      automationSequence: sequence,
    }));
  },
  noteReconcile: () => {
    sequence += 1;
    set({ reconcileSequence: sequence });
  },
}));
