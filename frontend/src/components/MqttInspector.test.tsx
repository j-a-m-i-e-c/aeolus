// frontend/src/components/MqttInspector.test.tsx — live feed rendering, filter, publish, clear

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const {
  deviceState,
  authState,
  mockPublishMqtt,
  mockFetchPrivateTopics,
  mockAddPrivateTopic,
  mockRemovePrivateTopic,
} = vi.hoisted(() => ({
  deviceState: {} as any,
  authState: { user: null as null | { role: string } },
  mockPublishMqtt: vi.fn(),
  mockFetchPrivateTopics: vi.fn(),
  mockAddPrivateTopic: vi.fn(),
  mockRemovePrivateTopic: vi.fn(),
}));

vi.mock("../store/device-store", () => ({
  useDeviceStore: (selector: (s: any) => unknown) => selector(deviceState),
}));

vi.mock("../store/auth-store", () => ({
  useAuthStore: (selector: (s: any) => unknown) => selector(authState),
}));

vi.mock("../lib/api-client", () => ({
  publishMqtt: mockPublishMqtt,
  fetchPrivateTopics: mockFetchPrivateTopics,
  addPrivateTopic: mockAddPrivateTopic,
  removePrivateTopic: mockRemovePrivateTopic,
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
    authState.user = null;
    mockPublishMqtt.mockReset();
    mockFetchPrivateTopics.mockReset().mockResolvedValue([]);
    mockAddPrivateTopic.mockReset();
    mockRemovePrivateTopic.mockReset();
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

  describe("private topics", () => {
    it("loads filters for every user, including non-admins", async () => {
      authState.user = { role: "user" };
      render(<MqttInspector />);
      await waitFor(() => expect(mockFetchPrivateTopics).toHaveBeenCalled());
      expect(screen.getByTitle("Manage private topics")).toBeInTheDocument();
    });

    it("lets an admin open the privacy panel and see filters", async () => {
      authState.user = { role: "admin" };
      mockFetchPrivateTopics.mockResolvedValue([
        { id: "p1", pattern: "home/locks/#", createdAt: 1 },
      ]);
      render(<MqttInspector />);
      await waitFor(() => expect(mockFetchPrivateTopics).toHaveBeenCalled());

      fireEvent.click(screen.getByTitle("Manage private topics"));
      expect(screen.getByText("Private topics")).toBeInTheDocument();
      expect(screen.getByText("home/locks/#")).toBeInTheDocument();
    });

    it("adds a filter through the panel input", async () => {
      authState.user = { role: "admin" };
      mockFetchPrivateTopics.mockResolvedValue([]);
      mockAddPrivateTopic.mockResolvedValue({ id: "p2", pattern: "presence/#", createdAt: 2 });
      render(<MqttInspector />);
      await waitFor(() => expect(mockFetchPrivateTopics).toHaveBeenCalled());

      fireEvent.click(screen.getByTitle("Manage private topics"));
      fireEvent.change(screen.getByPlaceholderText("Topic filter (e.g. home/locks/#)"), {
        target: { value: "presence/#" },
      });
      fireEvent.click(screen.getByRole("button", { name: /^Add$/i }));
      await waitFor(() => expect(mockAddPrivateTopic).toHaveBeenCalledWith("presence/#"));
      await waitFor(() => expect(screen.getByText("presence/#")).toBeInTheDocument());
    });

    it("a non-admin can add but sees no remove control", async () => {
      authState.user = { role: "user" };
      mockFetchPrivateTopics.mockResolvedValue([
        { id: "p1", pattern: "home/locks/#", createdAt: 1 },
      ]);
      render(<MqttInspector />);
      await waitFor(() => expect(mockFetchPrivateTopics).toHaveBeenCalled());

      fireEvent.click(screen.getByTitle("Manage private topics"));
      // The add input is present for non-admins...
      expect(screen.getByPlaceholderText("Topic filter (e.g. home/locks/#)")).toBeInTheDocument();
      // ...but no remove (unlock) button is rendered.
      expect(screen.queryByTitle("Remove filter (re-expose topic)")).not.toBeInTheDocument();
      expect(screen.getByText("Only an admin can remove a filter.")).toBeInTheDocument();
    });

    it("disables Add and warns on a malformed filter", async () => {
      authState.user = { role: "admin" };
      render(<MqttInspector />);
      await waitFor(() => expect(mockFetchPrivateTopics).toHaveBeenCalled());

      fireEvent.click(screen.getByTitle("Manage private topics"));
      fireEvent.change(screen.getByPlaceholderText("Topic filter (e.g. home/locks/#)"), {
        target: { value: "a/#/b" },
      });
      expect(screen.getByRole("button", { name: /^Add$/i })).toBeDisabled();
      expect(screen.getByText(/Invalid filter/i)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /^Add$/i }));
      expect(mockAddPrivateTopic).not.toHaveBeenCalled();
    });

    it("marks a matching message row as private", async () => {
      authState.user = { role: "admin" };
      mockFetchPrivateTopics.mockResolvedValue([
        { id: "p1", pattern: "home/locks/#", createdAt: 1 },
      ]);
      deviceState.mqttMessages = [msg({ topic: "home/locks/front", payload: "1234" })];
      render(<MqttInspector />);
      await waitFor(() => expect(mockFetchPrivateTopics).toHaveBeenCalled());
      expect(screen.getByTitle("Hidden from non-admins")).toBeInTheDocument();
    });
  });
});
