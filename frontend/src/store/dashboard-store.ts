// frontend/src/store/dashboard-store.ts — Zustand store for dashboard layout state

import { create } from "zustand";
import type { Tab, Pane, PaneConfig } from "../types/dashboard";
import { PANE_REGISTRY } from "../lib/pane-registry";

interface DashboardState {
  tabs: Tab[];
  panes: Pane[];
  activeTabId: string | null;
  initialized: boolean;

  // Tab actions
  addTab: (name: string, icon: string) => void;
  renameTab: (tabId: string, name: string) => void;
  reorderTabs: (orderedIds: string[]) => void;
  deleteTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;

  // Pane actions
  addPane: (tabId: string, paneType: string) => void;
  updatePanePosition: (paneId: string, x: number, y: number) => void;
  updatePaneSize: (paneId: string, w: number, h: number) => void;
  updatePaneConfig: (paneId: string, config: PaneConfig) => void;
  removePane: (paneId: string) => void;

  // Persistence
  initialize: () => Promise<void>;
  persistLayout: () => void;
}

// ---------------------------------------------------------------------------
// Debounced persist — actual API call added in task 5.2
// ---------------------------------------------------------------------------

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 2000;

function debouncedPersist(getState: () => DashboardState): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    getState().persistLayout();
  }, DEBOUNCE_MS);
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useDashboardStore = create<DashboardState>((set, get) => ({
  tabs: [],
  panes: [],
  activeTabId: null,
  initialized: false,

  // ---- Tab actions ----

  addTab: (name, icon) => {
    if (!name.trim()) return;
    const state = get();
    const newTab: Tab = {
      id: crypto.randomUUID(),
      name: name.trim(),
      icon,
      order: state.tabs.length,
      pinned: false,
      createdAt: Date.now(),
    };
    set({ tabs: [...state.tabs, newTab] });
    debouncedPersist(get);
  },

  renameTab: (tabId, name) => {
    if (!name.trim()) return;
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, name: name.trim() } : t)),
    }));
    debouncedPersist(get);
  },

  reorderTabs: (orderedIds) => {
    set((state) => {
      const pinned = state.tabs.filter((t) => t.pinned);
      const unpinned = state.tabs.filter((t) => !t.pinned);

      // Only reorder unpinned tabs according to orderedIds
      const unpinnedById = new Map(unpinned.map((t) => [t.id, t]));
      const reordered: Tab[] = [];
      for (const id of orderedIds) {
        const tab = unpinnedById.get(id);
        if (tab) reordered.push(tab);
      }
      // Append any unpinned tabs not in orderedIds (preserve them)
      for (const tab of unpinned) {
        if (!orderedIds.includes(tab.id)) reordered.push(tab);
      }

      // Reassign order: pinned first, then reordered unpinned
      const allTabs = [
        ...pinned.map((t, i) => ({ ...t, order: i })),
        ...reordered.map((t, i) => ({ ...t, order: pinned.length + i })),
      ];
      return { tabs: allTabs };
    });
    debouncedPersist(get);
  },

  deleteTab: (tabId) => {
    const state = get();
    const tab = state.tabs.find((t) => t.id === tabId);
    if (!tab || tab.pinned) return;

    set({
      tabs: state.tabs.filter((t) => t.id !== tabId),
      panes: state.panes.filter((p) => p.tabId !== tabId),
      activeTabId: state.activeTabId === tabId ? (state.tabs[0]?.id ?? null) : state.activeTabId,
    });
    debouncedPersist(get);
  },

  setActiveTab: (tabId) => {
    set({ activeTabId: tabId });
  },

  // ---- Pane actions ----

  addPane: (tabId, paneType) => {
    const entry = PANE_REGISTRY[paneType];
    const defaultSize = entry?.defaultSize ?? { w: 6, h: 4 };
    const defaultConfig = entry?.defaultConfig ?? {};

    const newPane: Pane = {
      id: crypto.randomUUID(),
      tabId,
      paneType,
      config: { ...defaultConfig },
      x: 0,
      y: 0,
      w: defaultSize.w,
      h: defaultSize.h,
      createdAt: Date.now(),
    };
    set((state) => ({ panes: [...state.panes, newPane] }));
    debouncedPersist(get);
  },

  updatePanePosition: (paneId, x, y) => {
    set((state) => ({
      panes: state.panes.map((p) => (p.id === paneId ? { ...p, x, y } : p)),
    }));
    debouncedPersist(get);
  },

  updatePaneSize: (paneId, w, h) => {
    set((state) => ({
      panes: state.panes.map((p) => (p.id === paneId ? { ...p, w, h } : p)),
    }));
    debouncedPersist(get);
  },

  updatePaneConfig: (paneId, config) => {
    set((state) => ({
      panes: state.panes.map((p) => (p.id === paneId ? { ...p, config } : p)),
    }));
    debouncedPersist(get);
  },

  removePane: (paneId) => {
    set((state) => ({
      panes: state.panes.filter((p) => p.id !== paneId),
    }));
    debouncedPersist(get);
  },

  // ---- Persistence (API integration added in task 5.2) ----

  initialize: async () => {
    // Stub — task 5.2 will implement GET /api/layout + default layout seeding
    set({ initialized: true });
  },

  persistLayout: () => {
    // Stub — task 5.2 will implement PUT /api/layout
  },
}));
