// frontend/src/lib/auth-fetch.test.ts — Unit tests for the authenticated fetch wrapper

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the auth store the wrapper reads the token + refresh() from.
vi.mock("../store/auth-store", () => ({
  useAuthStore: { getState: vi.fn() },
}));

import { authFetch } from "./auth-fetch";
import { useAuthStore } from "../store/auth-store";

const mockGetState = vi.mocked(useAuthStore.getState);

function ok(body: unknown = {}) {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe("authFetch", () => {
  beforeEach(() => {
    mockGetState.mockReset();
    global.fetch = vi.fn();
  });

  it("injects the Bearer token and a default Content-Type", async () => {
    mockGetState.mockReturnValue({ accessToken: "tok-123", refresh: vi.fn() } as never);
    vi.mocked(fetch).mockResolvedValue(ok());

    await authFetch("/api/devices");

    const [, init] = vi.mocked(fetch).mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer tok-123");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(init?.credentials).toBe("include");
  });

  it("omits the Authorization header when there is no token", async () => {
    mockGetState.mockReturnValue({ accessToken: null, refresh: vi.fn() } as never);
    vi.mocked(fetch).mockResolvedValue(ok());

    await authFetch("/api/devices");

    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(new Headers(init?.headers).has("Authorization")).toBe(false);
  });

  it("preserves a caller-provided Content-Type", async () => {
    mockGetState.mockReturnValue({ accessToken: "t", refresh: vi.fn() } as never);
    vi.mocked(fetch).mockResolvedValue(ok());

    await authFetch("/api/upload", { headers: { "Content-Type": "text/plain" } });

    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(new Headers(init?.headers).get("Content-Type")).toBe("text/plain");
  });

  it("refreshes and retries once on a 401 when a token is present", async () => {
    const refresh = vi.fn().mockResolvedValue(true);
    // getState() is read 3x: initial, inside attemptRefresh, and post-refresh.
    mockGetState
      .mockReturnValueOnce({ accessToken: "old", refresh } as never) // initial read
      .mockReturnValue({ accessToken: "new", refresh } as never); // refresh() + post-refresh read

    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response("", { status: 401 }))
      .mockResolvedValueOnce(ok({ retried: true }));

    const res = await authFetch("/api/devices");

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    // Retry used the refreshed token
    const retryInit = vi.mocked(fetch).mock.calls[1][1];
    expect(new Headers(retryInit?.headers).get("Authorization")).toBe("Bearer new");
    expect(res.status).toBe(200);
  });

  it("does not retry when refresh fails", async () => {
    const refresh = vi.fn().mockResolvedValue(false);
    mockGetState.mockReturnValue({ accessToken: "old", refresh } as never);
    vi.mocked(fetch).mockResolvedValue(new Response("", { status: 401 }));

    const res = await authFetch("/api/devices");

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(401);
  });

  it("does not attempt refresh on a 401 when there was no token", async () => {
    const refresh = vi.fn();
    mockGetState.mockReturnValue({ accessToken: null, refresh } as never);
    vi.mocked(fetch).mockResolvedValue(new Response("", { status: 401 }));

    await authFetch("/api/devices");

    expect(refresh).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
