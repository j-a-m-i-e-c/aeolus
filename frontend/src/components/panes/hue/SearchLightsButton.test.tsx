// frontend/src/components/panes/hue/SearchLightsButton.test.tsx
//
// Pressing this button starts a scan on the bridge that the UI then has to follow
// for up to 40 seconds: a countdown the operator watches, a poll that decides when
// the scan has finished, and a re-discovery so the newly paired lights actually
// appear. None of that lifecycle was covered — only the initial press.
//
// Timers are faked, because the thing being tested is what happens between the
// press and the result.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const { mockAuthFetch } = vi.hoisted(() => ({ mockAuthFetch: vi.fn() }));
vi.mock("../../../lib/auth-fetch", () => ({ authFetch: mockAuthFetch }));

import { SearchLightsButton } from "./SearchLightsButton";

interface Script {
  /** Response to the POST that starts the scan. */
  start: { ok: boolean; status?: number; body?: unknown };
  /** Successive answers to the status poll. When exhausted, the last one repeats. */
  statuses: Array<{
    ok?: boolean;
    active: boolean;
    newLights?: Array<{ id: string; name: string }>;
    error?: string | null;
  }>;
  /** Whether the re-discovery call rejects. */
  retryFails: boolean;
}

let script: Script;

function routeFetch() {
  script = { start: { ok: true }, statuses: [], retryFails: false };
  mockAuthFetch.mockReset();
  mockAuthFetch.mockImplementation(async (url: unknown, init?: { method?: string }) => {
    const target = String(url);

    if (target.endsWith("/search-lights/status")) {
      const next = script.statuses.length > 1 ? script.statuses.shift()! : script.statuses[0];
      if (!next) return { ok: true, json: async () => ({ active: true, newLights: [], error: null }) };
      return {
        ok: next.ok ?? true,
        json: async () => ({
          active: next.active,
          startedAt: 1,
          newLights: next.newLights ?? [],
          error: next.error ?? null,
        }),
      };
    }

    if (target.endsWith("/search-lights") && init?.method === "POST") {
      return {
        ok: script.start.ok,
        status: script.start.status ?? 200,
        json: async () => script.start.body ?? {},
      };
    }

    if (target.endsWith("/retry")) {
      if (script.retryFails) throw new Error("connector offline");
      return { ok: true, json: async () => ({ success: true }) };
    }

    return { ok: true, json: async () => ({}) };
  });
}

/** Press the button and let the start request settle. */
async function startSearch() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button"));
  });
}

/** Advance time inside act so React sees the state updates the timers cause. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("SearchLightsButton", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    routeFetch();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("offers the search before anything has been asked of the bridge", () => {
    render(<SearchLightsButton connectorId="hue-1" />);
    expect(screen.getByText("Search for new lights")).toBeInTheDocument();
    expect(screen.getByRole("button")).not.toBeDisabled();
  });

  it("shows a countdown while the scan runs, so the wait is visible", async () => {
    render(<SearchLightsButton connectorId="hue-1" />);
    await startSearch();

    expect(screen.getByRole("button")).toBeDisabled();
    expect(screen.getByText(/\(40s\)/)).toBeInTheDocument();

    await advance(1000);
    expect(screen.getByText(/\(39s\)/)).toBeInTheDocument();

    await advance(2000);
    expect(screen.getByText(/\(37s\)/)).toBeInTheDocument();
  });

  it("stops the countdown at zero rather than going negative", async () => {
    render(<SearchLightsButton connectorId="hue-1" />);
    await startSearch();

    await advance(40_000);
    // The parenthesised seconds disappear at zero instead of showing "(0s)".
    expect(screen.queryByText(/\(\d+s\)/)).not.toBeInTheDocument();
    expect(screen.getByText(/Searching/)).toBeInTheDocument();
  });

  it("reports the lights the bridge found once the scan finishes", async () => {
    script.statuses = [
      { active: true },
      { active: false, newLights: [{ id: "7", name: "Hallway" }, { id: "8", name: "Study" }] },
    ];
    render(<SearchLightsButton connectorId="hue-1" />);
    await startSearch();

    await advance(3000); // first poll: still scanning
    expect(screen.getByRole("button")).toBeDisabled();

    await advance(3000); // second poll: finished
    expect(screen.getByText("Found 2 new lights:")).toBeInTheDocument();
    expect(screen.getByText("Hallway")).toBeInTheDocument();
    expect(screen.getByText("Study")).toBeInTheDocument();
    expect(screen.getByRole("button")).not.toBeDisabled();
  });

  it("uses the singular when the bridge found exactly one light", async () => {
    script.statuses = [{ active: false, newLights: [{ id: "7", name: "Hallway" }] }];
    render(<SearchLightsButton connectorId="hue-1" />);
    await startSearch();
    await advance(3000);

    expect(screen.getByText("Found 1 new light:")).toBeInTheDocument();
  });

  it("says plainly when a completed scan found nothing", async () => {
    script.statuses = [{ active: false, newLights: [] }];
    render(<SearchLightsButton connectorId="hue-1" />);
    await startSearch();
    await advance(3000);

    expect(screen.getByText("No new lights found.")).toBeInTheDocument();
  });

  it("re-discovers devices so a newly paired light appears without a reload", async () => {
    script.statuses = [{ active: false, newLights: [{ id: "7", name: "Hallway" }] }];
    render(<SearchLightsButton connectorId="hue-1" />);
    await startSearch();
    await advance(3000);

    expect(
      mockAuthFetch.mock.calls.some(([url]) => String(url).endsWith("/retry")),
    ).toBe(true);
  });

  it("still reports the found lights when re-discovery fails", async () => {
    script.statuses = [{ active: false, newLights: [{ id: "7", name: "Hallway" }] }];
    script.retryFails = true;
    render(<SearchLightsButton connectorId="hue-1" />);
    await startSearch();
    await advance(3000);

    // The scan result is the bridge's, and a failed refresh does not unfind a light.
    expect(screen.getByText("Found 1 new light:")).toBeInTheDocument();
  });

  it("surfaces an error the bridge reported alongside the result", async () => {
    script.statuses = [{ active: false, newLights: [], error: "Scan interrupted" }];
    render(<SearchLightsButton connectorId="hue-1" />);
    await startSearch();
    await advance(3000);

    expect(screen.getByText("Scan interrupted")).toBeInTheDocument();
    expect(screen.getByText("No new lights found.")).toBeInTheDocument();
  });

  it("keeps polling when the status request itself fails", async () => {
    script.statuses = [{ ok: false, active: false }];
    render(<SearchLightsButton connectorId="hue-1" />);
    await startSearch();
    await advance(3000);

    // A failed status poll carries no scan state, so the search must not be
    // declared finished on the strength of it.
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("keeps polling when the status request throws", async () => {
    mockAuthFetch.mockImplementation(async (url: unknown, init?: { method?: string }) => {
      const target = String(url);
      if (target.endsWith("/search-lights/status")) throw new Error("network down");
      if (target.endsWith("/search-lights") && init?.method === "POST") {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      return { ok: true, json: async () => ({}) };
    });

    render(<SearchLightsButton connectorId="hue-1" />);
    await startSearch();
    await advance(6000);

    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("reports the reason the bridge refused to start a scan", async () => {
    script.start = { ok: false, status: 409, body: { error: "Bridge is already scanning" } };
    render(<SearchLightsButton connectorId="hue-1" />);
    await startSearch();

    expect(screen.getByText("Bridge is already scanning")).toBeInTheDocument();
    // Nothing was started, so the button is offered again immediately.
    expect(screen.getByRole("button")).not.toBeDisabled();
  });

  it("falls back to the status code when the refusal carries no message", async () => {
    script.start = { ok: false, status: 503, body: {} };
    render(<SearchLightsButton connectorId="hue-1" />);
    await startSearch();

    expect(screen.getByText("Search failed: 503")).toBeInTheDocument();
  });

  it("falls back to a generic message when the refusal body is not JSON", async () => {
    mockAuthFetch.mockImplementation(async () => ({
      ok: false,
      status: 500,
      json: async () => { throw new Error("not json"); },
    }));
    render(<SearchLightsButton connectorId="hue-1" />);
    await startSearch();

    expect(screen.getByText("Search failed")).toBeInTheDocument();
  });

  it("reports a request that never reached the bridge", async () => {
    mockAuthFetch.mockRejectedValue(new Error("connector unreachable"));
    render(<SearchLightsButton connectorId="hue-1" />);
    await startSearch();

    expect(screen.getByText("connector unreachable")).toBeInTheDocument();
    expect(screen.getByRole("button")).not.toBeDisabled();
  });

  it("clears an earlier error and result when a new search starts", async () => {
    script.statuses = [{ active: false, newLights: [], error: "Scan interrupted" }];
    render(<SearchLightsButton connectorId="hue-1" />);
    await startSearch();
    await advance(3000);
    expect(screen.getByText("Scan interrupted")).toBeInTheDocument();

    script.statuses = [{ active: true }];
    await startSearch();
    expect(screen.queryByText("Scan interrupted")).not.toBeInTheDocument();
    expect(screen.queryByText("No new lights found.")).not.toBeInTheDocument();
  });

  it("stops polling when the pane goes away mid-scan", async () => {
    const { unmount } = render(<SearchLightsButton connectorId="hue-1" />);
    await startSearch();
    await advance(3000);

    const callsBefore = mockAuthFetch.mock.calls.length;
    unmount();
    await advance(12_000);

    // A pane the operator has navigated away from must not keep polling the bridge.
    expect(mockAuthFetch.mock.calls.length).toBe(callsBefore);
  });
});
