// frontend/src/components/PanePicker.test.tsx — Modal overlay listing pane types

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const mockAddPane = vi.fn();

vi.mock("../store/dashboard-store", () => ({
  useDashboardStore: (sel: (s: { addPane: typeof mockAddPane }) => unknown) => sel({ addPane: mockAddPane }),
}));

vi.mock("../lib/pane-registry", () => ({
  PANE_REGISTRY: {
    "device-grid": { displayName: "Device Grid", defaultIcon: "grid", category: "controls", component: () => null },
    "topic-tree": { displayName: "Topic Tree", defaultIcon: "list-tree", category: "monitoring", component: () => null },
    automation: { displayName: "Automation", defaultIcon: "zap", category: "automations", component: () => null },
  },
}));

import { PanePicker } from "./PanePicker";

describe("PanePicker", () => {
  it("renders available pane types (excluding 'automation')", () => {
    render(<PanePicker tabId="tab-1" onClose={() => {}} />);
    expect(screen.getByText("Device Grid")).toBeInTheDocument();
    expect(screen.getByText("Topic Tree")).toBeInTheDocument();
    // "automation" is excluded from the picker
    expect(screen.queryByText("Automation")).not.toBeInTheDocument();
  });

  it("calls addPane and onClose when a pane type is selected", () => {
    const onClose = vi.fn();
    render(<PanePicker tabId="tab-1" onClose={onClose} />);
    fireEvent.click(screen.getByText("Device Grid"));
    expect(mockAddPane).toHaveBeenCalledWith("tab-1", "device-grid");
    expect(onClose).toHaveBeenCalled();
  });

  it("closes when the X button is clicked", () => {
    const onClose = vi.fn();
    render(<PanePicker tabId="tab-1" onClose={onClose} />);
    // The close button is inside the header
    fireEvent.click(screen.getByRole("button", { name: "" })); // X icon button
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on Escape key", () => {
    const onClose = vi.fn();
    render(<PanePicker tabId="tab-1" onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
