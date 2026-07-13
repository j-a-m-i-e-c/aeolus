// frontend/src/components/MqttInspector.test.tsx — live feed rendering, filter, publish, clear

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { deviceState, mockPublishMqtt } = vi.hoisted(() => ({
  deviceState: {} as any,
  mockPublishMqtt: vi.fn(),
}));

vi.mock("../store/device-store", () => ({
  useDeviceStore: (selector: (s: any) => unknown) => selector(deviceState),
}));

vi.mock("../lib/api-client", () => ({
  publishMqtt: mockPublishMqtt,
}));

import { MqttInspector } from "./MqttInspector";

function msg(overrides: Record<string, unknown> = {}) {
  return { topic: "sensor/kitchen/temp", payload: "22.5", timestamp: 1_700_000_000_000, ...overrides };
}

describe("MqttInspector", () => {
  beforeEach(() => {
    Object.assign(deviceState, {
      mqttMessages: [],
      clearMqttMessages: vi.fn(),
    });
    mockPublishMqtt.mockReset();
  });

  it("shows the waiting placeholder when there are no messages", () => {
    render(<MqttInspector />);
    expect(screen.getByText("Waiting for MQTT messages...")).toBeInTheDocument();
  });

  it("renders a row per message with topic and payload, plus the count badge", () => {
    deviceState.mqttMessages = [
      msg({ topic: "sensor/kitchen/temp", payload: "22.5" }),
      msg({ topic: "sensor/hall/humidity", payload: "40", timestamp: 1_700_000_001_000 }),
    ];
    render(<MqttInspector />);
    expect(screen.getByText("sensor/kitchen/temp")).toBeInTheDocument();
    expect(screen.getByText("sensor/hall/humidity")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("filters messages by topic substring", () => {
    deviceState.mqttMessages = [
      msg({ topic: "sensor/kitchen/temp" }),
      msg({ topic: "light/hall/state", payload: "on", timestamp: 1_700_000_001_000 }),
    ];
    render(<MqttInspector />);
    fireEvent.change(screen.getByPlaceholderText("Filter topics..."), {
      target: { value: "light" },
    });
    expect(screen.getByText("light/hall/state")).toBeInTheDocument();
    expect(screen.queryByText("sensor/kitchen/temp")).not.toBeInTheDocument();
  });

  it("shows a no-match message when the filter excludes everything", () => {
    deviceState.mqttMessages = [msg({ topic: "sensor/kitchen/temp" })];
    render(<MqttInspector />);
    fireEvent.change(screen.getByPlaceholderText("Filter topics..."), {
      target: { value: "zzz" },
    });
    expect(screen.getByText("No messages match filter")).toBeInTheDocument();
  });

  it("clears messages via the clear button", () => {
    render(<MqttInspector />);
    fireEvent.click(screen.getByTitle("Clear messages"));
    expect(deviceState.clearMqttMessages).toHaveBeenCalled();
  });

  it("publishes topic + payload and clears the payload on success", async () => {
    mockPublishMqtt.mockResolvedValueOnce({ success: true });
    render(<MqttInspector />);
    const payload = screen.getByPlaceholderText("Payload (e.g. 22.5)");
    fireEvent.change(screen.getByPlaceholderText("Topic (e.g. sensor/kitchen/temp)"), {
      target: { value: "cmd/light" },
    });
    fireEvent.change(payload, { target: { value: "on" } });
    fireEvent.click(screen.getByRole("button", { name: /Publish/i }));
    await waitFor(() => expect(mockPublishMqtt).toHaveBeenCalledWith("cmd/light", "on"));
    await waitFor(() => expect((payload as HTMLInputElement).value).toBe(""));
  });

  it("does not publish when the topic is empty", () => {
    render(<MqttInspector />);
    fireEvent.click(screen.getByRole("button", { name: /Publish/i }));
    expect(mockPublishMqtt).not.toHaveBeenCalled();
  });

  it("publishes on Enter in the payload field", async () => {
    mockPublishMqtt.mockResolvedValueOnce({ success: true });
    render(<MqttInspector />);
    fireEvent.change(screen.getByPlaceholderText("Topic (e.g. sensor/kitchen/temp)"), {
      target: { value: "cmd/fan" },
    });
    fireEvent.keyDown(screen.getByPlaceholderText("Payload (e.g. 22.5)"), { key: "Enter" });
    await waitFor(() => expect(mockPublishMqtt).toHaveBeenCalledWith("cmd/fan", ""));
  });

  it("collapses the feed when the header toggle is clicked", () => {
    deviceState.mqttMessages = [msg({ topic: "sensor/kitchen/temp" })];
    render(<MqttInspector />);
    fireEvent.click(screen.getByRole("button", { name: /MQTT Inspector/i }));
    expect(screen.queryByPlaceholderText("Filter topics...")).not.toBeInTheDocument();
    expect(screen.queryByText("sensor/kitchen/temp")).not.toBeInTheDocument();
  });
});
