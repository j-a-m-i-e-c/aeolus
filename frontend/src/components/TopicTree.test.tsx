// frontend/src/components/TopicTree.test.tsx — MQTT topic tree rendering + toggling

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { MqttMessage } from "../store/device-store";

const { mockState } = vi.hoisted(() => ({
  mockState: { mqttMessages: [] as MqttMessage[] },
}));

vi.mock("../store/device-store", () => ({
  useDeviceStore: (selector: (s: typeof mockState) => unknown) => selector(mockState),
}));

import { TopicTree } from "./TopicTree";

describe("TopicTree", () => {
  beforeEach(() => {
    mockState.mqttMessages = [];
  });

  it("shows an empty-state message when there are no topics", () => {
    render(<TopicTree />);
    expect(screen.getByText("No topics seen yet")).toBeInTheDocument();
  });

  it("builds a nested tree from message topics", () => {
    mockState.mqttMessages = [
      { topic: "sensor/kitchen/temp", payload: "21.4", timestamp: 1 },
      { topic: "sensor/kitchen/humidity", payload: "55", timestamp: 2 },
    ];
    render(<TopicTree />);
    expect(screen.getByText("sensor")).toBeInTheDocument();
    expect(screen.getByText("kitchen")).toBeInTheDocument();
    expect(screen.getByText("temp")).toBeInTheDocument();
    expect(screen.getByText("humidity")).toBeInTheDocument();
    // Leaf payload is rendered
    expect(screen.getByText("21.4")).toBeInTheDocument();
  });

  it("collapses the tree body when the header is toggled", () => {
    mockState.mqttMessages = [
      { topic: "sensor/temp", payload: "20", timestamp: 1 },
    ];
    render(<TopicTree />);
    expect(screen.getByText("sensor")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Topic Tree/i }));
    expect(screen.queryByText("sensor")).not.toBeInTheDocument();
  });
});
