// frontend/src/pages/data-store/SetupWizard.test.tsx — setup wizard render, enable flow & errors

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { mockState, mockAuthFetch } = vi.hoisted(() => ({
  mockState: {} as any,
  mockAuthFetch: vi.fn(),
}));

vi.mock("../../store/data-store-store", () => ({
  useDataStoreStore: (selector: (s: any) => unknown) => selector(mockState),
}));

vi.mock("../../lib/auth-fetch", () => ({
  authFetch: mockAuthFetch,
}));

import { SetupWizard } from "./SetupWizard";

function resetState() {
  Object.assign(mockState, {
    fetchConfig: vi.fn().mockResolvedValue(undefined),
  });
}

describe("SetupWizard", () => {
  beforeEach(() => {
    resetState();
    mockAuthFetch.mockReset();
    // The mount effect probes the stats endpoint; default to a benign response.
    mockAuthFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
  });

  it("renders the wizard header and recommended defaults", async () => {
    render(<SetupWizard />);
    expect(
      screen.getByRole("heading", { name: "Enable Data Store" }),
    ).toBeInTheDocument();
    expect(screen.getByText("What is the Data Store?")).toBeInTheDocument();
    // Default disk tier (16 GB) => Standard tier, maxStorageMb 500
    expect(screen.getByText("Standard (8–32 GB free)")).toBeInTheDocument();
    expect(screen.getByDisplayValue("500")).toBeInTheDocument();
    // Wait for the mount effect's stats probe to settle to avoid act warnings.
    await waitFor(() => expect(mockAuthFetch).toHaveBeenCalled());
  });

  it("resets the config inputs to recommended values", async () => {
    render(<SetupWizard />);
    const storageInput = screen.getByDisplayValue("500");
    fireEvent.change(storageInput, { target: { value: "123" } });
    expect(screen.getByDisplayValue("123")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Reset to recommended/i }));
    expect(screen.getByDisplayValue("500")).toBeInTheDocument();
    await waitFor(() => expect(mockAuthFetch).toHaveBeenCalled());
  });

  it("enables the Data Store and refreshes config on success", async () => {
    render(<SetupWizard />);
    fireEvent.click(screen.getByRole("button", { name: /Enable Data Store/i }));

    await waitFor(() =>
      expect(
        mockAuthFetch.mock.calls.some(([url]) =>
          String(url).endsWith("/api/data-store/enable"),
        ),
      ).toBe(true),
    );
    const enableCall = mockAuthFetch.mock.calls.find(([url]) =>
      String(url).endsWith("/api/data-store/enable"),
    )!;
    expect(enableCall[1].method).toBe("POST");
    expect(JSON.parse(enableCall[1].body)).toMatchObject({ enabled: true });
    await waitFor(() => expect(mockState.fetchConfig).toHaveBeenCalled());
  });

  it("shows an error message when enabling fails", async () => {
    // First call = stats probe (ok); second = enable (fails).
    mockAuthFetch.mockReset();
    mockAuthFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Server Error",
        json: async () => ({ error: "Cannot enable" }),
      });
    render(<SetupWizard />);
    fireEvent.click(screen.getByRole("button", { name: /Enable Data Store/i }));
    expect(await screen.findByText("Cannot enable")).toBeInTheDocument();
    expect(mockState.fetchConfig).not.toHaveBeenCalled();
  });
});
