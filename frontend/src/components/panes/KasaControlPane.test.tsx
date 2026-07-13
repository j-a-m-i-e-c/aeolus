// frontend/src/components/panes/KasaControlPane.test.tsx — Kasa device list, toggle, energy stats

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { PaneConfig } from "../../types/dashboard";

const { deviceState, mockSendAction } = vi.hoisted(() => ({
  deviceState: {} as any,
  mockSendAction: vi.fn(),
}));

vi.mock("../../store/device-store", () => ({
  useDeviceStore: (selector: (s: any) => unknown) => selector(deviceState),
}));

vi.mock("../../lib/api-client", () => ({
  sendAction: mockSendAction,
}));

import { KasaControlPane } from "./KasaControlPane";

function kasaDevice(overrides: Record<string, unknown> = {}) {
  return {
    id: "kasa-1",
    name: "Desk Plug",
    type: "switch",
    integration: "kasa",
    capabilities: [],
    lastSeen: 0,
    state: { on: false },
    ...overrides,
  };
}

function renderPane() {
  render(<KasaControlPane config={{} as PaneConfig} />);
}

describe("KasaControlPane", () => {
  beforeEach(() => {
    Object.assign(deviceState, { devices: {}, updateDevice: vi.fn() });
    mockSendAction.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows an empty state when there are no Kasa devices", () => {
    renderPane();
    expect(screen.getByText("No Kasa devices found.")).toBeInTheDocument();
  });

  it("ignores devices from other integrations", () => {
    deviceState.devices = {
      "hue-1": kasaDevice({ id: "hue-1", integration: "hue", name: "Hue Bulb" }),
    };
    renderPane();
    expect(screen.getByText("No Kasa devices found.")).toBeInTheDocument();
    expect(screen.queryByText("Hue Bulb")).not.toBeInTheDocument();
  });

  it("renders a card per Kasa device with name and online status", () => {
    deviceState.devices = {
      "kasa-1": kasaDevice({ id: "kasa-1", name: "Desk Plug", state: { on: true } }),
    };
    renderPane();
    expect(screen.getByText("Desk Plug")).toBeInTheDocument();
    expect(screen.getByText("online")).toBeInTheDocument();
    expect(screen.getByText("Turn Off")).toBeInTheDocument();
  });

  it("marks a device offline when reachable is false", () => {
    deviceState.devices = {
      "kasa-1": kasaDevice({ state: { on: false, reachable: false } }),
    };
    renderPane();
    expect(screen.getByText("offline")).toBeInTheDocument();
  });

  it("toggles a device optimistically and calls sendAction", async () => {
    mockSendAction.mockResolvedValueOnce({ success: true });
    deviceState.devices = { "kasa-1": kasaDevice({ state: { on: false } }) };
    renderPane();
    fireEvent.click(screen.getByText("Turn On"));
    expect(deviceState.updateDevice).toHaveBeenCalledWith("kasa-1", { on: true });
    await waitFor(() => expect(mockSendAction).toHaveBeenCalledWith("kasa-1", "toggle"));
  });

  it("reverts the optimistic toggle if sendAction fails", async () => {
    mockSendAction.mockRejectedValueOnce(new Error("network"));
    deviceState.devices = { "kasa-1": kasaDevice({ state: { on: true } }) };
    renderPane();
    fireEvent.click(screen.getByText("Turn Off"));
    expect(deviceState.updateDevice).toHaveBeenCalledWith("kasa-1", { on: false });
    await waitFor(() =>
      expect(deviceState.updateDevice).toHaveBeenCalledWith("kasa-1", { on: true }),
    );
  });

  it("renders energy stats when metering fields are present", () => {
    deviceState.devices = {
      "kasa-1": kasaDevice({
        state: { on: true, voltage: 120.4, current: 0.55, power: 66.1, totalConsumption: 1.234 },
      }),
    };
    renderPane();
    expect(screen.getByText("Energy")).toBeInTheDocument();
    expect(screen.getByText("120.4V")).toBeInTheDocument();
    expect(screen.getByText("0.55A")).toBeInTheDocument();
    expect(screen.getByText("66.1W")).toBeInTheDocument();
    expect(screen.getByText("1.23kWh")).toBeInTheDocument();
  });
});
