// frontend/src/store/dashboard-store.concurrency.test.ts — shared-layout concurrency (ADR-0026)
//
// The dashboard layout is one document several operators can edit at once. These
// cover the parts that decide whose work survives: persisting against a server-owned
// revision, refusing to retry after a 409, and what happens when a remote commit
// lands while this browser still has layout work queued.
//
// The distinction that matters throughout: a passive viewer converges silently,
// while a browser with pending work is flagged for an explicit reload instead of
// having either operator's changes discarded.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("../lib/api-client")>("../lib/api-client");
  return {
    ApiRequestError: actual.ApiRequestError,
    fetchLayout: vi.fn(),
    saveLayout: vi.fn(),
    deleteAutomation: vi.fn().mockResolvedValue({ success: true }),
  };
});

import { useDashboardStore } from "./dashboard-store";
import { fetchLayout, saveLayout, ApiRequestError } from "../lib/api-client";
import type { Tab, Pane } from "../types/dashboard";

const d = () => useDashboardStore.getState();

function tab(id: string, overrides: Partial<Tab> = {}): Tab {
  return { id, name: id, icon: "leaf", order: 0, pinned: false, createdAt: 0, ...overrides };
}

function pane(id: string, tabId: string): Pane {
  return { id, tabId, paneType: "metrics", config: {}, x: 0, y: 0, w: 6, h: 4, createdAt: 0 };
}

/** Let the store's persist IIFE settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("dashboard-store — shared layout concurrency", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.mocked(saveLayout).mockReset().mockResolvedValue({ success: true, revision: 5 });
    vi.mocked(fetchLayout).mockReset().mockResolvedValue({ revision: 9, tabs: [tab("remote")], panes: [] });
    useDashboardStore.setState({
      tabs: [tab("local")],
      panes: [pane("p1", "local")],
      activeTabId: "local",
      layoutRevision: 4,
      layoutConflict: false,
      initialized: true,
    });
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  describe("persistLayout", () => {
    it("writes against the revision it currently holds and adopts the one it gets back", async () => {
      d().persistLayout();
      await flush();

      expect(saveLayout).toHaveBeenCalledWith(expect.objectContaining({ panes: [pane("p1", "local")] }), 4);
      expect(d().layoutRevision).toBe(5);
      expect(d().layoutConflict).toBe(false);
    });

    it("does not persist at all without a revision", async () => {
      // No revision means the last read failed, so this browser has no base to
      // write against. Sending anything here could replace a layout it never saw.
      useDashboardStore.setState({ layoutRevision: null });

      d().persistLayout();
      await flush();

      expect(saveLayout).not.toHaveBeenCalled();
    });

    it("excludes pinned system tabs from what it sends", async () => {
      useDashboardStore.setState({ tabs: [tab("system", { pinned: true }), tab("mine")] });

      d().persistLayout();
      await flush();

      const [payload] = vi.mocked(saveLayout).mock.calls[0]!;
      expect(payload.tabs.map((t) => t.id)).toEqual(["mine"]);
    });

    it("flags a conflict and stops retrying when the server rejects the revision", async () => {
      vi.mocked(saveLayout).mockRejectedValue(new ApiRequestError(409, "stale"));

      d().persistLayout();
      await flush();

      expect(d().layoutConflict).toBe(true);
      // Retrying would just overwrite the other operator with the same stale base.
      expect(saveLayout).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalled();
    });

    it("keeps the revision and raises no conflict when the save fails for other reasons", async () => {
      vi.mocked(saveLayout).mockRejectedValue(new ApiRequestError(503, "offline"));

      d().persistLayout();
      await flush();

      // An unreachable server is not a competing edit.
      expect(d().layoutConflict).toBe(false);
      expect(d().layoutRevision).toBe(4);
      expect(warn).toHaveBeenCalled();
    });

    it("coalesces a request made while a save is already in flight", async () => {
      let release: (v: { success: boolean; revision: number }) => void = () => {};
      vi.mocked(saveLayout)
        .mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }))
        .mockResolvedValue({ success: true, revision: 7 });

      d().persistLayout();
      d().persistLayout(); // queued behind the first rather than racing it
      release({ success: true, revision: 6 });
      await flush();
      await flush();

      expect(saveLayout).toHaveBeenCalledTimes(2);
      expect(d().layoutRevision).toBe(7);
    });

    it("reports a conflict when a remote commit lands mid-save", async () => {
      let release: (v: { success: boolean; revision: number }) => void = () => {};
      vi.mocked(saveLayout).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));

      d().persistLayout();
      // The write was accepted, but it was computed from a base that is no longer
      // current, so the result cannot be trusted as the whole truth.
      d().handleRemoteLayoutRevision(8);
      release({ success: true, revision: 6 });
      await flush();

      expect(d().layoutConflict).toBe(true);
    });
  });

  describe("handleRemoteLayoutRevision", () => {
    it("ignores a revision it has already seen", async () => {
      d().handleRemoteLayoutRevision(4);
      await flush();

      expect(fetchLayout).not.toHaveBeenCalled();
      expect(d().layoutConflict).toBe(false);
    });

    it("converges a passive viewer onto the remote layout", async () => {
      d().handleRemoteLayoutRevision(9);
      await flush();

      expect(fetchLayout).toHaveBeenCalled();
      expect(d().tabs.some((t) => t.id === "remote")).toBe(true);
      expect(d().layoutRevision).toBe(9);
      expect(d().layoutConflict).toBe(false);
    });

    it("preserves pending local work and asks for an explicit reload instead", async () => {
      // Queue local work, then let a remote commit arrive.
      d().addTab("Mine", "leaf");
      d().handleRemoteLayoutRevision(9);
      await flush();

      expect(d().layoutConflict).toBe(true);
      // Neither side is discarded: no refetch overwrote the local edit, and no
      // save pushed the stale base over the remote commit.
      expect(fetchLayout).not.toHaveBeenCalled();
      expect(saveLayout).not.toHaveBeenCalled();
      expect(d().tabs.some((t) => t.name === "Mine")).toBe(true);
    });
  });

  describe("reconcileLayout", () => {
    it("adopts a newer server revision found on reconnect", async () => {
      d().reconcileLayout();
      await flush();
      await flush();

      expect(d().layoutRevision).toBe(9);
    });

    it("does nothing when the server is no further ahead", async () => {
      vi.mocked(fetchLayout).mockResolvedValue({ revision: 4, tabs: [tab("remote")], panes: [] });

      d().reconcileLayout();
      await flush();

      expect(d().tabs.map((t) => t.id)).toEqual(["local"]);
    });

    it("does nothing when the server cannot supply a revision", async () => {
      vi.mocked(fetchLayout).mockResolvedValue({ revision: null, tabs: [], panes: [] });

      d().reconcileLayout();
      await flush();

      expect(d().tabs.map((t) => t.id)).toEqual(["local"]);
      expect(d().layoutRevision).toBe(4);
    });

    it("swallows a failed reconnect fetch", async () => {
      vi.mocked(fetchLayout).mockRejectedValue(new Error("offline"));

      expect(() => d().reconcileLayout()).not.toThrow();
      await flush();

      expect(d().layoutRevision).toBe(4);
    });
  });
});
