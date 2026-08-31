// frontend/src/store/dashboard-store.test.ts — Unit tests for the dashboard layout store

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Stub persistence + automation deletion so debounced saves and side effects are inert.
vi.mock("../lib/api-client", () => ({
  fetchLayout: vi.fn(),
  saveLayout: vi.fn().mockResolvedValue({ success: true }),
  deleteAutomation: vi.fn().mockResolvedValue({ success: true }),
}));

import { useDashboardStore, tabNameToSlug } from "./dashboard-store";
import { deleteAutomation } from "../lib/api-client";
import type { Tab, Pane } from "../types/dashboard";

const d = () => useDashboardStore.getState();

function pinnedTab(id: string): Tab {
  return { id, name: id, icon: "x", order: 0, pinned: true, createdAt: 0 };
}

describe("tabNameToSlug", () => {
  it("lowercases, trims, and hyphenates", () => {
    expect(tabNameToSlug("  My Cool Tab ")).toBe("my-cool-tab");
  });
  it("strips characters that aren't url-safe", () => {
    expect(tabNameToSlug("Garden & Pond!")).toBe("garden--pond");
  });
});

describe("dashboard-store", () => {
  beforeEach(() => {
    vi.useFakeTimers(); // debouncedPersist schedules a 2s timer on every mutation
    vi.mocked(deleteAutomation).mockClear();
    useDashboardStore.setState({ tabs: [], panes: [], activeTabId: null, initialized: false });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe("addTab", () => {
    it("adds a tab and makes it active", () => {
      d().addTab("Garden", "leaf");
      expect(d().tabs).toHaveLength(1);
      expect(d().tabs[0].name).toBe("Garden");
      expect(d().activeTabId).toBe(d().tabs[0].id);
    });

    it("rejects blank names", () => {
      d().addTab("   ", "leaf");
      expect(d().tabs).toHaveLength(0);
    });

    it("rejects reserved slugs", () => {
      d().addTab("Dashboard", "home");
      d().addTab("Data Store", "db");
      expect(d().tabs).toHaveLength(0);
    });

    it("rejects duplicate slugs", () => {
      d().addTab("Garden", "leaf");
      d().addTab("garden", "leaf");
      expect(d().tabs).toHaveLength(1);
    });
  });

  describe("renameTab", () => {
    it("renames an existing tab", () => {
      d().addTab("Garden", "leaf");
      const id = d().tabs[0].id;
      d().renameTab(id, "Greenhouse");
      expect(d().tabs[0].name).toBe("Greenhouse");
    });

    it("rejects a rename that collides with another tab's slug", () => {
      d().addTab("Garden", "leaf");
      d().addTab("Shed", "home");
      const shedId = d().tabs[1].id;
      d().renameTab(shedId, "Garden");
      expect(d().tabs[1].name).toBe("Shed");
    });
  });

  describe("deleteTab", () => {
    it("removes a tab and its panes", () => {
      d().addTab("Garden", "leaf");
      const id = d().tabs[0].id;
      d().addPane(id, "device-grid");
      d().deleteTab(id);
      expect(d().tabs).toHaveLength(0);
      expect(d().panes).toHaveLength(0);
    });

    it("does not delete pinned tabs", () => {
      useDashboardStore.setState({ tabs: [pinnedTab("home")], activeTabId: "home" });
      d().deleteTab("home");
      expect(d().tabs).toHaveLength(1);
    });
  });

  describe("reorderTabs", () => {
    it("reorders unpinned tabs while keeping pinned tabs first", () => {
      useDashboardStore.setState({ tabs: [pinnedTab("home")] });
      d().addTab("A", "x");
      d().addTab("B", "x");
      const [aId, bId] = d().tabs.filter((t) => !t.pinned).map((t) => t.id);

      d().reorderTabs([bId, aId]);

      const order = d().tabs.map((t) => t.id);
      expect(order[0]).toBe("home"); // pinned stays first
      expect(order.slice(1)).toEqual([bId, aId]);
    });
  });

  describe("panes", () => {
    it("addPane applies the registry default size and merges config", () => {
      d().addPane("tab-1", "hue-control", { title: "Lights" } as Pane["config"]);
      const pane = d().panes[0];
      expect(pane.paneType).toBe("hue-control");
      expect(pane.w).toBe(12); // hue-control default width
      expect(pane.h).toBe(6);
      expect(pane.config).toMatchObject({ title: "Lights" });
    });

    it("addPane falls back to a default size for unknown pane types", () => {
      d().addPane("tab-1", "mystery-pane");
      expect(d().panes[0].w).toBe(6);
      expect(d().panes[0].h).toBe(4);
    });

    it("updatePanePosition / Size / Config mutate only the target pane", () => {
      d().addPane("tab-1", "device-grid");
      d().addPane("tab-1", "sensor-panel");
      const [p1, p2] = d().panes.map((p) => p.id);

      d().updatePanePosition(p1, 3, 4);
      d().updatePaneSize(p1, 8, 9);
      d().updatePaneConfig(p2, { title: "Sensors" } as Pane["config"]);

      const pane1 = d().panes.find((p) => p.id === p1)!;
      const pane2 = d().panes.find((p) => p.id === p2)!;
      expect({ x: pane1.x, y: pane1.y, w: pane1.w, h: pane1.h }).toEqual({ x: 3, y: 4, w: 8, h: 9 });
      expect(pane2.config).toEqual({ title: "Sensors" });
    });

    it("places a new automation first and shifts existing panes on that tab", () => {
      d().addPane("tab-1", "device-grid");
      const existingId = d().panes[0].id;
      const existingY = d().panes[0].y;
      d().addPane("tab-1", "automation", { ruleId: "rule-new" } as Pane["config"]);

      expect(d().panes[0].paneType).toBe("automation");
      expect(d().panes.find((pane) => pane.id === existingId)?.y).toBeGreaterThan(existingY);
    });

    it("removePane drops the pane without deleting the linked automation", () => {
      d().addPane("tab-1", "automation", { ruleId: "rule-42" } as Pane["config"]);
      const id = d().panes[0].id;
      d().removePane(id);
      expect(d().panes).toHaveLength(0);
      // Automation deletion is now an explicit, confirmed operation — not a
      // side-effect of pane removal (pre-promotion-release-gates Req 6.1).
      expect(vi.mocked(deleteAutomation)).not.toHaveBeenCalled();
    });

    it("removePane does not call deleteAutomation for non-automation panes", () => {
      d().addPane("tab-1", "device-grid");
      d().removePane(d().panes[0].id);
      expect(vi.mocked(deleteAutomation)).not.toHaveBeenCalled();
    });
  });
});
