// frontend/src/components/CommandPalette.test.tsx — Cmd+K quick search

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("framer-motion", () => {
  const cache = new Map<string, React.FC<Record<string, unknown> & { children?: React.ReactNode }>>();
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: new Proxy({}, {
      get: (_t, key: string) => {
        if (!cache.has(key)) {
          cache.set(key, ({ children, ...rest }) => {
            const { initial: _i, animate: _a, exit: _e, transition: _tr, ...dom } = rest;
            return <div {...(dom as Record<string, unknown>)}>{children}</div>;
          });
        }
        return cache.get(key);
      },
    }),
  };
});

vi.mock("../store/device-store", () => ({
  useDeviceStore: (sel: (s: { devices: Record<string, unknown> }) => unknown) => sel({
    devices: {
      d1: { id: "d1", name: "Living Room Light", type: "light", topic: "light/living", state: {}, lastSeen: 0 },
      d2: { id: "d2", name: "Kitchen Sensor", type: "sensor", topic: "sensor/kitchen", state: {}, lastSeen: 0 },
    },
  }),
}));

vi.mock("../lib/api-client", () => ({ publishMqtt: vi.fn().mockResolvedValue({ success: true }) }));

import { CommandPalette } from "./CommandPalette";

describe("CommandPalette", () => {
  it("is hidden by default", () => {
    render(<CommandPalette onSelectDevice={() => {}} />);
    expect(screen.queryByPlaceholderText(/Search devices/)).not.toBeInTheDocument();
  });

  it("opens on Ctrl+K and shows devices", () => {
    render(<CommandPalette onSelectDevice={() => {}} />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByPlaceholderText(/Search devices/)).toBeInTheDocument();
    expect(screen.getByText("Living Room Light")).toBeInTheDocument();
    expect(screen.getByText("Kitchen Sensor")).toBeInTheDocument();
  });

  it("filters devices by search query", () => {
    render(<CommandPalette onSelectDevice={() => {}} />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.change(screen.getByPlaceholderText(/Search devices/), { target: { value: "Kitchen" } });
    expect(screen.getByText("Kitchen Sensor")).toBeInTheDocument();
    expect(screen.queryByText("Living Room Light")).not.toBeInTheDocument();
  });

  it("calls onSelectDevice when a device is clicked", () => {
    const onSelect = vi.fn();
    render(<CommandPalette onSelectDevice={onSelect} />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.click(screen.getByText("Living Room Light"));
    expect(onSelect).toHaveBeenCalledWith("d1");
  });

  it("shows a publish option when query contains a slash", () => {
    render(<CommandPalette onSelectDevice={() => {}} />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.change(screen.getByPlaceholderText(/Search devices/), { target: { value: "test/topic" } });
    expect(screen.getByText("Publish to test/topic")).toBeInTheDocument();
  });

  it("closes on Escape", () => {
    render(<CommandPalette onSelectDevice={() => {}} />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByPlaceholderText(/Search devices/)).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByPlaceholderText(/Search devices/)).not.toBeInTheDocument();
  });

  it("shows 'No results' when nothing matches", () => {
    render(<CommandPalette onSelectDevice={() => {}} />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.change(screen.getByPlaceholderText(/Search devices/), { target: { value: "zzzznotfound" } });
    expect(screen.getByText("No results")).toBeInTheDocument();
  });
});
