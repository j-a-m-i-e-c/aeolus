// frontend/src/components/panes/KasaControlPane.test.tsx — Unit tests for KasaControlPane

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { PaneConfig } from "../../types/dashboard";

const mockSendAction = vi.fn();
vi.mock("../../lib/api-client", () => ({
  sendAction: (...args: unknown[]) => mockSendAction(...args),
}));

let mockDevices: Record<string, unknown> = {};
const mockUpdateDevice = vi.fn();
vi.mock("../../store/device-store", () => ({
  useDeviceStore: (selector: (s: { devices: Record<string, unknown>; updateDevice: typeof mockUpdateDevice }) => unknown) =>
    selector({ devices: mockDevices, updateDevice: mockUpdateDevice }),
}));

import { KasaControlPane } from "./KasaControlPane";

describe("KasaControlPane", () => {
  beforeEach(() => {
    mockSendAction.mockReset();
    mockSendAction.mockResolvedValue({ success: true });
    mockUpdateDevice.mockReset();
    mockDevices = {};
  });

  it("shows empty state when no Kasa devices exist", () => {
    mockDevices = {
      "hue-light": { id: "hue-light", name: "Hue", type: "light", integration: "hue", state: {} },
    };
    render(<KasaControlPane config={{} as PaneConfig} />);
    expect(screen.getByText("No Kasa devices found.")).toBeInTheDocument();
  });

  it("renders Kasa devices with their names and type badges", () => {
    mockDevices = {
      "kasa-1": { id: "kasa-1", name: "Desk Lamp", type: "light", integration: "kasa", state: { on: true, online: true } },
      "kasa-2": { id: "kasa-2", name: "Power Strip", type: "switch", integration: "kasa", state: { on: false, online: true } },
    };
    render(<KasaControlPane config={{} as PaneConfig} />);
    expect(screen.getByText("Desk Lamp")).toBeInTheDocument();
    expect(screen.getByText("Power Strip")).toBeInTheDocument();
    expect(screen.getByText("Light")).toBeInTheDocument();
    expect(screen.getByText("Switch")).toBeInTheDocument();
  });

  it("shows Turn Off for on devices and Turn On for off devices", () => {
    mockDevices = {
      "kasa-1": { id: "kasa-1", name: "Lamp", type: "light", integration: "kasa", state: { on: true } },
      "kasa-2": { id: "kasa-2", name: "Fan", type: "switch", integration: "kasa", state: { on: false } },
    };
    render(<KasaControlPane config={{} as PaneConfig} />);
    expect(screen.getByText("Turn Off")).toBeInTheDocument();
    expect(screen.getByText("Turn On")).toBeInTheDocument();
  });

  it("shows online/offline status badges", () => {
    mockDevices = {
      "kasa-1": { id: "kasa-1", name: "Lamp", type: "light", integration: "kasa", state: { on: true, online: true } },
      "kasa-2": { id: "kasa-2", name: "Fan", type: "switch", integration: "kasa", state: { on: false, online: false } },
    };
    render(<KasaControlPane config={{} as PaneConfig} />);
    expect(screen.getByText("online")).toBeInTheDocument();
    expect(screen.getByText("offline")).toBeInTheDocument();
  });

  it("toggles a device on click and calls sendAction", async () => {
    mockDevices = {
      "kasa-1": { id: "kasa-1", name: "Lamp", type: "light", integration: "kasa", state: { on: true } },
    };
    render(<KasaControlPane config={{} as PaneConfig} />);
    fireEvent.click(screen.getByText("Turn Off"));

    // Optimistic update
    expect(mockUpdateDevice).toHaveBeenCalledWith("kasa-1", { on: false });
    await waitFor(() => expect(mockSendAction).toHaveBeenCalledWith("kasa-1", "toggle"));
  });

  it("reverts optimistic update when sendAction fails", async () => {
    mockSendAction.mockRejectedValue(new Error("network error"));
    mockDevices = {
      "kasa-1": { id: "kasa-1", name: "Lamp", type: "light", integration: "kasa", state: { on: true } },
    };
    render(<KasaControlPane config={{} as PaneConfig} />);
    fireEvent.click(screen.getByText("Turn Off"));

    await waitFor(() => expect(mockUpdateDevice).toHaveBeenCalledWith("kasa-1", { on: true }));
  });

  it("shows energy stats when available", () => {
    mockDevices = {
      "kasa-1": {
        id: "kasa-1",
        name: "Smart Plug",
        type: "switch",
        integration: "kasa",
        state: { on: true, voltage: 120.5, current: 0.85, power: 102.4, totalConsumption: 15.32 },
      },
    };
    render(<KasaControlPane config={{} as PaneConfig} />);
    expect(screen.getByText("120.5V")).toBeInTheDocument();
    expect(screen.getByText("0.85A")).toBeInTheDocument();
    expect(screen.getByText("102.4W")).toBeInTheDocument();
    expect(screen.getByText("15.32kWh")).toBeInTheDocument();
  });

  it("does not show energy section when no energy data", () => {
    mockDevices = {
      "kasa-1": { id: "kasa-1", name: "Lamp", type: "light", integration: "kasa", state: { on: true } },
    };
    render(<KasaControlPane config={{} as PaneConfig} />);
    expect(screen.queryByText("Energy")).not.toBeInTheDocument();
  });

  it("uses Plug badge for unknown device types", () => {
    mockDevices = {
      "kasa-1": { id: "kasa-1", name: "Mystery", type: "other", integration: "kasa", state: { on: false } },
    };
    render(<KasaControlPane config={{} as PaneConfig} />);
    expect(screen.getByText("Plug")).toBeInTheDocument();
  });
});
