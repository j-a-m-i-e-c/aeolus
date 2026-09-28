// frontend/src/pages/MqttSecurityPage.test.tsx

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { SecurityLevel } from "../store/mqtt-provisioning-store";

let mockLevel: SecurityLevel = "open";
let mockLoading = false;
let mockBrokerManagementAvailable = true;
const mockFetchStatus = vi.fn().mockResolvedValue(undefined);

vi.mock("../store/mqtt-provisioning-store", () => ({
  useMqttProvisioningStore: () => ({
    level: mockLevel,
    loading: mockLoading,
    brokerManagementAvailable: mockBrokerManagementAvailable,
    fetchStatus: mockFetchStatus,
  }),
}));
vi.mock("../components/mqtt/SecurityLevelSelector", () => ({ default: () => <div data-testid="selector" /> }));
vi.mock("../components/mqtt/SharedPasswordPanel", () => ({ default: () => <div data-testid="shared-password-panel" /> }));
vi.mock("../components/mqtt/DeviceCredentialList", () => ({ default: () => <div data-testid="device-credential-list" /> }));

import MqttSecurityPage from "./MqttSecurityPage";

describe("MqttSecurityPage", () => {
  beforeEach(() => {
    mockLevel = "open";
    mockLoading = false;
    mockBrokerManagementAvailable = true;
    mockFetchStatus.mockClear().mockResolvedValue(undefined);
  });

  it("shows a loading spinner until the first status fetch resolves", () => {
    mockLoading = true;
    mockFetchStatus.mockReturnValue(new Promise(() => {})); // never resolves
    render(<MqttSecurityPage />);
    expect(document.querySelector(".animate-spin")).not.toBeNull();
  });

  it("shows the shared credential panel in Shared Password mode", async () => {
    mockLevel = "shared_password";
    render(<MqttSecurityPage />);
    await waitFor(() => expect(mockFetchStatus).toHaveBeenCalled());
    expect(screen.getByTestId("shared-password-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("device-credential-list")).not.toBeInTheDocument();
  });

  it("shows per-device credential management as a normal supported mode", async () => {
    mockLevel = "per_device";
    render(<MqttSecurityPage />);
    await waitFor(() => expect(mockFetchStatus).toHaveBeenCalled());
    expect(screen.getByTestId("device-credential-list")).toBeInTheDocument();
    expect(screen.queryByText(/under development|experimental/i)).not.toBeInTheDocument();
  });

  it("shows neither credential panel in Open mode", async () => {
    render(<MqttSecurityPage />);
    await waitFor(() => expect(mockFetchStatus).toHaveBeenCalled());
    expect(screen.queryByTestId("shared-password-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("device-credential-list")).not.toBeInTheDocument();
  });

  it("explains a non-standard runtime that lacks live broker wiring", async () => {
    mockBrokerManagementAvailable = false;
    render(<MqttSecurityPage />);
    expect(await screen.findByText(/not connected to Aeolus.*managed Mosquitto configuration/i)).toBeInTheDocument();
  });
});
