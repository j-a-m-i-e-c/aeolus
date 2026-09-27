// frontend/src/components/mqtt/SecurityLevelSelector.test.tsx — Security level radio-cards: selection + confirmation

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { SecurityLevel } from "../../store/mqtt-provisioning-store";

const h = vi.hoisted(() => {
  const setLevel = vi.fn().mockResolvedValue(undefined);
  const state: {
    level: SecurityLevel;
    loading: boolean;
    managedProvisioningEnabled: boolean;
    perDeviceProvisioningEnabled: boolean;
    setLevel: typeof setLevel;
  } = {
    level: "open",
    loading: false,
    managedProvisioningEnabled: true,
    perDeviceProvisioningEnabled: true,
    setLevel,
  };
  const demoState = { readOnly: false };
  return { state, setLevel, demoState };
});

vi.mock("../../store/mqtt-provisioning-store", () => ({
  useMqttProvisioningStore: () => h.state,
}));
vi.mock("../../hooks/useReadOnlyDemo", () => ({ useReadOnlyDemo: () => h.demoState.readOnly }));

import SecurityLevelSelector from "./SecurityLevelSelector";

describe("SecurityLevelSelector", () => {
  beforeEach(() => {
    h.setLevel.mockReset().mockResolvedValue(undefined);
    h.state.level = "open";
    h.state.loading = false;
    h.state.managedProvisioningEnabled = true;
    h.state.perDeviceProvisioningEnabled = true;
    h.demoState.readOnly = false;
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("renders all three security level options", () => {
    render(<SecurityLevelSelector />);
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.getByText("Shared Password")).toBeInTheDocument();
    expect(screen.getByText("Per-Device")).toBeInTheDocument();
  });

  it("switches level without confirmation when leaving the open mode", async () => {
    render(<SecurityLevelSelector />);
    fireEvent.click(screen.getByText("Shared Password"));
    await waitFor(() => expect(h.setLevel).toHaveBeenCalledWith("shared_password"));
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it("does nothing when the already-active level is clicked", () => {
    render(<SecurityLevelSelector />);
    fireEvent.click(screen.getByText("Open"));
    expect(h.setLevel).not.toHaveBeenCalled();
  });

  it("prompts for confirmation when switching away from shared_password", async () => {
    h.state.level = "shared_password";
    render(<SecurityLevelSelector />);
    fireEvent.click(screen.getByText("Open"));
    await waitFor(() => expect(h.setLevel).toHaveBeenCalledWith("open"));
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("shared credential inactive"),
    );
  });

  it("prompts for confirmation when switching away from per_device", async () => {
    h.state.level = "per_device";
    render(<SecurityLevelSelector />);
    fireEvent.click(screen.getByText("Shared Password"));
    await waitFor(() => expect(h.setLevel).toHaveBeenCalledWith("shared_password"));
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("per-device credentials inactive"),
    );
  });

  it("aborts the switch when the confirmation is cancelled", () => {
    h.state.level = "shared_password";
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<SecurityLevelSelector />);
    fireEvent.click(screen.getByText("Per-Device"));
    expect(h.setLevel).not.toHaveBeenCalled();
  });

  it("does not switch while the store is loading", () => {
    h.state.loading = true;
    render(<SecurityLevelSelector />);
    fireEvent.click(screen.getByText("Shared Password"));
    expect(h.setLevel).not.toHaveBeenCalled();
  });

  it("keeps Shared Password available while Per-Device provisioning is disabled", async () => {
    h.state.managedProvisioningEnabled = true;
    h.state.perDeviceProvisioningEnabled = false;
    render(<SecurityLevelSelector />);

    expect(screen.getAllByText("Per-Device provisioning disabled")).toHaveLength(1);
    const sharedPassword = screen.getByRole("button", { name: /shared password/i });
    expect(sharedPassword).not.toBeDisabled();
    fireEvent.click(sharedPassword);
    await waitFor(() => expect(h.setLevel).toHaveBeenCalledWith("shared_password"));
    expect(screen.getByRole("button", { name: /per-device/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^open/i })).not.toBeDisabled();
  });

  it("disables authenticated modes when managed broker plumbing is unavailable", () => {
    h.state.managedProvisioningEnabled = false;
    render(<SecurityLevelSelector />);

    expect(screen.getAllByText("Managed broker setup unavailable")).toHaveLength(2);
    expect(screen.getByRole("button", { name: /shared password/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /per-device/i })).toBeDisabled();
  });

  it("labels Per-Device as under development once it is selectable, and leaves Shared Password unqualified", () => {
    h.state.managedProvisioningEnabled = true;
    render(<SecurityLevelSelector />);

    expect(screen.getAllByText("Under development")).toHaveLength(1);
    const perDevice = screen.getByRole("button", { name: /per-device/i });
    expect(perDevice).toHaveTextContent("Under development");
    // Selectable, not blocked: the mode works, it is the revocation proof that lags.
    expect(perDevice).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /shared password/i })).not.toHaveTextContent("Under development");
  });

  it("shows the Per-Device gate reason instead of a second maturity label while disabled", () => {
    h.state.managedProvisioningEnabled = true;
    h.state.perDeviceProvisioningEnabled = false;
    render(<SecurityLevelSelector />);

    expect(screen.getAllByText("Per-Device provisioning disabled")).toHaveLength(1);
    expect(screen.queryByText("Under development")).not.toBeInTheDocument();
  });

  it("lets the public demo preview broker modes without applying them", () => {
    h.demoState.readOnly = true;
    h.state.managedProvisioningEnabled = false;
    h.state.perDeviceProvisioningEnabled = false;
    render(<SecurityLevelSelector />);
    fireEvent.click(screen.getByText("Shared Password"));
    expect(screen.getByText(/Demo preview · not applied/i)).toBeInTheDocument();
    expect(h.setLevel).not.toHaveBeenCalled();
  });
});
