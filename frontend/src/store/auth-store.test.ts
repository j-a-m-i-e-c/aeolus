// frontend/src/store/auth-store.test.ts — Unit tests for the auth Zustand store

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useAuthStore } from "./auth-store";

/** Build a JWT-shaped token whose payload decodes to the given claims. */
function makeJwt(claims: Record<string, unknown>): string {
  const b64url = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_");
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(claims)}.sig`;
}

const adminToken = makeJwt({ userId: "u1", username: "admin", role: "admin", groupId: null });
const demoToken = makeJwt({ userId: "demo-1", username: "demo", role: "user", groupId: "demo-group" });

function okJson(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe("auth-store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useAuthStore.setState({
      accessToken: null,
      user: null,
      isAuthenticated: false,
      needsSetup: false,
      loading: true,
    });
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const s = () => useAuthStore.getState();

  describe("login", () => {
    it("stores the token and decoded user on success", async () => {
      vi.mocked(fetch).mockResolvedValue(okJson({ accessToken: adminToken }));

      await s().login("admin", "pw");

      const state = s();
      expect(state.accessToken).toBe(adminToken);
      expect(state.isAuthenticated).toBe(true);
      expect(state.user).toEqual({ id: "u1", username: "admin", role: "admin", groupId: null });
    });

    it("throws with the server error message on failure", async () => {
      vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: "Invalid credentials" }), { status: 401 }));

      await expect(s().login("admin", "wrong")).rejects.toThrow("Invalid credentials");
      expect(s().isAuthenticated).toBe(false);
    });
  });

  describe("logout", () => {
    it("clears auth state even though the network call is best-effort", async () => {
      useAuthStore.setState({ accessToken: adminToken, isAuthenticated: true });
      vi.mocked(fetch).mockResolvedValue(okJson({}));

      await s().logout();

      expect(s().accessToken).toBeNull();
      expect(s().isAuthenticated).toBe(false);
      expect(s().user).toBeNull();
    });
  });

  describe("refresh", () => {
    it("returns true and updates state on success", async () => {
      vi.mocked(fetch).mockResolvedValue(okJson({ accessToken: adminToken }));

      const result = await s().refresh();

      expect(result).toBe(true);
      expect(s().isAuthenticated).toBe(true);
      expect(s().accessToken).toBe(adminToken);
    });

    it("returns false and clears state when the refresh is rejected", async () => {
      useAuthStore.setState({ accessToken: "stale", isAuthenticated: true });
      vi.mocked(fetch).mockResolvedValue(new Response("", { status: 401 }));

      const result = await s().refresh();

      expect(result).toBe(false);
      expect(s().isAuthenticated).toBe(false);
      expect(s().accessToken).toBeNull();
    });

    it("returns false on a network error", async () => {
      vi.mocked(fetch).mockRejectedValue(new Error("offline"));

      expect(await s().refresh()).toBe(false);
      expect(s().isAuthenticated).toBe(false);
    });
  });

  describe("demo session renewal", () => {
    it("keeps an existing demo session when a renewal attempt transiently fails", async () => {
      useAuthStore.setState({
        accessToken: demoToken,
        user: { id: "demo-1", username: "demo", role: "user", groupId: "demo-group" },
        isAuthenticated: true,
        loading: false,
      });
      vi.mocked(fetch).mockResolvedValue(new Response("", { status: 503 }));

      const result = await s().initDemoSession();

      expect(result).toBe(true);
      expect(s().isAuthenticated).toBe(true);
      expect(s().accessToken).toBe(demoToken);
      expect(s().user?.username).toBe("demo");
    });

    it("still fails closed when the first demo session cannot be created", async () => {
      vi.mocked(fetch).mockResolvedValue(new Response("", { status: 503 }));

      const result = await s().initDemoSession();

      expect(result).toBe(false);
      expect(s().isAuthenticated).toBe(false);
    });
  });

  describe("checkSetupNeeded", () => {
    it("authenticates directly when the refresh cookie is valid", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(okJson({ accessToken: adminToken }));

      await s().checkSetupNeeded();

      expect(s().isAuthenticated).toBe(true);
      expect(s().loading).toBe(false);
    });

    it("flags setup when refresh fails and the server reports needsSetup", async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(new Response("", { status: 401 })) // refresh
        .mockResolvedValueOnce(okJson({ needsSetup: true })); // status

      await s().checkSetupNeeded();

      expect(s().needsSetup).toBe(true);
      expect(s().isAuthenticated).toBe(false);
      expect(s().loading).toBe(false);
    });

    it("shows login when the server is set up but the user is unauthenticated", async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(new Response("", { status: 401 })) // refresh
        .mockResolvedValueOnce(okJson({ needsSetup: false })); // status

      await s().checkSetupNeeded();

      expect(s().needsSetup).toBe(false);
      expect(s().isAuthenticated).toBe(false);
      expect(s().loading).toBe(false);
    });
  });
});
