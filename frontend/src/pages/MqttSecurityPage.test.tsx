// frontend/src/pages/MqttSecurityPage.test.tsx — MQTT security level page

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const mockFetchStatus = vi.fn();
let mockLevel = "open";
let mockLoading = true;
let mockManagedProvisioningEnabled = true;
let mockPerDeviceProvisioningEnabled = true;

vi.mock("../store/mqtt-provisioning-store", () => ({
  useMqttProvisioningStore: () => ({
    level: mockLevel,
    loading: mockLoading,
    managedProvisioningEnabled: mockManagedProvisioningEnabled,
    perDeviceProvisioningEnabled: mockPerDeviceProvisioningEnabled,
    fetchStatus: mockFetchStatus,
  }),
}));

vi.mock("../components/mqtt/SecurityLevelSelector", () => ({
  default: () => <div data-testid="security-level-selector" />,
}));
vi.mock("../components/mqtt/SharedPasswordPanel", () => ({
  default: () => <div data-testid="shared-password-panel" />,
}));
vi.mock("../components/mqtt/DeviceCredentialList", () => ({
  default: () => <div data-testid="device-credential-list" />,
}));

import MqttSecurityPage from "./MqttSecurityPage";

describe("MqttSecurityPage", () => {
  beforeEach(() => {
    mockFetchStatus.mockResolvedValue(undefined);
    mockLevel = "open";
    mockLoading = true;
    mockManagedProvisioningEnabled = true;
    mockPerDeviceProvisioningEnabled = true;
  });

  it("shows a loading spinner initially", () => {
    mockFetchStatus.mockReturnValue(new Promise(() => {})); // never resolves
    render(<MqttSecurityPage />);
    // Loader2 icon is rendered — check for the animate-spin class indicator
    const spinner = document.querySelector(".animate-spin");
    expect(spinner).not.toBeNull();
  });

  it("renders the SecurityLevelSelector after init", async () => {
    mockLoading = false;
    render(<MqttSecurityPage />);
    await waitFor(() => expect(mockFetchStatus).toHaveBeenCalled());
    expect(screen.getByTestId("security-level-selector")).toBeInTheDocument();
  });

  it("shows SharedPasswordPanel when level is shared_password", async () => {
    mockLevel = "shared_password";
    mockLoading = false;
    render(<MqttSecurityPage />);
    await waitFor(() => expect(mockFetchStatus).toHaveBeenCalled());
    expect(screen.getByTestId("shared-password-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("device-credential-list")).not.toBeInTheDocument();
  });

  it("shows DeviceCredentialList when level is per_device and the experimental gate is enabled", async () => {
    mockLevel = "per_device";
    mockLoading = false;
    mockManagedProvisioningEnabled = true;
    render(<MqttSecurityPage />);
    await waitFor(() => expect(mockFetchStatus).toHaveBeenCalled());
    expect(screen.getByTestId("device-credential-list")).toBeInTheDocument();
    expect(screen.queryByTestId("shared-password-panel")).not.toBeInTheDocument();
  });

  it("shows neither panel when level is open", async () => {
    mockLevel = "open";
    mockLoading = false;
    render(<MqttSecurityPage />);
    await waitFor(() => expect(mockFetchStatus).toHaveBeenCalled());
    expect(screen.queryByTestId("shared-password-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("device-credential-list")).not.toBeInTheDocument();
  });

  it("keeps Shared Password available when only the Per-Device flag is off", async () => {
    mockLoading = false;
    mockManagedProvisioningEnabled = true;
    mockPerDeviceProvisioningEnabled = false;
    mockLevel = "shared_password";
    render(<MqttSecurityPage />);

    await waitFor(() => expect(mockFetchStatus).toHaveBeenCalled());
    expect(screen.getByTestId("shared-password-panel")).toBeInTheDocument();
    expect(screen.queryByText(/Dashboard-managed broker security is turned off/i)).not.toBeInTheDocument();
  });

  it("says how to turn managed broker security on rather than implying the plumbing is missing", async () => {
    mockLoading = false;
    mockManagedProvisioningEnabled = false;
    render(<MqttSecurityPage />);

    expect(await screen.findByText(/Dashboard-managed broker security is turned off/i)).toBeInTheDocument();
    // The standard Compose stack does have the plumbing; only the flag is off, so the
    // notice must point at the flag instead of blaming the deployment.
    expect(screen.getByText(/MQTT_MANAGED_PROVISIONING_ENABLED=true/)).toBeInTheDocument();
  });

  it("qualifies Per-Device with its revocation-verification gap when that mode is active", async () => {
    mockLoading = false;
    mockManagedProvisioningEnabled = true;
    mockLevel = "per_device";
    render(<MqttSecurityPage />);

    expect(await screen.findByText(/revocation is not yet conclusively verified/i)).toBeInTheDocument();
    expect(screen.getByTestId("device-credential-list")).toBeInTheDocument();
  });

  it("explains the Per-Device gate if that mode is persisted while the flag is off", async () => {
    mockLoading = false;
    mockManagedProvisioningEnabled = true;
    mockPerDeviceProvisioningEnabled = false;
    mockLevel = "per_device";
    render(<MqttSecurityPage />);

    expect(await screen.findByText(/Per-Device changes are disabled unless/i)).toBeInTheDocument();
    expect(screen.queryByTestId("device-credential-list")).not.toBeInTheDocument();
  });

  it("adds no under-development caveat to Shared Password", async () => {
    mockLoading = false;
    mockManagedProvisioningEnabled = true;
    mockLevel = "shared_password";
    render(<MqttSecurityPage />);

    await waitFor(() => expect(mockFetchStatus).toHaveBeenCalled());
    expect(screen.queryByText(/under development/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("shared-password-panel")).toBeInTheDocument();
  });
});
