// frontend/src/components/DeviceGrid.test.tsx — Flat responsive grid of device cards

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const mockDevices: Record<string, unknown> = {};

vi.mock("../store/device-store", () => ({
  useDeviceStore: (sel: (s: { devices: typeof mockDevices }) => unknown) => sel({ devices: mockDevices }),
}));

vi.mock("./DeviceCard", () => ({
  DeviceCard: ({ device }: { device: { id: string; name: string } }) => (
    <div data-testid={`card-${device.id}`}>{device.name}</div>
  ),
}));

vi.mock("./WelcomeScreen", () => ({
  WelcomeScreen: () => <div data-testid="welcome-screen">Welcome</div>,
}));

import { DeviceGrid } from "./DeviceGrid";

describe("DeviceGrid", () => {
  it("shows the WelcomeScreen when there are no devices", () => {
    render(<DeviceGrid />);
    expect(screen.getByTestId("welcome-screen")).toBeInTheDocument();
  });

  it("renders a card for each device", () => {
    Object.assign(mockDevices, {
      d1: { id: "d1", name: "Light A" },
      d2: { id: "d2", name: "Sensor B" },
    });
    render(<DeviceGrid />);
    expect(screen.getByTestId("card-d1")).toBeInTheDocument();
    expect(screen.getByTestId("card-d2")).toBeInTheDocument();
  });
});
