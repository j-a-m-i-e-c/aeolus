// frontend/src/components/DeviceDetail.test.tsx — Expanded device detail view

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("framer-motion", () => {
  const cache = new Map<string, React.FC<Record<string, unknown> & { children?: React.ReactNode }>>();
  return {
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

const mockDevice = {
  id: "d1",
  name: "Bedroom Light",
  type: "light",
  integration: "hue",
  state: { on: true, brightness: 200 },
  capabilities: ["toggle", "brightness"],
  lastSeen: 1_700_000_000_000,
};

vi.mock("../store/device-store", () => ({
  useDeviceStore: (sel: (s: { devices: Record<string, unknown> }) => unknown) => sel({
    devices: { d1: mockDevice },
  }),
}));

const mockSendAction = vi.fn().mockResolvedValue({ success: true });
vi.mock("../lib/api-client", () => ({ sendAction: (...args: unknown[]) => mockSendAction(...args) }));

import { DeviceDetail } from "./DeviceDetail";

describe("DeviceDetail", () => {
  it("renders device name, type, state, and capabilities", () => {
    render(<DeviceDetail deviceId="d1" onClose={() => {}} />);
    expect(screen.getByText("Bedroom Light")).toBeInTheDocument();
    expect(screen.getByText(/hue/)).toBeInTheDocument();
    // "brightness" appears both as a state key and a capability
    expect(screen.getAllByText("brightness").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("200")).toBeInTheDocument();
    expect(screen.getByText("toggle")).toBeInTheDocument();
  });

  it("calls sendAction on toggle", () => {
    render(<DeviceDetail deviceId="d1" onClose={() => {}} />);
    fireEvent.click(screen.getByText("Turn Off"));
    expect(mockSendAction).toHaveBeenCalledWith("d1", "toggle");
  });

  it("calls onClose when X is clicked", () => {
    const onClose = vi.fn();
    render(<DeviceDetail deviceId="d1" onClose={onClose} />);
    // The X button in the header
    const buttons = screen.getAllByRole("button");
    const closeBtn = buttons.find((b) => b.querySelector("svg"));
    if (closeBtn) fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it("renders nothing when device is not found", () => {
    const { container } = render(<DeviceDetail deviceId="unknown" onClose={() => {}} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows a brightness slider for lights with brightness capability", () => {
    render(<DeviceDetail deviceId="d1" onClose={() => {}} />);
    expect(screen.getByText("Brightness")).toBeInTheDocument();
    expect(screen.getByRole("slider")).toBeInTheDocument();
  });
});
