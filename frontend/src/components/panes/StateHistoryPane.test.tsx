// frontend/src/components/panes/StateHistoryPane.test.tsx — device selector, history load, clear actions

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { PaneConfig } from "../../types/dashboard";

const {
  deviceState,
  mockFetchHistory,
  mockClearDevice,
  mockClearAll,
} = vi.hoisted(() => ({
  deviceState: {} as any,
  mockFetchHistory: vi.fn(),
  mockClearDevice: vi.fn(),
  mockClearAll: vi.fn(),
}));

vi.mock("../../store/device-store", () => ({
  useDeviceStore: (selector: (s: any) => unknown) => selector(deviceState),
}));

vi.mock("../../lib/api-client", () => ({
  fetchDeviceHistory: mockFetchHistory,
  clearDeviceHistory: mockClearDevice,
  clearAllDeviceHistory: mockClearAll,
}));

vi.mock("../StateHistoryChart", () => ({
  StateHistoryChart: ({ data }: { data: unknown[] }) => (
    <div data-testid="history-chart">points:{data.length}</div>
  ),
}));

import { StateHistoryPane } from "./StateHistoryPane";

function device(overrides: Record<string, unknown> = {}) {
  return {
    id: "d1",
    name: "Thermostat",
    type: "climate",
    integration: "mqtt",
    capabilities: [],
    lastSeen: 0,
    state: {},
    ...overrides,
  };
}

function renderPane(config: PaneConfig = {}) {
  render(<StateHistoryPane config={config} />);
}

describe("StateHistoryPane", () => {
  beforeEach(() => {
    Object.assign(deviceState, { devices: {} });
    mockFetchHistory.mockReset().mockResolvedValue([]);
    mockClearDevice.mockReset().mockResolvedValue({ success: true, deleted: 1 });
    mockClearAll.mockReset().mockResolvedValue({ success: true, deleted: 1 });
    window.confirm = vi.fn(() => true);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("prompts to select a device when none is available", () => {
    renderPane();
    expect(screen.getByText("Select a device to view history")).toBeInTheDocument();
  });

  it("lists devices in the selector", async () => {
    deviceState.devices = { d1: device({ id: "d1", name: "Thermostat" }) };
    renderPane();
    expect(screen.getByRole("option", { name: "Thermostat" })).toBeInTheDocument();
    // The auto-select effect kicks off a history load; let it settle.
    await waitFor(() => expect(mockFetchHistory).toHaveBeenCalled());
  });

  it("auto-selects the first device and loads its history", async () => {
    deviceState.devices = { d1: device({ id: "d1", name: "Thermostat" }) };
    mockFetchHistory.mockResolvedValue([
      { deviceId: "d1", state: { temp: 20 }, timestamp: 1 },
    ]);
    renderPane();
    await waitFor(() => expect(mockFetchHistory).toHaveBeenCalledWith("d1", 60));
    expect(await screen.findByTestId("history-chart")).toHaveTextContent("points:1");
  });

  it("uses the configured time range to choose the fetch limit", async () => {
    deviceState.devices = { d1: device({ id: "d1" }) };
    renderPane({ deviceId: "d1", timeRange: "24h" } as PaneConfig);
    await waitFor(() => expect(mockFetchHistory).toHaveBeenCalledWith("d1", 200));
  });

  it("refetches with a new limit when the time range button changes", async () => {
    deviceState.devices = { d1: device({ id: "d1" }) };
    renderPane({ deviceId: "d1" } as PaneConfig);
    await waitFor(() => expect(mockFetchHistory).toHaveBeenCalledWith("d1", 60));
    fireEvent.click(screen.getByText("15m"));
    await waitFor(() => expect(mockFetchHistory).toHaveBeenCalledWith("d1", 30));
  });

  it("shows an error message when history loading fails", async () => {
    deviceState.devices = { d1: device({ id: "d1" }) };
    mockFetchHistory.mockRejectedValueOnce(new Error("fetch failed"));
    renderPane({ deviceId: "d1" } as PaneConfig);
    expect(await screen.findByText("fetch failed")).toBeInTheDocument();
  });

  it("clears the selected device's history after confirmation", async () => {
    deviceState.devices = { d1: device({ id: "d1", name: "Thermostat" }) };
    mockFetchHistory.mockResolvedValue([
      { deviceId: "d1", state: { temp: 20 }, timestamp: 1 },
    ]);
    renderPane({ deviceId: "d1" } as PaneConfig);
    const clearBtn = await screen.findByTitle(/Clear history for/i);
    fireEvent.click(clearBtn);
    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(mockClearDevice).toHaveBeenCalledWith("d1"));
  });

  it("clears all history after confirmation", async () => {
    deviceState.devices = { d1: device({ id: "d1" }) };
    renderPane({ deviceId: "d1" } as PaneConfig);
    fireEvent.click(screen.getByText("Clear All"));
    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(mockClearAll).toHaveBeenCalled());
  });
});
