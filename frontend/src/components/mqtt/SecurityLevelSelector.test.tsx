// frontend/src/components/mqtt/SecurityLevelSelector.test.tsx — security level selection

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { SecurityLevel } from "../../store/mqtt-provisioning-store";

const h = vi.hoisted(() => {
  const setLevel = vi.fn().mockResolvedValue(undefined);
  const state: {
    level: SecurityLevel;
    loading: boolean;
    brokerManagementAvailable: boolean;
    setLevel: typeof setLevel;
  } = {
    level: "open",
    loading: false,
    brokerManagementAvailable: true,
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
    h.state.brokerManagementAvailable = true;
    h.demoState.readOnly = false;
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("renders all three supported security modes without maturity warnings", () => {
    render(<SecurityLevelSelector />);
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.getByText("Shared Password")).toBeInTheDocument();
    expect(screen.getByText("Per-Device")).toBeInTheDocument();
    expect(screen.queryByText(/under development|experimental|disabled/i)).not.toBeInTheDocument();
  });

  it("switches from Open to Shared Password", async () => {
    render(<SecurityLevelSelector />);
    fireEvent.click(screen.getByText("Shared Password"));
    await waitFor(() => expect(h.setLevel).toHaveBeenCalledWith("shared_password"));
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it("switches from Open to Per-Device without a feature gate", async () => {
    render(<SecurityLevelSelector />);
    fireEvent.click(screen.getByText("Per-Device"));
    await waitFor(() => expect(h.setLevel).toHaveBeenCalledWith("per_device"));
  });

  it("does nothing when the already-active mode is clicked", () => {
    render(<SecurityLevelSelector />);
    fireEvent.click(screen.getByText("Open"));
    expect(h.setLevel).not.toHaveBeenCalled();
  });

  it("does not switch while the store is loading", () => {
    h.state.loading = true;
    render(<SecurityLevelSelector />);
    fireEvent.click(screen.getByText("Shared Password"));
    expect(h.setLevel).not.toHaveBeenCalled();
  });

  it("prompts when switching away from a credential-bearing mode", async () => {
    h.state.level = "per_device";
    render(<SecurityLevelSelector />);
    fireEvent.click(screen.getByText("Shared Password"));
    await waitFor(() => expect(h.setLevel).toHaveBeenCalledWith("shared_password"));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("per-device credentials inactive"));
  });

  it("names the shared credential when leaving Shared Password", async () => {
    h.state.level = "shared_password";
    render(<SecurityLevelSelector />);
    fireEvent.click(screen.getByText("Open"));
    await waitFor(() => expect(h.setLevel).toHaveBeenCalledWith("open"));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("shared credential inactive"));
  });

  it("aborts the switch when the confirmation is cancelled", () => {
    h.state.level = "shared_password";
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<SecurityLevelSelector />);
    fireEvent.click(screen.getByText("Per-Device"));
    expect(h.setLevel).not.toHaveBeenCalled();
  });

  it("disables authenticated modes only when this runtime lacks live broker management", () => {
    h.state.brokerManagementAvailable = false;
    render(<SecurityLevelSelector />);
    expect(screen.getByRole("button", { name: /shared password/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /per-device/i })).toBeDisabled();
    expect(screen.getAllByText(/Broker management unavailable in this runtime/i)).toHaveLength(2);
  });

  it("lets the public demo preview modes without applying them", () => {
    h.demoState.readOnly = true;
    h.state.brokerManagementAvailable = false;
    render(<SecurityLevelSelector />);
    fireEvent.click(screen.getByText("Per-Device"));
    expect(screen.getByText(/Demo preview · not applied/i)).toBeInTheDocument();
    expect(h.setLevel).not.toHaveBeenCalled();
  });
});
