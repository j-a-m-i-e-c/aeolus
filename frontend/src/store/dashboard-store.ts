// frontend/src/store/dashboard-store.ts — Zustand store for dashboard layout state

import { create } from "zustand";
import type { Tab, Pane, PaneConfig } from "../types/dashboard";
import { DEFAULT_TABS, DEFAULT_PANES } from "../types/dashboard";
import { PANE_REGISTRY } from "../lib/pane-registry";
import { fetchLayout, saveLayout, deleteAutomation } from "../lib/api-client";

/** Generate a UUID that works in non-secure contexts (HTTP) */
function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for non-secure contexts (HTTP on LAN)
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

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
  addPane: (tabId: string, paneType: string, config?: PaneConfig) => void;
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

/** Convert a tab name to a URL-safe slug */
export function tabNameToSlug(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

/** Reserved slugs that cannot be used for custom tabs */
const RESERVED_SLUGS = new Set(["dashboard", "connectors", "data-store", "security"]);

export const useDashboardStore = create<DashboardState>((set, get) => ({
  tabs: [],
  panes: [],
  activeTabId: null,
  initialized: false,

  // ---- Tab actions ----

  addTab: (name, icon) => {
    if (!name.trim()) return;
    const state = get();
    const slug = tabNameToSlug(name);

    // Reject empty slugs, reserved names, and duplicates
    if (!slug || RESERVED_SLUGS.has(slug)) return;
    const existingSlugs = new Set(state.tabs.map((t) => tabNameToSlug(t.name)));
    if (existingSlugs.has(slug)) return;

    const newTab: Tab = {
      id: generateId(),
      name: name.trim(),
      icon,
      order: state.tabs.length,
      pinned: false,
      createdAt: Date.now(),
    };
    set({ tabs: [...state.tabs, newTab], activeTabId: newTab.id });
    debouncedPersist(get);
  },

  renameTab: (tabId, name) => {
    if (!name.trim()) return;
    const state = get();
    const slug = tabNameToSlug(name);

    // Reject empty slugs, reserved names, and duplicates (excluding the tab being renamed)
    if (!slug || RESERVED_SLUGS.has(slug)) return;
    const existingSlugs = new Set(
      state.tabs.filter((t) => t.id !== tabId).map((t) => tabNameToSlug(t.name)),
    );
    if (existingSlugs.has(slug)) return;

    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, name: name.trim() } : t)),
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

  addPane: (tabId, paneType, config) => {
    const entry = PANE_REGISTRY[paneType];
    const defaultSize = entry?.defaultSize ?? { w: 6, h: 4 };
    const defaultConfig = entry?.defaultConfig ?? {};

    const newPane: Pane = {
      id: generateId(),
      tabId,
      paneType,
      config: { ...defaultConfig, ...config },
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
    const state = get();
    const pane = state.panes.find((p) => p.id === paneId);

    // If this is an automation pane with a linked rule, delete the rule from the backend
    if (pane?.paneType === "automation" && pane.config?.ruleId) {
      deleteAutomation(pane.config.ruleId as string).catch(() => {
        // Non-critical — rule may already be deleted
      });
    }

    set({ panes: state.panes.filter((p) => p.id !== paneId) });
    debouncedPersist(get);
  },

  // ---- Persistence (API integration added in task 5.2) ----

  initialize: async () => {
    try {
      const layout = await fetchLayout();
      // Always include pinned tabs from DEFAULT_TABS — they're hardcoded system navigation
      const pinnedTabs = DEFAULT_TABS.filter((t) => t.pinned);
      const savedCustomTabs = (layout.tabs || []).filter((t: Tab) => !t.pinned);
      const allTabs = [...pinnedTabs, ...savedCustomTabs];
      const panes = layout.panes || DEFAULT_PANES;
      set({ tabs: allTabs, panes, activeTabId: allTabs[0]?.id ?? null, initialized: true });
    } catch (err) {
      console.warn("[dashboard-store] Failed to fetch layout, using defaults:", err);
      set({ tabs: DEFAULT_TABS, panes: DEFAULT_PANES, activeTabId: DEFAULT_TABS[0]?.id ?? null, initialized: true });
    }
  },

  persistLayout: () => {
    const { tabs, panes } = get();
    // Only persist custom (unpinned) tabs — pinned tabs are hardcoded
    const customTabs = tabs.filter((t) => !t.pinned);
    saveLayout({ tabs: customTabs, panes }).catch((err) => {
      console.warn("[dashboard-store] Failed to persist layout:", err);
    });
  },
}));
