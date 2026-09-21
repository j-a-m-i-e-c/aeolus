// frontend/src/store/dashboard-store.layout.test.ts
//
// dashboard-store.test.ts covers the tab and pane mutations. This file covers the
// two places the store meets the server — `initialize()` and `resetLayout()` — plus
// the reordering and fallback rules those depend on.
//
// The interesting behaviour here is all about not losing a user's workspace: pinned
// system tabs are never taken from the server, panes of a type this build no longer
// registers are dropped rather than rendered broken, a failed fetch falls back to
// defaults instead of an empty dashboard, and a reset keeps the tab the user is
// looking at if it still exists.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../lib/api-client", () => ({
  fetchLayout: vi.fn(),
  saveLayout: vi.fn().mockResolvedValue({ success: true }),
  deleteAutomation: vi.fn().mockResolvedValue({ success: true }),
}));

import { useDashboardStore } from "./dashboard-store";
import { fetchLayout } from "../lib/api-client";
import { DEFAULT_TABS } from "../types/dashboard";
import type { Tab, Pane } from "../types/dashboard";

const d = () => useDashboardStore.getState();

function tab(id: string, overrides: Partial<Tab> = {}): Tab {
  return { id, name: id, icon: "leaf", order: 0, pinned: false, createdAt: 0, ...overrides };
}

function pane(id: string, tabId: string, overrides: Partial<Pane> = {}): Pane {
  return {
    id,
    tabId,
    paneType: "metrics",
    config: {},
    x: 0,
    y: 0,
    w: 6,
    h: 4,
    createdAt: 0,
    ...overrides,
  };
}

const PINNED_COUNT = DEFAULT_TABS.filter((t) => t.pinned).length;

describe("dashboard-store — server layout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(fetchLayout).mockReset();
    useDashboardStore.setState({ tabs: [], panes: [], activeTabId: null, initialized: false });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  // The happy merge and the fetch-failure fallback are covered in
  // dashboard-store.branches.test.ts. These are the shapes a stored layout can take
  // that those two do not exercise.
  describe("initialize", () => {
    it("ignores a pinned tab the stored layout tries to define", async () => {
      vi.mocked(fetchLayout).mockResolvedValue({
        // System navigation is this build's to define, not something a stored
        // layout can redefine, duplicate or remove.
        tabs: [tab("garden"), tab("stale-pinned", { pinned: true })],
        panes: [],
      } as never);

      await d().initialize();

      expect(d().tabs.filter((t) => t.pinned)).toHaveLength(PINNED_COUNT);
      expect(d().tabs.map((t) => t.id)).toContain("garden");
      expect(d().tabs.map((t) => t.id)).not.toContain("stale-pinned");
    });

    it("drops panes whose type this build no longer registers", async () => {
      vi.mocked(fetchLayout).mockResolvedValue({
        tabs: [tab("garden")],
        panes: [pane("keep", "garden"), pane("drop", "garden", { paneType: "device-grid" })],
      } as never);

      await d().initialize();

      // A removed pane type would otherwise render as a broken or empty tile.
      expect(d().panes.map((p) => p.id)).toEqual(["keep"]);
    });

    it("treats a layout with no panes field as an empty workspace", async () => {
      vi.mocked(fetchLayout).mockResolvedValue({ tabs: [tab("garden")] } as never);
      await d().initialize();
      expect(d().panes).toEqual([]);
      expect(d().tabs.map((t) => t.id)).toContain("garden");
    });

    it("treats a layout with no tabs field as having no custom tabs", async () => {
      vi.mocked(fetchLayout).mockResolvedValue({ panes: [] } as never);
      await d().initialize();
      expect(d().tabs).toHaveLength(PINNED_COUNT);
    });

  });

  describe("resetLayout", () => {
    it("keeps the tab the user is looking at when the reset still contains it", async () => {
      useDashboardStore.setState({ activeTabId: "garden" });
      vi.mocked(fetchLayout).mockResolvedValue({ tabs: [tab("garden"), tab("pond")], panes: [] } as never);

      await d().resetLayout();

      expect(d().activeTabId).toBe("garden");
    });

    it("moves to the first tab when the one in view no longer exists", async () => {
      useDashboardStore.setState({ activeTabId: "deleted-elsewhere" });
      vi.mocked(fetchLayout).mockResolvedValue({ tabs: [tab("pond")], panes: [] } as never);

      await d().resetLayout();

      expect(d().activeTabId).toBe(d().tabs[0]!.id);
      expect(d().activeTabId).not.toBe("deleted-elsewhere");
    });

    it("selects the first tab when nothing was in view", async () => {
      useDashboardStore.setState({ activeTabId: null });
      vi.mocked(fetchLayout).mockResolvedValue({ tabs: [tab("pond")], panes: [] } as never);

      await d().resetLayout();

      expect(d().activeTabId).toBe(d().tabs[0]!.id);
    });

    it("leaves the current workspace alone when the reset cannot be fetched", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      useDashboardStore.setState({ tabs: [tab("garden")], panes: [pane("p1", "garden")], activeTabId: "garden" });
      vi.mocked(fetchLayout).mockRejectedValue(new Error("offline"));

      await d().resetLayout();

      // A failed reset is not a reason to discard what the user currently has.
      expect(d().tabs.map((t) => t.id)).toEqual(["garden"]);
      expect(d().panes.map((p) => p.id)).toEqual(["p1"]);
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it("drops unregistered pane types on reset too", async () => {
      vi.mocked(fetchLayout).mockResolvedValue({
        tabs: [tab("garden")],
        panes: [pane("keep", "garden"), pane("drop", "garden", { paneType: "device-grid" })],
      } as never);

      await d().resetLayout();

      expect(d().panes.map((p) => p.id)).toEqual(["keep"]);
    });
  });

  // Reordering with pinned tabs present is covered in dashboard-store.branches.test.ts.
  // These are the two cases where the caller's list and the store's disagree.
  describe("reorderTabs", () => {
    it("keeps a tab the caller forgot to mention rather than dropping it", () => {
      useDashboardStore.setState({ tabs: [tab("a"), tab("b"), tab("c")] });

      d().reorderTabs(["c"]);

      expect(d().tabs.map((t) => t.id)).toEqual(["c", "a", "b"]);
    });

    it("ignores an id that names no tab", () => {
      useDashboardStore.setState({ tabs: [tab("a"), tab("b")] });

      d().reorderTabs(["ghost", "b", "a"]);

      expect(d().tabs.map((t) => t.id)).toEqual(["b", "a"]);
    });
  });

  describe("deleteTab", () => {
    // The pinned-tab refusal and the non-active-tab case are covered in
    // dashboard-store.branches.test.ts. This is the case those miss: the deleted
    // tab is itself the first in the list, which is reachable whenever no pinned
    // tab sorts ahead of it.
    it("moves to a tab that still exists when the first tab is the one deleted", () => {
      useDashboardStore.setState({
        tabs: [tab("a"), tab("b")],
        panes: [pane("p-a", "a"), pane("p-b", "b")],
        activeTabId: "a",
      });

      d().deleteTab("a");

      expect(d().tabs.map((t) => t.id)).toEqual(["b"]);
      expect(d().panes.map((p) => p.id)).toEqual(["p-b"]);
      expect(d().activeTabId).toBe("b");
    });

    it("clears the view when the last remaining tab is deleted", () => {
      useDashboardStore.setState({ tabs: [tab("only")], panes: [], activeTabId: "only" });

      d().deleteTab("only");

      expect(d().tabs).toEqual([]);
      expect(d().activeTabId).toBeNull();
    });
  });

  describe("addPane", () => {
    it("puts a new automation editor above the panes already on that tab", () => {
      useDashboardStore.setState({
        tabs: [tab("garden")],
        panes: [pane("existing", "garden", { y: 0 })],
      });

      d().addPane("garden", "automation");

      // The fresh editor is the point of the click; grid collision resolution would
      // otherwise bury it under whatever was already there.
      expect(d().panes[0]!.paneType).toBe("automation");
      expect(d().panes.find((p) => p.id === "existing")!.y).toBeGreaterThan(0);
    });

    it("does not move panes belonging to another tab", () => {
      useDashboardStore.setState({
        tabs: [tab("garden"), tab("pond")],
        panes: [pane("other-tab", "pond", { y: 0 })],
      });

      d().addPane("garden", "automation");

      expect(d().panes.find((p) => p.id === "other-tab")!.y).toBe(0);
    });

    it("appends any other pane type without disturbing the layout", () => {
      useDashboardStore.setState({ tabs: [tab("garden")], panes: [pane("existing", "garden", { y: 2 })] });

      d().addPane("garden", "metrics");

      expect(d().panes[0]!.id).toBe("existing");
      expect(d().panes[0]!.y).toBe(2);
      expect(d().panes).toHaveLength(2);
    });

    it("falls back to a usable size for a pane type with no registry entry", () => {
      useDashboardStore.setState({ tabs: [tab("garden")], panes: [] });

      d().addPane("garden", "not-a-registered-type");

      expect(d().panes[0]).toMatchObject({ w: 6, h: 4 });
    });
  });

  describe("id generation", () => {
    it("still produces a unique id where crypto.randomUUID is unavailable", () => {
      // Browsers only expose randomUUID in a secure context, and Aeolus is
      // routinely reached over plain HTTP on a LAN.
      const original = globalThis.crypto;
      Object.defineProperty(globalThis, "crypto", { value: {}, configurable: true });
      try {
        useDashboardStore.setState({ tabs: [], panes: [], activeTabId: null });
        d().addTab("Garden", "leaf");
        d().addTab("Pond", "droplet");

        const [first, second] = d().tabs.map((t) => t.id);
        expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        expect(first).not.toBe(second);
      } finally {
        Object.defineProperty(globalThis, "crypto", { value: original, configurable: true });
      }
    });
  });
});
