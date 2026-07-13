// frontend/src/components/EventLog.test.tsx — Automation event log

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const mockEvents = [
  { timestamp: 1_000_000, ruleName: "Rule A", topic: "sensor/temp", deviceId: "d1" },
];
const mockClearEvents = vi.fn();

vi.mock("../store/device-store", () => ({
  useDeviceStore: (sel: (s: { automationEvents: typeof mockEvents; clearAutomationEvents: typeof mockClearEvents }) => unknown) =>
    sel({ automationEvents: mockEvents, clearAutomationEvents: mockClearEvents }),
}));

import { EventLog } from "./EventLog";

describe("EventLog", () => {
  it("renders events with rule name, topic, and device", () => {
    render(<EventLog />);
    expect(screen.getByText("Rule A")).toBeInTheDocument();
    expect(screen.getByText("sensor/temp")).toBeInTheDocument();
    expect(screen.getByText("d1")).toBeInTheDocument();
  });

  it("shows event count badge", () => {
    render(<EventLog />);
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("collapses and expands the log", () => {
    render(<EventLog />);
    // Initially expanded - events visible
    expect(screen.getByText("Rule A")).toBeInTheDocument();
    // Click to collapse
    fireEvent.click(screen.getByText("Event Log"));
    expect(screen.queryByText("Rule A")).not.toBeInTheDocument();
    // Click to expand again
    fireEvent.click(screen.getByText("Event Log"));
    expect(screen.getByText("Rule A")).toBeInTheDocument();
  });

  it("calls clearEvents when trash button is clicked", () => {
    render(<EventLog />);
    fireEvent.click(screen.getByTitle("Clear events"));
    expect(mockClearEvents).toHaveBeenCalled();
  });
});
