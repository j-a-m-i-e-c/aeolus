// frontend/src/components/mqtt/DeviceCredentialList.test.tsx — Per-device credential list: fetch, create, revoke

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type {
  MqttCredential,
  MqttCredentialListItem,
} from "../../store/mqtt-provisioning-store";

const h = vi.hoisted(() => {
  const fetchCredentials = vi.fn().mockResolvedValue(undefined);
  const createCredential = vi.fn();
  const revokeCredential = vi.fn().mockResolvedValue(undefined);
  const state: {
    credentials: MqttCredentialListItem[];
    fetchCredentials: typeof fetchCredentials;
    createCredential: typeof createCredential;
    revokeCredential: typeof revokeCredential;
  } = {
    credentials: [],
    fetchCredentials,
    createCredential,
    revokeCredential,
  };
  return { state, fetchCredentials, createCredential, revokeCredential };
});

vi.mock("../../store/mqtt-provisioning-store", () => ({
  useMqttProvisioningStore: () => h.state,
}));

import DeviceCredentialList from "./DeviceCredentialList";

const listItems: MqttCredentialListItem[] = [
  { id: "c1", deviceName: "Thermostat", username: "dev_thermostat", createdAt: 1_700_000_000_000 },
  { id: "c2", deviceName: "Doorbell", username: "dev_doorbell", createdAt: 1_700_100_000_000 },
];

const newCredential: MqttCredential = {
  id: "c3",
  deviceName: "Garage",
  username: "dev_garage",
  password: "generated-pass",
};

describe("DeviceCredentialList", () => {
  beforeEach(() => {
    h.fetchCredentials.mockReset().mockResolvedValue(undefined);
    h.createCredential.mockReset().mockResolvedValue(newCredential);
    h.revokeCredential.mockReset().mockResolvedValue(undefined);
    h.state.credentials = [];
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });

  it("fetches credentials on mount", () => {
    render(<DeviceCredentialList />);
    expect(h.fetchCredentials).toHaveBeenCalledTimes(1);
  });

  it("shows the empty state when there are no credentials", () => {
    render(<DeviceCredentialList />);
    expect(screen.getByText("No device credentials yet")).toBeInTheDocument();
  });

  it("renders a row for each existing credential", () => {
    h.state.credentials = listItems;
    render(<DeviceCredentialList />);
    expect(screen.getByText("Thermostat")).toBeInTheDocument();
    expect(screen.getByText("dev_thermostat")).toBeInTheDocument();
    expect(screen.getByText("Doorbell")).toBeInTheDocument();
  });

  it("disables the create button when the device name is empty", () => {
    render(<DeviceCredentialList />);
    expect(screen.getByRole("button", { name: /Create/ })).toBeDisabled();
  });

  it("creates a credential and shows the one-time dialog", async () => {
    render(<DeviceCredentialList />);
    fireEvent.change(screen.getByPlaceholderText("Device name"), {
      target: { value: "Garage" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Create/ }));
    await waitFor(() => expect(h.createCredential).toHaveBeenCalledWith("Garage"));
    expect(await screen.findByText("Credential Created")).toBeInTheDocument();
    expect(screen.getByText("generated-pass")).toBeInTheDocument();
  });

  it("does not create when the name is only whitespace", () => {
    render(<DeviceCredentialList />);
    fireEvent.change(screen.getByPlaceholderText("Device name"), {
      target: { value: "   " },
    });
    fireEvent.submit(screen.getByPlaceholderText("Device name").closest("form")!);
    expect(h.createCredential).not.toHaveBeenCalled();
  });

  it("revokes a credential after confirmation", () => {
    h.state.credentials = listItems;
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<DeviceCredentialList />);
    fireEvent.click(screen.getByTitle("Revoke credential for Thermostat"));
    expect(h.revokeCredential).toHaveBeenCalledWith("c1");
  });

  it("does not revoke when the confirmation is cancelled", () => {
    h.state.credentials = listItems;
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<DeviceCredentialList />);
    fireEvent.click(screen.getByTitle("Revoke credential for Doorbell"));
    expect(h.revokeCredential).not.toHaveBeenCalled();
  });
});
