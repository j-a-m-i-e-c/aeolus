// frontend/src/components/DeviceCard.test.tsx — Individual device card

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("framer-motion", () => {
  const cache = new Map<string, React.FC<Record<string, unknown> & { children?: React.ReactNode }>>();
  return {
    motion: new Proxy({}, {
      get: (_t, key: string) => {
        if (!cache.has(key)) {
          cache.set(key, ({ children, ...rest }) => {
            const { whileHover: _wh, transition: _tr, ...dom } = rest;
            return <div {...(dom as Record<string, unknown>)}>{children}</div>;
          });
        }
        return cache.get(key);
      },
    }),
  };
});

const mockSendAction = vi.fn();
vi.mock("../lib/api-client", () => ({ sendAction: (...args: unknown[]) => mockSendAction(...args) }));

import { DeviceCard } from "./DeviceCard";
import type { Device } from "../store/device-store";

function makeDevice(overrides: Partial<Device> = {}): Device {
  return {
    id: "d1",
    name: "Living Room Light",
    type: "light",
    topic: "light/living",
    state: { on: true, brightness: 80 },
    lastSeen: Date.now(),
    ...overrides,
  } as Device;
}

describe("DeviceCard", () => {
  it("renders device name, type, and primary value", () => {
    render(<DeviceCard device={makeDevice()} />);
    expect(screen.getByText("Living Room Light")).toBeInTheDocument();
    expect(screen.getByText("light")).toBeInTheDocument();
    expect(screen.getByText("80")).toBeInTheDocument();
  });

  it("shows toggle button for light/switch types", () => {
    render(<DeviceCard device={makeDevice({ type: "light", state: { on: true } })} />);
    expect(screen.getByText("Turn Off")).toBeInTheDocument();
  });

  it("does not show toggle for sensor types", () => {
    render(<DeviceCard device={makeDevice({ type: "sensor", state: { value: 22 } })} />);
    expect(screen.queryByText("Turn Off")).not.toBeInTheDocument();
    expect(screen.queryByText("Turn On")).not.toBeInTheDocument();
  });

  it("calls sendAction on toggle click", () => {
    mockSendAction.mockResolvedValue({ success: true });
    render(<DeviceCard device={makeDevice()} />);
    fireEvent.click(screen.getByText("Turn Off"));
    expect(mockSendAction).toHaveBeenCalledWith("d1", "toggle");
  });

  it("calls onClick when the card is clicked", () => {
    const onClick = vi.fn();
    render(<DeviceCard device={makeDevice()} onClick={onClick} />);
    fireEvent.click(screen.getByText("Living Room Light"));
    expect(onClick).toHaveBeenCalled();
  });

  it("shows 'Turn On' when device is off", () => {
    render(<DeviceCard device={makeDevice({ state: { on: false } })} />);
    expect(screen.getByText("Turn On")).toBeInTheDocument();
  });
});
