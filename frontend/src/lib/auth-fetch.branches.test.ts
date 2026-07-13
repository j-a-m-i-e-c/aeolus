// frontend/src/lib/auth-fetch.branches.test.ts — Tests for deduplication branch

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../store/auth-store", () => ({
  useAuthStore: { getState: vi.fn() },
}));

import { authFetch } from "./auth-fetch";
import { useAuthStore } from "../store/auth-store";

const mockGetState = vi.mocked(useAuthStore.getState);

describe("authFetch — concurrent refresh deduplication", () => {
  beforeEach(() => {
    mockGetState.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("deduplicates concurrent refresh attempts", async () => {
    let resolveRefresh: (value: boolean) => void;
    const refreshPromise = new Promise<boolean>((r) => { resolveRefresh = r; });
    const refresh = vi.fn().mockReturnValue(refreshPromise);

    mockGetState.mockReturnValue({ accessToken: "old", refresh } as never);

    vi.mocked(fetch).mockResolvedValue(new Response("", { status: 401 }));

    // Start two concurrent requests that both get 401
    const req1 = authFetch("/api/one");
    const req2 = authFetch("/api/two");

    // Both should be waiting on the same refresh
    // Resolve the refresh
    resolveRefresh!(false);

    await Promise.all([req1, req2]);

    // refresh() should only have been called once due to deduplication
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
