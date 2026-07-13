// frontend/src/components/panes/HueControlPane.test.tsx — Hue light cards, toggle, color, rename, delete

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { PaneConfig } from "../../types/dashboard";

const { deviceState, useDeviceStoreMock, mockSendAction, mockFetchConnectors } = vi.hoisted(
  () => {
    const state: any = {};
    const store = Object.assign((selector: (s: any) => unknown) => selector(state), {
      getState: () => state,
    });
    return {
      deviceState: state,
      useDeviceStoreMock: store,
      mockSendAction: vi.fn(),
      mockFetchConnectors: vi.fn(),
    };
  },
);

vi.mock("../../store/device-store", () => ({
  useDeviceStore: useDeviceStoreMock,
}));

vi.mock("../../lib/api-client", () => ({
  sendAction: mockSendAction,
  fetchEnabledConnectors: mockFetchConnectors,
}));

// Isolate the pane from its Hue sub-widgets.
vi.mock("./hue/ColorTempSlider", () => ({
  ColorTempSlider: () => <div data-testid="color-temp-slider" />,
}));
vi.mock("./hue/SearchLightsButton", () => ({
  SearchLightsButton: () => <div data-testid="search-lights" />,
}));
vi.mock("./hue/FirmwareUpdateBanner", () => ({
  FirmwareUpdateBanner: () => <div data-testid="firmware-banner" />,
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

import { HueControlPane } from "./HueControlPane";

function hueLight(overrides: Record<string, unknown> = {}) {
  return {
    id: "hue-1",
    name: "Lamp",
    type: "light",
    integration: "hue",
    capabilities: ["brightness"],
    lastSeen: 0,
    state: { on: false, brightness: 200 },
    ...overrides,
  };
}

function renderPane() {
  render(<HueControlPane config={{} as PaneConfig} />);
}

describe("HueControlPane", () => {
  beforeEach(() => {
    Object.assign(deviceState, {
      devices: {},
      updateDevice: vi.fn(),
      removeDevice: vi.fn(),
      setDevices: vi.fn(),
    });
    mockSendAction.mockReset();
    mockFetchConnectors.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows an empty state when there are no Hue lights", () => {
    renderPane();
    expect(screen.getByText("No Hue lights found.")).toBeInTheDocument();
  });

  it("renders a light card with name and a brightness slider", () => {
    deviceState.devices = { "hue-1": hueLight({ name: "Lamp" }) };
    renderPane();
    expect(screen.getByText("Lamp")).toBeInTheDocument();
    expect(screen.getByText("Turn On")).toBeInTheDocument();
    expect(screen.getByRole("slider")).toBeInTheDocument();
  });

  it("toggles a light and calls sendAction", async () => {
    mockSendAction.mockResolvedValueOnce({ success: true });
    deviceState.devices = { "hue-1": hueLight({ state: { on: false } }) };
    renderPane();
    fireEvent.click(screen.getByText("Turn On"));
    expect(deviceState.updateDevice).toHaveBeenCalledWith("hue-1", { on: true });
    await waitFor(() => expect(mockSendAction).toHaveBeenCalledWith("hue-1", "toggle"));
  });

  it("shows a Color badge and opens the swatch picker for color lights", async () => {
    mockSendAction.mockResolvedValue({ success: true });
    deviceState.devices = {
      "hue-1": hueLight({ capabilities: ["brightness", "color"], state: { on: true } }),
    };
    renderPane();
    expect(screen.getByText("Color")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Colour"));
    const red = screen.getByTitle("Red");
    fireEvent.click(red);
    expect(deviceState.updateDevice).toHaveBeenCalledWith("hue-1", { hue: 0, saturation: 254 });
    await waitFor(() =>
      expect(mockSendAction).toHaveBeenCalledWith("hue-1", "color", { hue: 0, saturation: 254 }),
    );
  });

  it("renames a light via the rename control", async () => {
    mockSendAction.mockResolvedValueOnce({ success: true });
    deviceState.devices = { "hue-1": hueLight({ name: "Lamp" }) };
    renderPane();
    fireEvent.click(screen.getByTitle("Rename"));
    const input = screen.getByDisplayValue("Lamp");
    fireEvent.change(input, { target: { value: "Reading Light" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(mockSendAction).toHaveBeenCalledWith("hue-1", "rename", { name: "Reading Light" }),
    );
    expect(deviceState.setDevices).toHaveBeenCalled();
  });

  it("removes a light after confirming deletion", async () => {
    mockSendAction.mockResolvedValueOnce({ success: true });
    deviceState.devices = { "hue-1": hueLight({ name: "Lamp" }) };
    renderPane();
    fireEvent.click(screen.getByTitle("Remove from bridge"));
    const confirm = screen.getByText("Remove");
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(mockSendAction).toHaveBeenCalledWith("hue-1", "delete", {}),
    );
    expect(deviceState.removeDevice).toHaveBeenCalledWith("hue-1");
  });

  it("renders the color temperature slider for tunable lights", () => {
    deviceState.devices = {
      "hue-1": hueLight({ capabilities: ["brightness", "color-temperature"] }),
    };
    renderPane();
    expect(screen.getByTestId("color-temp-slider")).toBeInTheDocument();
  });

  it("marks unreachable lights as offline", () => {
    deviceState.devices = {
      "hue-1": hueLight({ state: { on: false, reachable: false } }),
    };
    renderPane();
    expect(screen.getByText("offline")).toBeInTheDocument();
  });
});
