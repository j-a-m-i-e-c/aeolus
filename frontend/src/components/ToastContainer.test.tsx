// frontend/src/components/ToastContainer.test.tsx — toast creation from events, dismiss, auto-expire

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const { deviceState } = vi.hoisted(() => ({ deviceState: {} as any }));

vi.mock("../store/device-store", () => ({
  useDeviceStore: (selector: (s: any) => unknown) => selector(deviceState),
}));

// Strip framer-motion-only props so jsdom doesn't warn about unknown DOM attrs,
// and render children synchronously (no enter/exit animation to wait on).
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
    ruleName: "Kitchen Motion",
    topic: "sensor/kitchen/motion",
    deviceId: "light-1",
    timestamp: 1_700_000_000_000,
    ...overrides,
  };
}

// The toast store is module-local (not exported), so reset modules per test to
// get a fresh, empty store for each case.
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

  it("shows a toast for a new automation event", async () => {
    deviceState.automationEvents = [event()];
    const ToastContainer = await loadContainer();
    render(<ToastContainer />);
    expect(screen.getByText("Kitchen Motion")).toBeInTheDocument();
    expect(screen.getByText("sensor/kitchen/motion → light-1")).toBeInTheDocument();
  });

  it("dismisses the toast when its close button is clicked", async () => {
    deviceState.automationEvents = [event()];
    const ToastContainer = await loadContainer();
    render(<ToastContainer />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByText("Kitchen Motion")).not.toBeInTheDocument();
  });

  it("auto-dismisses the toast after 4 seconds", async () => {
    deviceState.automationEvents = [event()];
    const ToastContainer = await loadContainer();
    vi.useFakeTimers();
    render(<ToastContainer />);
    expect(screen.getByText("Kitchen Motion")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.queryByText("Kitchen Motion")).not.toBeInTheDocument();
  });
});
