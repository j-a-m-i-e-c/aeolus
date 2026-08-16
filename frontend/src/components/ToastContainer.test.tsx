// frontend/src/components/ToastContainer.test.tsx — operator-action toast policy

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const { deviceState } = vi.hoisted(() => ({ deviceState: {} as any }));

vi.mock("../store/device-store", () => ({
  useDeviceStore: (selector: (s: any) => unknown) => selector(deviceState),
}));

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  motion: new Proxy(
    {},
    {
      get: () =>
        function MotionEl({
          children,
          initial: _i,
          animate: _a,
          exit: _e,
          transition: _t,
          ...rest
        }: any) {
          return <div {...rest}>{children}</div>;
        },
    },
  ),
}));

function event(overrides: Record<string, unknown> = {}) {
  return {
    ruleId: "r1",
    ruleName: "Water Management",
    topic: "ui/r1/transfer-500",
    deviceId: "ui-r1",
    timestamp: 1_700_000_000_000,
    ...overrides,
  };
}

async function loadContainer() {
  vi.resetModules();
  const mod = await import("./ToastContainer");
  return mod.ToastContainer;
}

describe("ToastContainer", () => {
  beforeEach(() => {
    Object.assign(deviceState, { automationEvents: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when there are no automation events", async () => {
    const ToastContainer = await loadContainer();
    const { container } = render(<ToastContainer />);
    expect(container.querySelectorAll("button").length).toBe(0);
  });

  it("shows one brief toast for a direct UI action", async () => {
    deviceState.automationEvents = [event()];
    const ToastContainer = await loadContainer();
    render(<ToastContainer />);
    expect(screen.getByText("Water Management")).toBeInTheDocument();
    expect(screen.getByText("transfer 500")).toBeInTheDocument();
  });

  it("does not toast telemetry-driven automation executions", async () => {
    deviceState.automationEvents = [event({ topic: "sensor/farm/header-tank", deviceId: "header-tank" })];
    const ToastContainer = await loadContainer();
    render(<ToastContainer />);
    expect(screen.queryByText("Water Management")).not.toBeInTheDocument();
  });

  it("does not toast automation-event fan-out executions", async () => {
    deviceState.automationEvents = [event({ topic: "aeolus/events/source/vessel/summary/ctd", deviceId: "automation-event" })];
    const ToastContainer = await loadContainer();
    render(<ToastContainer />);
    expect(screen.queryByText("Water Management")).not.toBeInTheDocument();
  });

  it("dismisses the toast when its close button is clicked", async () => {
    deviceState.automationEvents = [event()];
    const ToastContainer = await loadContainer();
    render(<ToastContainer />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByText("Water Management")).not.toBeInTheDocument();
  });

  it("auto-dismisses operator feedback after 2.5 seconds", async () => {
    deviceState.automationEvents = [event()];
    const ToastContainer = await loadContainer();
    vi.useFakeTimers();
    render(<ToastContainer />);
    expect(screen.getByText("Water Management")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(screen.queryByText("Water Management")).not.toBeInTheDocument();
  });
});
