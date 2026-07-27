// frontend/src/pages/MqttSecurityPage.test.tsx — MQTT security level page

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const mockFetchStatus = vi.fn();
let mockLevel = "open";
let mockLoading = true;
let mockManagedProvisioningEnabled = true;

vi.mock("../store/mqtt-provisioning-store", () => ({
  useMqttProvisioningStore: () => ({
    level: mockLevel,
    loading: mockLoading,
    managedProvisioningEnabled: mockManagedProvisioningEnabled,
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

  it("shows DeviceCredentialList when level is per_device", async () => {
    mockLevel = "per_device";
    mockLoading = false;
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

  it("explains that managed modes are under development when disabled", async () => {
    mockLoading = false;
    mockManagedProvisioningEnabled = false;
    render(<MqttSecurityPage />);

    expect(await screen.findByText(/under development/i)).toBeInTheDocument();
  });
});
