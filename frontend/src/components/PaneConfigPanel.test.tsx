// frontend/src/components/PaneConfigPanel.test.tsx — pane config slide-out: fields, save, close

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { PaneConfig } from "../types/dashboard";

const { dashboardState } = vi.hoisted(() => ({ dashboardState: {} as any }));

vi.mock("../store/dashboard-store", () => ({
  useDashboardStore: (selector: (s: any) => unknown) => selector(dashboardState),
}));

vi.mock("../lib/pane-registry", () => ({
  getPaneEntry: (type: string) =>
    ({ displayName: `Display ${type}` }),
}));

import { PaneConfigPanel } from "./PaneConfigPanel";

function renderPanel(paneType: string, config: PaneConfig = {}, onClose = vi.fn()) {
  render(
    <PaneConfigPanel paneId="p1" paneType={paneType} config={config} onClose={onClose} />,
  );
  return onClose;
}

describe("PaneConfigPanel", () => {
  beforeEach(() => {
    Object.assign(dashboardState, { updatePaneConfig: vi.fn() });
  });

  it("shows the pane display name in the header", () => {
    renderPanel("device-grid");
    expect(screen.getByText("Configure: Display device-grid")).toBeInTheDocument();
  });

  it("shows a no-config message for pane types without fields", () => {
    renderPanel("topic-tree");
    expect(
      screen.getByText("No configuration options for this pane type."),
    ).toBeInTheDocument();
  });

  it("renders device-grid room + device type fields seeded from config", () => {
    renderPanel("device-grid", { room: "kitchen", deviceType: "light" });
    expect(screen.getByDisplayValue("kitchen")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Light")).toBeInTheDocument();
  });

  it("saves device-grid config with room and device type, then closes", () => {
    const onClose = renderPanel("device-grid");
    fireEvent.change(screen.getByPlaceholderText("e.g. kitchen, living-room"), {
      target: { value: "garage" },
    });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "sensor" } });
    fireEvent.click(screen.getByRole("button", { name: /Save/i }));
    expect(dashboardState.updatePaneConfig).toHaveBeenCalledWith("p1", {
      room: "garage",
      deviceType: "sensor",
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("omits deviceType when 'all' is selected for device-grid", () => {
    renderPanel("device-grid", { room: "den" });
    fireEvent.click(screen.getByRole("button", { name: /Save/i }));
    expect(dashboardState.updatePaneConfig).toHaveBeenCalledWith("p1", { room: "den" });
  });

  it("saves mqtt-inspector topic pattern", () => {
    renderPanel("mqtt-inspector");
    fireEvent.change(screen.getByPlaceholderText("e.g. sensor/+/temperature"), {
      target: { value: "sensor/+/temp" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save/i }));
    expect(dashboardState.updatePaneConfig).toHaveBeenCalledWith("p1", {
      topicPattern: "sensor/+/temp",
    });
  });

  it("saves system-stats section selection when a subset is chosen", () => {
    renderPanel("system-stats");
    // Uncheck two sections so the selection is a proper subset.
    fireEvent.click(screen.getByLabelText("Cpu"));
    fireEvent.click(screen.getByLabelText("Disk"));
    fireEvent.click(screen.getByRole("button", { name: /Save/i }));
    const [, savedConfig] = dashboardState.updatePaneConfig.mock.calls[0];
    expect(savedConfig.showSections).toEqual(
      expect.arrayContaining(["host", "temperature", "memory", "network"]),
    );
    expect(savedConfig.showSections).not.toContain("cpu");
    expect(savedConfig.showSections).not.toContain("disk");
  });

  it("closes on a mousedown outside the panel", () => {
    const onClose = renderPanel("device-grid");
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalled();
  });

  it("closes when Escape is pressed", () => {
    const onClose = renderPanel("device-grid");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("closes when Cancel is clicked", () => {
    const onClose = renderPanel("device-grid");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });
});
