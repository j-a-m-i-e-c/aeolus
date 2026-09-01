// frontend/src/pages/data-store/SettingsPanel.test.tsx — config form, confirmation, save & errors

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { mockState, mockAuthFetch, demoState } = vi.hoisted(() => ({
  mockState: {} as any,
  mockAuthFetch: vi.fn(),
  demoState: { readOnly: false },
}));

vi.mock("../../store/data-store-store", () => ({
  useDataStoreStore: (selector: (s: any) => unknown) => selector(mockState),
}));

vi.mock("../../lib/auth-fetch", () => ({
  authFetch: mockAuthFetch,
}));

vi.mock("../../hooks/useReadOnlyDemo", () => ({
  useReadOnlyDemo: () => demoState.readOnly,
}));

import { SettingsPanel } from "./SettingsPanel";

function resetState() {
  Object.assign(mockState, {
    config: {
      enabled: true,
      maxStorageMb: 500,
      maxRecordsPerCollection: 100000,
      maxCollections: 50,
    },
    fetchConfig: vi.fn().mockResolvedValue(undefined),
  });
}

describe("SettingsPanel", () => {
  beforeEach(() => {
    resetState();
    demoState.readOnly = false;
    mockAuthFetch.mockReset();
  });

  it("initializes the form from the current config", () => {
    render(<SettingsPanel />);
    expect(screen.getByDisplayValue("500")).toBeInTheDocument();
    expect(screen.getByDisplayValue("100000")).toBeInTheDocument();
    expect(screen.getByDisplayValue("50")).toBeInTheDocument();
  });

  it("keeps Save disabled until a value changes", () => {
    render(<SettingsPanel />);
    const save = screen.getByRole("button", { name: /Save Changes/i });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByDisplayValue("500"), { target: { value: "800" } });
    expect(save).not.toBeDisabled();
  });

  it("keeps configuration fields explorable but unsaveable in the public demo", () => {
    demoState.readOnly = true;
    render(<SettingsPanel />);
    const input = screen.getByDisplayValue("500");
    fireEvent.change(input, { target: { value: "800" } });
    expect(screen.getByDisplayValue("800")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Demo preview · not saved/i })).toBeDisabled();
    expect(mockAuthFetch).not.toHaveBeenCalled();
  });

  it("shows the confirmation dialog with a before/after diff", () => {
    render(<SettingsPanel />);
    fireEvent.change(screen.getByDisplayValue("500"), { target: { value: "800" } });
    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));
    expect(screen.getByText("Confirm Configuration Change")).toBeInTheDocument();
    expect(screen.getByText("800 MB")).toBeInTheDocument();
  });

  it("applies the change: PUTs config, refreshes, and shows success", async () => {
    mockAuthFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    render(<SettingsPanel />);
    fireEvent.change(screen.getByDisplayValue("500"), { target: { value: "800" } });
    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));
    fireEvent.click(screen.getByRole("button", { name: /Apply Changes/i }));

    await waitFor(() => expect(mockAuthFetch).toHaveBeenCalledTimes(1));
    const [url, options] = mockAuthFetch.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/data-store\/config$/);
    expect(options.method).toBe("PUT");
    expect(JSON.parse(options.body).maxStorageMb).toBe(800);
    await waitFor(() => expect(mockState.fetchConfig).toHaveBeenCalled());
    expect(
      await screen.findByText("Configuration updated successfully"),
    ).toBeInTheDocument();
  });

  it("shows the server error when applying the change fails", async () => {
    mockAuthFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Server Error",
      json: async () => ({ error: "Persist failed" }),
    });
    render(<SettingsPanel />);
    fireEvent.change(screen.getByDisplayValue("500"), { target: { value: "800" } });
    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));
    fireEvent.click(screen.getByRole("button", { name: /Apply Changes/i }));

    expect(await screen.findByText("Persist failed")).toBeInTheDocument();
    expect(mockState.fetchConfig).not.toHaveBeenCalled();
  });

  it("dismisses the confirmation dialog on Cancel", () => {
    render(<SettingsPanel />);
    fireEvent.change(screen.getByDisplayValue("500"), { target: { value: "800" } });
    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));
    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(screen.queryByText("Confirm Configuration Change")).not.toBeInTheDocument();
  });
});
