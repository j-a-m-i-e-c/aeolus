// frontend/src/store/permissions-store.test.ts — Unit tests for the permissions store

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./auth-store", () => ({ useAuthStore: { getState: vi.fn() } }));
vi.mock("../lib/env", () => ({ API_URL: "http://test.local:3001" }));

import { usePermissionsStore } from "./permissions-store";
import { useAuthStore } from "./auth-store";

const mockGetState = vi.mocked(useAuthStore.getState);
const p = () => usePermissionsStore.getState();

function asAdmin() {
  mockGetState.mockReturnValue({ accessToken: "t", user: { role: "admin" } } as never);
}
function asUser(accessToken: string | null = "t") {
  mockGetState.mockReturnValue({ accessToken, user: { role: "user" } } as never);
}

describe("permissions-store", () => {
  beforeEach(() => {
    mockGetState.mockReset();
    usePermissionsStore.setState({ accessibleTabs: [], loaded: false });
    vi.stubGlobal("fetch", vi.fn());
  });

  describe("admin shortcut", () => {
    beforeEach(asAdmin);

    it("fetchPermissions does not hit the network and marks loaded", async () => {
      await p().fetchPermissions();
      expect(fetch).not.toHaveBeenCalled();
      expect(p().loaded).toBe(true);
    });

    it("grants access, write level, and any action on any tab", () => {
      expect(p().hasTabAccess("anything")).toBe(true);
      expect(p().getTabPermission("anything")).toBe("write");
      expect(p().canPerform("anything", "write")).toBe(true);
    });
  });

  describe("non-admin", () => {
    it("fetchPermissions with no token resolves to no tabs", async () => {
      asUser(null);
      await p().fetchPermissions();
      expect(fetch).not.toHaveBeenCalled();
      expect(p().accessibleTabs).toEqual([]);
      expect(p().loaded).toBe(true);
    });

    it("fetchPermissions loads accessibleTabs from /api/auth/me", async () => {
      asUser("tok");
      vi.mocked(fetch).mockResolvedValue(
        new Response(JSON.stringify({ accessibleTabs: [{ tabId: "t1", permission: "interact" }] }), { status: 200 }),
      );

      await p().fetchPermissions();

      const [url, init] = vi.mocked(fetch).mock.calls[0];
      expect(url).toBe("http://test.local:3001/api/auth/me");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer tok");
      expect(p().accessibleTabs).toEqual([{ tabId: "t1", permission: "interact" }]);
    });

    it("falls back to no tabs on a non-ok response", async () => {
      asUser("tok");
      vi.mocked(fetch).mockResolvedValue(new Response("", { status: 403 }));
      await p().fetchPermissions();
      expect(p().accessibleTabs).toEqual([]);
      expect(p().loaded).toBe(true);
    });

    describe("permission checks against loaded tabs", () => {
      beforeEach(() => {
        asUser("tok");
        usePermissionsStore.setState({
          accessibleTabs: [
            { tabId: "read-tab", permission: "read" },
            { tabId: "interact-tab", permission: "interact" },
          ],
          loaded: true,
        });
      });

      it("hasTabAccess reflects membership", () => {
        expect(p().hasTabAccess("read-tab")).toBe(true);
        expect(p().hasTabAccess("missing")).toBe(false);
      });

      it("getTabPermission returns the level or null", () => {
        expect(p().getTabPermission("interact-tab")).toBe("interact");
        expect(p().getTabPermission("missing")).toBeNull();
      });

      it("canPerform respects the read < interact < write hierarchy", () => {
        expect(p().canPerform("interact-tab", "read")).toBe(true);
        expect(p().canPerform("interact-tab", "interact")).toBe(true);
        expect(p().canPerform("interact-tab", "write")).toBe(false);
        expect(p().canPerform("read-tab", "interact")).toBe(false);
        expect(p().canPerform("missing", "read")).toBe(false);
      });
    });
  });

  it("clear resets state", () => {
    usePermissionsStore.setState({ accessibleTabs: [{ tabId: "x", permission: "read" }], loaded: true });
    p().clear();
    expect(p().accessibleTabs).toEqual([]);
    expect(p().loaded).toBe(false);
  });
});
