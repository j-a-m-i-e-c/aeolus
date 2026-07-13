// frontend/src/store/auth-store.branches.test.ts — Tests targeting uncovered branches

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useAuthStore } from "./auth-store";

function makeJwt(claims: Record<string, unknown>): string {
  const b64url = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_");
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(claims)}.sig`;
}

const adminToken = makeJwt({ userId: "u1", username: "admin", role: "admin", groupId: null });
const userToken = makeJwt({ userId: "u2", username: "user1", role: "user", groupId: "g1" });

function okJson(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe("auth-store — branch coverage", () => {
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
    it("throws generic error when res.json() fails on error response", async () => {
      vi.mocked(fetch).mockResolvedValue(new Response("not json", { status: 401 }));
      await expect(s().login("admin", "pw")).rejects.toThrow("Login failed");
    });

    it("uses server error string when error field is present", async () => {
      vi.mocked(fetch).mockResolvedValue(
        new Response(JSON.stringify({ error: "Account locked" }), { status: 403 }),
      );
      await expect(s().login("admin", "pw")).rejects.toThrow("Account locked");
    });

    it("decodes user with groupId", async () => {
      vi.mocked(fetch).mockResolvedValue(okJson({ accessToken: userToken }));
      await s().login("user1", "pw");
      expect(s().user?.groupId).toBe("g1");
      expect(s().user?.role).toBe("user");
    });
  });

  describe("logout", () => {
    it("clears state even when network error occurs", async () => {
      useAuthStore.setState({ accessToken: adminToken, isAuthenticated: true });
      vi.mocked(fetch).mockRejectedValue(new Error("network error"));

      await s().logout();

      expect(s().accessToken).toBeNull();
      expect(s().isAuthenticated).toBe(false);
    });

    it("includes Authorization header when token is present", async () => {
      useAuthStore.setState({ accessToken: "my-token", isAuthenticated: true });
      vi.mocked(fetch).mockResolvedValue(okJson({}));

      await s().logout();

      const [, init] = vi.mocked(fetch).mock.calls[0];
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer my-token");
    });

    it("omits Authorization header when token is null", async () => {
      useAuthStore.setState({ accessToken: null, isAuthenticated: true });
      vi.mocked(fetch).mockResolvedValue(okJson({}));

      await s().logout();

      const [, init] = vi.mocked(fetch).mock.calls[0];
      expect((init?.headers as Record<string, string>).Authorization).toBeUndefined();
    });
  });

  describe("setup", () => {
    it("stores token and user on success", async () => {
      vi.mocked(fetch).mockResolvedValue(okJson({ accessToken: adminToken }));

      await s().setup("admin", "password123");

      expect(s().isAuthenticated).toBe(true);
      expect(s().needsSetup).toBe(false);
      expect(s().user?.username).toBe("admin");
    });

    it("throws when setup fails with error response", async () => {
      vi.mocked(fetch).mockResolvedValue(
        new Response(JSON.stringify({ error: "Username taken" }), { status: 409 }),
      );
      await expect(s().setup("admin", "pw")).rejects.toThrow("Username taken");
    });

    it("throws generic error when setup fails and body is not JSON", async () => {
      vi.mocked(fetch).mockResolvedValue(new Response("oops", { status: 500 }));
      await expect(s().setup("admin", "pw")).rejects.toThrow("Setup failed");
    });
  });

  describe("checkSetupNeeded", () => {
    it("falls through to login view when status endpoint returns non-ok", async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(new Response("", { status: 401 })) // refresh
        .mockResolvedValueOnce(new Response("", { status: 500 })); // status

      await s().checkSetupNeeded();

      expect(s().needsSetup).toBe(false);
      expect(s().isAuthenticated).toBe(false);
      expect(s().loading).toBe(false);
    });

    it("handles network error in checkSetupNeeded", async () => {
      vi.mocked(fetch).mockRejectedValue(new Error("network error"));

      await s().checkSetupNeeded();

      expect(s().needsSetup).toBe(false);
      expect(s().isAuthenticated).toBe(false);
      expect(s().loading).toBe(false);
    });
  });

  describe("refresh timer", () => {
    it("starts refresh timer on login and refresh fires on interval", async () => {
      vi.mocked(fetch).mockResolvedValue(okJson({ accessToken: adminToken }));
      await s().login("admin", "pw");

      // Advance past the 13-minute refresh interval
      vi.advanceTimersByTime(13 * 60 * 1000 + 100);

      // refresh was called (the initial login + the timer refresh)
      expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(1);
    });

    it("stops refresh timer when refresh fails", async () => {
      // Initial login succeeds
      vi.mocked(fetch).mockResolvedValueOnce(okJson({ accessToken: adminToken }));
      await s().login("admin", "pw");

      // Subsequent refresh fails
      vi.mocked(fetch).mockResolvedValue(new Response("", { status: 401 }));

      // Advance to trigger one refresh
      await vi.advanceTimersByTimeAsync(13 * 60 * 1000 + 100);

      // The timer-triggered refresh should have cleared auth state
      expect(s().isAuthenticated).toBe(false);
    });
  });

  describe("decodeTokenPayload edge cases", () => {
    it("returns null user for malformed token (not 3 parts)", async () => {
      vi.mocked(fetch).mockResolvedValue(okJson({ accessToken: "not.a.valid.four.part" }));
      await s().login("admin", "pw");
      // Token has 5 parts — decode returns null
      expect(s().user).toBeNull();
    });

    it("returns null user for non-base64 token payload", async () => {
      vi.mocked(fetch).mockResolvedValue(okJson({ accessToken: "aaa.!!!invalid!!!.bbb" }));
      await s().login("admin", "pw");
      expect(s().user).toBeNull();
    });
  });
});
