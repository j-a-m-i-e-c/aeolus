// frontend/src/components/CommandPalette.test.tsx — Unit tests for command palette

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../store/device-store", () => ({
  useDeviceStore: (selector: (s: { devices: Record<string, unknown> }) => unknown) =>
    selector({
      devices: {
        "light-1": { id: "light-1", name: "Bedroom Light", type: "light", integration: "hue", state: {} },
        "sensor-2": { id: "sensor-2", name: "Kitchen Temp", type: "sensor", integration: "mqtt", state: {} },
      },
    }),
}));

const mockPublishMqtt = vi.fn();
vi.mock("../lib/api-client", () => ({
  publishMqtt: (...args: unknown[]) => mockPublishMqtt(...args),
}));

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: Record<string, unknown>) => {
      const { initial: _i, animate: _a, exit: _e, transition: _t, ...rest } = props;
      return <div {...rest}>{children as React.ReactNode}</div>;
    },
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { CommandPalette } from "./CommandPalette";

describe("CommandPalette", () => {
  const onSelectDevice = vi.fn();

  beforeEach(() => {
    onSelectDevice.mockReset();
    mockPublishMqtt.mockReset();
    mockPublishMqtt.mockResolvedValue({ success: true });
  });

  function openPalette() {
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  }

  it("is not visible by default", () => {
    render(<CommandPalette onSelectDevice={onSelectDevice} />);
    expect(screen.queryByPlaceholderText(/search devices/i)).not.toBeInTheDocument();
  });

  it("opens with Ctrl+K and shows the search input", () => {
    render(<CommandPalette onSelectDevice={onSelectDevice} />);
    openPalette();
    expect(screen.getByPlaceholderText(/search devices/i)).toBeInTheDocument();
  });

  it("closes with Escape", () => {
    render(<CommandPalette onSelectDevice={onSelectDevice} />);
    openPalette();
    expect(screen.getByPlaceholderText(/search devices/i)).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByPlaceholderText(/search devices/i)).not.toBeInTheDocument();
  });

  it("shows all devices when query is empty", () => {
    render(<CommandPalette onSelectDevice={onSelectDevice} />);
    openPalette();
    expect(screen.getByText("Bedroom Light")).toBeInTheDocument();
    expect(screen.getByText("Kitchen Temp")).toBeInTheDocument();
  });

  it("filters devices by name", () => {
    render(<CommandPalette onSelectDevice={onSelectDevice} />);
    openPalette();
    fireEvent.change(screen.getByPlaceholderText(/search devices/i), { target: { value: "bedroom" } });
    expect(screen.getByText("Bedroom Light")).toBeInTheDocument();
    expect(screen.queryByText("Kitchen Temp")).not.toBeInTheDocument();
  });

  it("shows no results message when nothing matches", () => {
    render(<CommandPalette onSelectDevice={onSelectDevice} />);
    openPalette();
    fireEvent.change(screen.getByPlaceholderText(/search devices/i), { target: { value: "zzznomatch" } });
    expect(screen.getByText("No results")).toBeInTheDocument();
  });

  it("shows a publish option when query contains a slash", () => {
    render(<CommandPalette onSelectDevice={onSelectDevice} />);
    openPalette();
    fireEvent.change(screen.getByPlaceholderText(/search devices/i), { target: { value: "home/lights" } });
    expect(screen.getByText("Publish to home/lights")).toBeInTheDocument();
  });

  it("calls onSelectDevice and closes when a device is clicked", () => {
    render(<CommandPalette onSelectDevice={onSelectDevice} />);
    openPalette();
    fireEvent.click(screen.getByText("Bedroom Light"));
    expect(onSelectDevice).toHaveBeenCalledWith("light-1");
    expect(screen.queryByPlaceholderText(/search devices/i)).not.toBeInTheDocument();
  });

  it("selects device with Enter key", () => {
    render(<CommandPalette onSelectDevice={onSelectDevice} />);
    openPalette();
    const input = screen.getByPlaceholderText(/search devices/i);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelectDevice).toHaveBeenCalledWith("light-1");
  });

  it("navigates with arrow keys", () => {
    render(<CommandPalette onSelectDevice={onSelectDevice} />);
    openPalette();
    const input = screen.getByPlaceholderText(/search devices/i);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelectDevice).toHaveBeenCalledWith("sensor-2");
  });

  it("publishes MQTT message when publish option is selected", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("test-payload");
    render(<CommandPalette onSelectDevice={onSelectDevice} />);
    openPalette();
    fireEvent.change(screen.getByPlaceholderText(/search devices/i), { target: { value: "home/test" } });
    fireEvent.click(screen.getByText("Publish to home/test"));
    await waitFor(() => expect(mockPublishMqtt).toHaveBeenCalledWith("home/test", "test-payload"));
    vi.restoreAllMocks();
  });

  it("does not publish when prompt is cancelled", async () => {
    vi.spyOn(window, "prompt").mockReturnValue(null);
    render(<CommandPalette onSelectDevice={onSelectDevice} />);
    openPalette();
    fireEvent.change(screen.getByPlaceholderText(/search devices/i), { target: { value: "home/test" } });
    fireEvent.click(screen.getByText("Publish to home/test"));
    expect(mockPublishMqtt).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
