// frontend/src/components/SystemHealth.test.tsx — Health summary render + polling

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { HealthStatus } from "../store/device-store";

const { mockState, mockFetchHealth } = vi.hoisted(() => ({
  mockState: { health: null as HealthStatus | null, setHealth: vi.fn() },
  mockFetchHealth: vi.fn(),
}));

vi.mock("../store/device-store", () => ({
  useDeviceStore: (selector: (s: typeof mockState) => unknown) => selector(mockState),
}));

vi.mock("../lib/api-client", () => ({
  fetchHealth: mockFetchHealth,
}));

import { SystemHealth } from "./SystemHealth";

function health(overrides: Partial<HealthStatus> = {}): HealthStatus {
  return {
    mqtt: "connected",
    deviceCount: 5,
    ruleCount: 3,
    uptime: 3661, // 1h 1m
    timestamp: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("SystemHealth", () => {
  beforeEach(() => {
    mockState.health = null;
    mockState.setHealth.mockReset();
    mockFetchHealth.mockReset();
    mockFetchHealth.mockResolvedValue(health());
  });

  it("renders nothing while health is unknown", () => {
    const { container } = render(<SystemHealth />);
    // Only the (empty) polling effect runs; no health card is shown.
    expect(container.querySelector("h2")).toBeNull();
  });

  it("renders device, rule, and uptime figures when health is present", () => {
    mockState.health = health();
    render(<SystemHealth />);
    expect(screen.getByText("System Health")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("1h 1m")).toBeInTheDocument();
  });

  it("formats sub-hour uptime without an hour segment", () => {
    mockState.health = health({ uptime: 120 });
    render(<SystemHealth />);
    expect(screen.getByText("2m")).toBeInTheDocument();
  });

  it("polls health on mount and stores the result", async () => {
    render(<SystemHealth />);
    await waitFor(() => expect(mockFetchHealth).toHaveBeenCalled());
    await waitFor(() => expect(mockState.setHealth).toHaveBeenCalledWith(health()));
  });

  it("swallows fetch failures without crashing", async () => {
    mockFetchHealth.mockRejectedValueOnce(new Error("network"));
    render(<SystemHealth />);
    await waitFor(() => expect(mockFetchHealth).toHaveBeenCalled());
    expect(mockState.setHealth).not.toHaveBeenCalled();
  });
});
