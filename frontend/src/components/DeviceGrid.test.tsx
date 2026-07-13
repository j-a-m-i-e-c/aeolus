// frontend/src/components/DeviceGrid.test.tsx — Flat responsive grid of device cards

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const mockDevices: Record<string, unknown> = {};

vi.mock("../store/device-store", () => ({
  useDeviceStore: (sel: (s: { devices: typeof mockDevices }) => unknown) => sel({ devices: mockDevices }),
}));

vi.mock("./DeviceCard", () => ({
  DeviceCard: ({ device, onClick }: { device: { id: string; name: string }; onClick?: () => void }) => (
    <div data-testid={`card-${device.id}`} onClick={onClick}>{device.name}</div>
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

  it("calls onSelectDevice when a card is clicked", async () => {
    Object.assign(mockDevices, {
      d1: { id: "d1", name: "Light A" },
    });
    const onSelect = vi.fn();
    render(<DeviceGrid onSelectDevice={onSelect} />);
    screen.getByTestId("card-d1").click();
    expect(onSelect).toHaveBeenCalledWith("d1");
  });
});
