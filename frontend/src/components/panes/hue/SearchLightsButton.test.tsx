// frontend/src/components/panes/hue/SearchLightsButton.test.tsx — Zigbee light search UI

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const { mockAuthFetch } = vi.hoisted(() => ({ mockAuthFetch: vi.fn() }));

vi.mock("../../../lib/auth-fetch", () => ({
  authFetch: mockAuthFetch,
}));

import { SearchLightsButton } from "./SearchLightsButton";

describe("SearchLightsButton", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockAuthFetch.mockReset();
  });

  afterEach(() => {
    // Cancel any pending intervals/timeouts without firing their callbacks so
    // no state updates escape act() after the component under test unmounts.
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("renders the idle search button", () => {
    render(<SearchLightsButton connectorId="c1" />);
    expect(screen.getByText("Search for new lights")).toBeInTheDocument();
  });

  it("enters the searching state after starting a search", async () => {
    mockAuthFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    render(<SearchLightsButton connectorId="c1" />);

    await act(async () => {
      fireEvent.click(screen.getByText("Search for new lights"));
    });

    expect(screen.getByText(/Searching\.\.\./)).toBeInTheDocument();
    // The button is disabled while a search is active
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("surfaces an error when the search request fails", async () => {
    mockAuthFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "Bridge offline" }),
    });
    render(<SearchLightsButton connectorId="c1" />);

    await act(async () => {
      fireEvent.click(screen.getByText("Search for new lights"));
    });

    expect(screen.getByText("Bridge offline")).toBeInTheDocument();
    // Button returns to the idle, enabled state on failure
    expect(screen.getByText("Search for new lights")).toBeInTheDocument();
    expect(screen.getByRole("button")).not.toBeDisabled();
  });
});
