// frontend/src/store/dashboard-store.branches.test.ts — Tests targeting uncovered branches

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../lib/api-client", () => ({
  fetchLayout: vi.fn(),
  saveLayout: vi.fn().mockResolvedValue({ success: true }),
  deleteAutomation: vi.fn().mockResolvedValue({ success: true }),
}));

import { useDashboardStore } from "./dashboard-store";
import { fetchLayout, deleteAutomation } from "../lib/api-client";
import type { Tab, Pane } from "../types/dashboard";

const d = () => useDashboardStore.getState();

function pinnedTab(id: string, name?: string): Tab {
  return { id, name: name || id, icon: "x", order: 0, pinned: true, createdAt: 0 };
}
function customTab(id: string, name: string): Tab {
  return { id, name, icon: "star", order: 1, pinned: false, createdAt: 0 };
}

describe("dashboard-store — branch coverage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useDashboardStore.setState({
      tabs: [pinnedTab("system", "System"), customTab("tab-1", "Custom")],
      panes: [],
      activeTabId: "system",
      initialized: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("addTab edge cases", () => {
    it("rejects empty name after trimming", () => {
      const before = d().tabs.length;
      d().addTab("   ", "star");
      expect(d().tabs.length).toBe(before);
    });

    it("rejects reserved slug 'dashboard'", () => {
      const before = d().tabs.length;
      d().addTab("dashboard", "star");
      expect(d().tabs.length).toBe(before);
    });

    it("rejects reserved slug 'security'", () => {
      const before = d().tabs.length;
      d().addTab("Security", "shield");
      expect(d().tabs.length).toBe(before);
    });

    it("rejects duplicate slug", () => {
      const before = d().tabs.length;
      d().addTab("Custom", "star"); // Same as existing tab-1
      expect(d().tabs.length).toBe(before);
    });

    it("successfully adds a valid tab", () => {
      const before = d().tabs.length;
      d().addTab("New Tab", "zap");
      expect(d().tabs.length).toBe(before + 1);
      expect(d().activeTabId).toBe(d().tabs[d().tabs.length - 1].id);
    });
  });

  describe("renameTab edge cases", () => {
    it("rejects empty name", () => {
      d().renameTab("tab-1", "   ");
      expect(d().tabs.find((t) => t.id === "tab-1")?.name).toBe("Custom");
    });

    it("rejects reserved slug", () => {
      d().renameTab("tab-1", "connectors");
      expect(d().tabs.find((t) => t.id === "tab-1")?.name).toBe("Custom");
    });

    it("rejects duplicate slug (other tab has same slug)", () => {
      useDashboardStore.setState({
        tabs: [pinnedTab("system", "System"), customTab("tab-1", "Custom"), customTab("tab-2", "Another")],
      });
      d().renameTab("tab-1", "Another"); // Conflicts with tab-2
      expect(d().tabs.find((t) => t.id === "tab-1")?.name).toBe("Custom");
    });

    it("allows rename to a new unique name", () => {
      d().renameTab("tab-1", "Renamed Tab");
      expect(d().tabs.find((t) => t.id === "tab-1")?.name).toBe("Renamed Tab");
    });
  });

  describe("deleteTab edge cases", () => {
    it("does not delete pinned tabs", () => {
      const before = d().tabs.length;
      d().deleteTab("system");
      expect(d().tabs.length).toBe(before);
    });

    it("switches activeTabId when the active tab is deleted", () => {
      useDashboardStore.setState({ activeTabId: "tab-1" });
      d().deleteTab("tab-1");
      expect(d().activeTabId).not.toBe("tab-1");
    });

    it("keeps activeTabId when a non-active tab is deleted", () => {
      useDashboardStore.setState({
        tabs: [pinnedTab("system", "System"), customTab("tab-1", "A"), customTab("tab-2", "B")],
        activeTabId: "system",
      });
      d().deleteTab("tab-1");
      expect(d().activeTabId).toBe("system");
    });
  });

  describe("removePane", () => {
    it("removes the pane without deleting the linked automation", () => {
      const pane: Pane = {
        id: "p1", tabId: "tab-1", paneType: "automation",
        config: { ruleId: "rule-123" }, x: 0, y: 0, w: 6, h: 4, createdAt: 0,
      };
      useDashboardStore.setState({ panes: [pane] });

      d().removePane("p1");

      // Automation deletion is now explicit+confirmed, not a pane-removal side-effect
      expect(deleteAutomation).not.toHaveBeenCalled();
      expect(d().panes).toHaveLength(0);
    });

    it("does not call deleteAutomation for non-automation panes", () => {
      const pane: Pane = {
        id: "p2", tabId: "tab-1", paneType: "device-grid",
        config: {}, x: 0, y: 0, w: 6, h: 4, createdAt: 0,
      };
      useDashboardStore.setState({ panes: [pane] });
      vi.mocked(deleteAutomation).mockClear();

      d().removePane("p2");

      expect(deleteAutomation).not.toHaveBeenCalled();
    });
  });

  describe("reorderTabs", () => {
    it("reorders unpinned tabs while keeping pinned tabs first", () => {
      useDashboardStore.setState({
        tabs: [
          pinnedTab("p1", "Pinned"),
          customTab("a", "A"),
          customTab("b", "B"),
          customTab("c", "C"),
        ],
      });

      d().reorderTabs(["c", "a", "b"]);

      const unpinnedNames = d().tabs.filter((t) => !t.pinned).map((t) => t.name);
      expect(unpinnedNames).toEqual(["C", "A", "B"]);
      expect(d().tabs[0].pinned).toBe(true);
    });
  });

  describe("initialize", () => {
    it("uses defaults when fetchLayout fails", async () => {
      vi.mocked(fetchLayout).mockRejectedValue(new Error("offline"));
      await d().initialize();
      expect(d().initialized).toBe(true);
      expect(d().tabs.length).toBeGreaterThan(0);
    });

    it("merges server layout with pinned tabs", async () => {
      vi.mocked(fetchLayout).mockResolvedValue({
        tabs: [customTab("custom-1", "My Tab")],
        panes: [{ id: "p1", tabId: "custom-1", paneType: "device-grid", config: {}, x: 0, y: 0, w: 6, h: 4, createdAt: 0 }],
      });
      await d().initialize();
      expect(d().tabs.some((t) => t.pinned)).toBe(true);
      expect(d().tabs.some((t) => t.name === "My Tab")).toBe(true);
    });
  });
});
