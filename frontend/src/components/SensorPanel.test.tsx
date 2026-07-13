// frontend/src/components/SensorPanel.test.tsx — Live sensor list rendering

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Device } from "../store/device-store";

const { mockState } = vi.hoisted(() => ({
  mockState: {
    devices: {} as Record<string, Device>,
    deviceHistory: {} as Record<string, number[]>,
  },
}));

vi.mock("../store/device-store", () => ({
  useDeviceStore: (selector: (s: typeof mockState) => unknown) => selector(mockState),
}));

import { SensorPanel } from "./SensorPanel";

function sensor(overrides: Partial<Device> = {}): Device {
  return {
    id: "s1",
    name: "Living Room Temp",
    type: "sensor",
    capabilities: [],
    state: { temperature: 21.5 },
    integration: "mqtt",
    lastSeen: 1_700_000_000_000,
    ...overrides,
  };
}

describe("SensorPanel", () => {
  beforeEach(() => {
    mockState.devices = {};
    mockState.deviceHistory = {};
  });

  it("renders nothing when there are no sensor devices", () => {
    mockState.devices = {
      l1: { ...sensor({ id: "l1", type: "light", name: "Lamp" }) },
    };
    const { container } = render(<SensorPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders sensor name and state values", () => {
    mockState.devices = { s1: sensor() };
    mockState.deviceHistory = { s1: [1, 2, 3] };
    render(<SensorPanel />);
    expect(screen.getByText("Live Sensors")).toBeInTheDocument();
    expect(screen.getByText("Living Room Temp")).toBeInTheDocument();
    expect(screen.getByText("21.5")).toBeInTheDocument();
  });

  it("lists multiple sensors and ignores non-sensor devices", () => {
    mockState.devices = {
      s1: sensor({ id: "s1", name: "Temp A", state: { v: 10 } }),
      s2: sensor({ id: "s2", name: "Temp B", state: { v: 20 } }),
      l1: sensor({ id: "l1", name: "Lamp", type: "light" }),
    };
    render(<SensorPanel />);
    expect(screen.getByText("Temp A")).toBeInTheDocument();
    expect(screen.getByText("Temp B")).toBeInTheDocument();
    expect(screen.queryByText("Lamp")).not.toBeInTheDocument();
  });
});
