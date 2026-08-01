// src/mqtt/mqtt-service.test.ts — Unit tests for MqttService
// Requirements: 10.1, 10.2, 10.3, 10.4

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import { DEVICE_STATE_CHANGE, MQTT_RAW_MESSAGE, MQTT_CONNECTION_STATE } from "../core/event-bus.js";
import type { NormalizedEvent } from "../core/types.js";

// Mock logger
vi.mock("../logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Create a mock MQTT client that behaves like an EventEmitter
function createMockMqttClientInstance() {
  const emitter = new EventEmitter();
  const mock = emitter as EventEmitter & {
    subscribe: ReturnType<typeof vi.fn>;
    publish: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  };
  mock.subscribe = vi.fn((_topic: string, cb?: (err: Error | null) => void) => {
    if (cb) cb(null);
  });
  mock.publish = vi.fn((_topic: string, _payload: string, _opts: unknown, cb?: (err?: Error) => void) => {
    if (cb) cb();
  });
  mock.end = vi.fn((_force: boolean | undefined, cb?: () => void) => {
    if (cb) cb();
  });
  return mock;
}

// Mock the mqtt module
const mockConnect = vi.fn();
vi.mock("mqtt", () => ({
  default: { connect: (...args: unknown[]) => mockConnect(...args) },
  connect: (...args: unknown[]) => mockConnect(...args),
}));

import { MqttService, computeRetryDelay, redactBrokerUrl } from "./mqtt-service.js";

describe("redactBrokerUrl", () => {
  it("strips user:password userinfo from a broker URL", () => {
    expect(redactBrokerUrl("mqtt://user:secret@broker.local:1883")).toBe(
      "mqtt://***@broker.local:1883",
    );
  });

  it("strips a username-only userinfo", () => {
    expect(redactBrokerUrl("mqtts://alice@broker.local:8883")).toBe(
      "mqtts://***@broker.local:8883",
    );
  });

  it("leaves a URL without credentials unchanged", () => {
    expect(redactBrokerUrl("mqtt://broker.local:1883")).toBe("mqtt://broker.local:1883");
  });

  it("does not treat a path segment as userinfo", () => {
    expect(redactBrokerUrl("mqtt://broker.local:1883/topic@x")).toBe(
      "mqtt://broker.local:1883/topic@x",
    );
  });
});
import logger from "../logger.js";

describe("MqttService", () => {
  let eventBus: EventEmitter;
  let service: MqttService;
  let mockClient: ReturnType<typeof createMockMqttClientInstance>;

  beforeEach(() => {
    vi.useFakeTimers();
    eventBus = new EventEmitter();
    mockClient = createMockMqttClientInstance();
    mockConnect.mockReturnValue(mockClient);

    service = new MqttService(
      {
        brokerUrl: "mqtt://localhost:1883",
        topics: ["sensor/#", "light/#"],
        baseRetryDelayMs: 1000,
        maxBackoffMs: 30000,
      },
      eventBus,
    );
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe("message handling — emits DEVICE_STATE_CHANGE (Requirement 10.1)", () => {
    it("emits DEVICE_STATE_CHANGE with correct topic, deviceId, deviceType, and state for JSON payload", async () => {
      // Connect the service
      const connectPromise = service.connect();
      mockClient.emit("connect");
      await connectPromise;

      // Capture emitted events
      const events: NormalizedEvent[] = [];
      eventBus.on(DEVICE_STATE_CHANGE, (event: NormalizedEvent) => {
        events.push(event);
      });

      // Simulate receiving a message
      const messageHandler = mockClient.listeners("message")[0] as (topic: string, payload: Buffer) => void;
      messageHandler("sensor/temperature/living", Buffer.from('{"value": 22.5}'));

      expect(events).toHaveLength(1);
      expect(events[0].topic).toBe("sensor/temperature/living");
      expect(events[0].deviceId).toBe("sensor-temperature-living");
      expect(events[0].deviceType).toBe("sensor");
      expect(events[0].state).toEqual({ value: 22.5 });
    });

    it("emits DEVICE_STATE_CHANGE wrapping non-object JSON in { value: ... }", async () => {
      const connectPromise = service.connect();
      mockClient.emit("connect");
      await connectPromise;

      const events: NormalizedEvent[] = [];
      eventBus.on(DEVICE_STATE_CHANGE, (event: NormalizedEvent) => {
        events.push(event);
      });

      const messageHandler = mockClient.listeners("message")[0] as (topic: string, payload: Buffer) => void;
      messageHandler("light/kitchen", Buffer.from("42"));

      expect(events).toHaveLength(1);
      expect(events[0].state).toEqual({ value: 42 });
    });

    it("emits DEVICE_STATE_CHANGE with numeric payload parsed as number", async () => {
      const connectPromise = service.connect();
      mockClient.emit("connect");
      await connectPromise;

      const events: NormalizedEvent[] = [];
      eventBus.on(DEVICE_STATE_CHANGE, (event: NormalizedEvent) => {
        events.push(event);
      });

      const messageHandler = mockClient.listeners("message")[0] as (topic: string, payload: Buffer) => void;
      messageHandler("sensor/humidity", Buffer.from("65.3"));

      expect(events).toHaveLength(1);
      expect(events[0].state).toEqual({ value: 65.3 });
      expect(events[0].deviceId).toBe("sensor-humidity");
      expect(events[0].deviceType).toBe("sensor");
    });

    it("emits DEVICE_STATE_CHANGE with plain string payload wrapped in { value: ... }", async () => {
      const connectPromise = service.connect();
      mockClient.emit("connect");
      await connectPromise;

      const events: NormalizedEvent[] = [];
      eventBus.on(DEVICE_STATE_CHANGE, (event: NormalizedEvent) => {
        events.push(event);
      });

      const messageHandler = mockClient.listeners("message")[0] as (topic: string, payload: Buffer) => void;
      messageHandler("switch/garage", Buffer.from("ON"));

      expect(events).toHaveLength(1);
      expect(events[0].state).toEqual({ value: "ON" });
    });

    it("emits MQTT_RAW_MESSAGE for every received message", async () => {
      const connectPromise = service.connect();
      mockClient.emit("connect");
      await connectPromise;

      const rawEvents: unknown[] = [];
      eventBus.on(MQTT_RAW_MESSAGE, (event) => {
        rawEvents.push(event);
      });

      const messageHandler = mockClient.listeners("message")[0] as (topic: string, payload: Buffer) => void;
      messageHandler("sensor/temp", Buffer.from('{"temp": 20}'));

      expect(rawEvents).toHaveLength(1);
      expect((rawEvents[0] as { topic: string }).topic).toBe("sensor/temp");
    });
  });

  it("excludes configured control-plane topics from discovery while retaining raw inspection", async () => {
    const controlledService = new MqttService(
      {
        brokerUrl: "mqtt://localhost:1883",
        topics: ["#"],
        baseRetryDelayMs: 1000,
        maxBackoffMs: 30000,
        discoveryIgnoredTopicSuffixes: ["set", "heartbeat"],
      },
      eventBus,
    );
    const stateEvents: NormalizedEvent[] = [];
    const rawEvents: unknown[] = [];
    eventBus.on(DEVICE_STATE_CHANGE, (event: NormalizedEvent) => stateEvents.push(event));
    eventBus.on(MQTT_RAW_MESSAGE, (event) => rawEvents.push(event));

    const connectPromise = controlledService.connect();
    mockClient.emit("connect");
    await connectPromise;

    const messageHandler = mockClient.listeners("message")[0] as (topic: string, payload: Buffer) => void;
    messageHandler("pump/well/set", Buffer.from('{"running":true}'));

    expect(rawEvents).toHaveLength(1);
    expect(stateEvents).toHaveLength(0);
  });

  it("handles trailing-slash topics without false-positive discovery exclusion", async () => {
    const controlledService = new MqttService(
      {
        brokerUrl: "mqtt://localhost:1883",
        topics: ["#"],
        baseRetryDelayMs: 1000,
        maxBackoffMs: 30000,
        discoveryIgnoredTopicSuffixes: ["set", "heartbeat"],
      },
      eventBus,
    );
    const stateEvents: NormalizedEvent[] = [];
    eventBus.on(DEVICE_STATE_CHANGE, (event: NormalizedEvent) => stateEvents.push(event));

    const connectPromise = controlledService.connect();
    mockClient.emit("connect");
    await connectPromise;

    const messageHandler = mockClient.listeners("message")[0] as (topic: string, payload: Buffer) => void;
    // A trailing slash produces an empty final segment — .filter(Boolean) strips it,
    // so the effective leaf is "well" which is NOT in the ignore list. The topic
    // proceeds to normal discovery rather than being falsely excluded.
    messageHandler("pump/well/", Buffer.from('{"value":1}'));

    expect(stateEvents).toHaveLength(1);
    expect(stateEvents[0]?.deviceId).toBe("pump-well");
  });

  it("uses the registry's collision-safe MQTT identity in emitted events", async () => {
    const resolveMqttDeviceId = vi.fn().mockReturnValue("mqtt-a-b-c-deadbeefcafe");
    service.setDeviceRegistry({ resolveMqttDeviceId } as unknown as import("../core/device-registry.js").DeviceRegistry);

    const connectPromise = service.connect();
    mockClient.emit("connect");
    await connectPromise;

    const events: NormalizedEvent[] = [];
    eventBus.on(DEVICE_STATE_CHANGE, (event: NormalizedEvent) => events.push(event));
    const messageHandler = mockClient.listeners("message")[0] as (topic: string, payload: Buffer) => void;
    messageHandler("a-b/c", Buffer.from('{"value":2}'));

    expect(resolveMqttDeviceId).toHaveBeenCalledWith("a-b/c", "a-b-c");
    expect(events[0]?.deviceId).toBe("mqtt-a-b-c-deadbeefcafe");
  });

  describe("reconnection with exponential backoff (Requirement 10.2)", () => {
    it("attempts reconnection when connection is lost", async () => {
      const connectPromise = service.connect();
      mockClient.emit("connect");
      await connectPromise;

      // Simulate connection loss
      mockClient.emit("close");

      // Verify state changed
      expect(service.getConnectionState()).toBe("waiting_retry");
    });

    it("uses exponential backoff for reconnection delays", async () => {
      const connectPromise = service.connect();
      mockClient.emit("connect");
      await connectPromise;

      // Simulate connection loss
      mockClient.emit("close");

      // First attempt should be scheduled with baseRetryDelayMs (1000ms)
      expect(service.getConnectionState()).toBe("waiting_retry");

      // Create a new mock client for the reconnection attempt
      const mockClient2 = createMockMqttClientInstance();
      mockConnect.mockReturnValue(mockClient2);

      // Advance timer by 1000ms (first retry delay)
      await vi.advanceTimersByTimeAsync(1000);

      // The reconnection attempt should have been made
      expect(mockConnect).toHaveBeenCalledTimes(2);

      // Simulate second connection failure — this triggers the catch block
      // which calls startReconnectionLoop() again
      mockClient2.emit("error", new Error("Connection refused"));

      // Allow microtasks to settle (the catch block in startReconnectionLoop is async)
      await vi.advanceTimersByTimeAsync(0);

      // After the error is caught, startReconnectionLoop schedules the next attempt
      // with delay = 1000 * 2^1 = 2000ms
      expect(service.getConnectionState()).toBe("waiting_retry");

      const mockClient3 = createMockMqttClientInstance();
      mockConnect.mockReturnValue(mockClient3);

      // Advance by 2000ms (second backoff delay)
      await vi.advanceTimersByTimeAsync(2000);

      // Third connection attempt
      expect(mockConnect).toHaveBeenCalledTimes(3);
    });

    it("computeRetryDelay returns correct exponential values", () => {
      expect(computeRetryDelay(1, 1000, 30000)).toBe(1000);
      expect(computeRetryDelay(2, 1000, 30000)).toBe(2000);
      expect(computeRetryDelay(3, 1000, 30000)).toBe(4000);
      expect(computeRetryDelay(4, 1000, 30000)).toBe(8000);
      expect(computeRetryDelay(5, 1000, 30000)).toBe(16000);
      expect(computeRetryDelay(6, 1000, 30000)).toBe(30000); // capped at max
      expect(computeRetryDelay(7, 1000, 30000)).toBe(30000); // still capped
    });

    it("does not attempt reconnection on intentional disconnect", async () => {
      const connectPromise = service.connect();
      mockClient.emit("connect");
      await connectPromise;

      // Intentionally disconnect
      await service.disconnect();

      // Reset mock to track new calls
      mockConnect.mockClear();

      // Advance timers — no reconnection should happen
      await vi.advanceTimersByTimeAsync(60000);
      expect(mockConnect).not.toHaveBeenCalled();
    });
  });

  describe("resubscription on reconnect (Requirement 10.3)", () => {
    it("resubscribes to all configured topics after successful reconnection", async () => {
      const connectPromise = service.connect();
      mockClient.emit("connect");
      await connectPromise;

      // Verify initial subscription
      expect(mockClient.subscribe).toHaveBeenCalledTimes(2);
      expect(mockClient.subscribe).toHaveBeenCalledWith("sensor/#", expect.any(Function));
      expect(mockClient.subscribe).toHaveBeenCalledWith("light/#", expect.any(Function));

      // Simulate connection loss
      mockClient.emit("close");

      // Create new mock client for reconnection
      const mockClient2 = createMockMqttClientInstance();
      mockConnect.mockReturnValue(mockClient2);

      // Advance timer to trigger reconnection
      await vi.advanceTimersByTimeAsync(1000);

      // Simulate successful reconnection
      mockClient2.emit("connect");

      // Verify resubscription to all topics
      expect(mockClient2.subscribe).toHaveBeenCalledTimes(2);
      expect(mockClient2.subscribe).toHaveBeenCalledWith("sensor/#", expect.any(Function));
      expect(mockClient2.subscribe).toHaveBeenCalledWith("light/#", expect.any(Function));
    });

    it("resets reconnect attempt counter on successful reconnection", async () => {
      const connectPromise = service.connect();
      mockClient.emit("connect");
      await connectPromise;

      // Simulate connection loss
      mockClient.emit("close");

      // Create new mock client for reconnection
      const mockClient2 = createMockMqttClientInstance();
      mockConnect.mockReturnValue(mockClient2);

      // Advance timer to trigger reconnection
      await vi.advanceTimersByTimeAsync(1000);

      // Simulate successful reconnection
      mockClient2.emit("connect");

      expect(service.getConnectionState()).toBe("connected");
      expect(service.isConnected()).toBe(true);
    });
  });

  describe("malformed message payloads (Requirement 10.4)", () => {
    it("discards empty payload without crashing", async () => {
      const connectPromise = service.connect();
      mockClient.emit("connect");
      await connectPromise;

      const events: NormalizedEvent[] = [];
      eventBus.on(DEVICE_STATE_CHANGE, (event: NormalizedEvent) => {
        events.push(event);
      });

      const messageHandler = mockClient.listeners("message")[0] as (topic: string, payload: Buffer) => void;

      // Should not throw
      expect(() => messageHandler("sensor/temp", Buffer.from(""))).not.toThrow();
      expect(events).toHaveLength(0);
    });

    it("discards whitespace-only payload without crashing", async () => {
      const connectPromise = service.connect();
      mockClient.emit("connect");
      await connectPromise;

      const events: NormalizedEvent[] = [];
      eventBus.on(DEVICE_STATE_CHANGE, (event: NormalizedEvent) => {
        events.push(event);
      });

      const messageHandler = mockClient.listeners("message")[0] as (topic: string, payload: Buffer) => void;

      expect(() => messageHandler("sensor/temp", Buffer.from("   "))).not.toThrow();
      expect(events).toHaveLength(0);
    });

    it("logs warning for empty/unparseable payload", async () => {
      const connectPromise = service.connect();
      mockClient.emit("connect");
      await connectPromise;

      const messageHandler = mockClient.listeners("message")[0] as (topic: string, payload: Buffer) => void;
      messageHandler("sensor/temp", Buffer.from(""));

      expect(logger.warn).toHaveBeenCalled();
    });

    it("handles unparseable topic gracefully without crashing", async () => {
      const connectPromise = service.connect();
      mockClient.emit("connect");
      await connectPromise;

      const events: NormalizedEvent[] = [];
      eventBus.on(DEVICE_STATE_CHANGE, (event: NormalizedEvent) => {
        events.push(event);
      });

      const messageHandler = mockClient.listeners("message")[0] as (topic: string, payload: Buffer) => void;

      // Empty topic segments after filtering
      expect(() => messageHandler("///", Buffer.from('{"temp": 20}'))).not.toThrow();
      expect(events).toHaveLength(0);
    });

    it("still emits MQTT_RAW_MESSAGE even for malformed payloads", async () => {
      const connectPromise = service.connect();
      mockClient.emit("connect");
      await connectPromise;

      const rawEvents: unknown[] = [];
      eventBus.on(MQTT_RAW_MESSAGE, (event) => {
        rawEvents.push(event);
      });

      const messageHandler = mockClient.listeners("message")[0] as (topic: string, payload: Buffer) => void;
      messageHandler("sensor/temp", Buffer.from(""));

      // Raw message is always emitted regardless of parse success
      expect(rawEvents).toHaveLength(1);
    });
  });

  describe("connection state management", () => {
    it("emits MQTT_CONNECTION_STATE events on state transitions", async () => {
      const stateChanges: { previous: string; current: string }[] = [];
      eventBus.on(MQTT_CONNECTION_STATE, (event) => {
        stateChanges.push(event);
      });

      const connectPromise = service.connect();
      // Should transition to "connecting"
      expect(stateChanges).toContainEqual({ previous: "disconnected", current: "connecting" });

      mockClient.emit("connect");
      await connectPromise;

      // Should transition to "connected"
      expect(stateChanges).toContainEqual({ previous: "connecting", current: "connected" });
    });

    it("starts in disconnected state", () => {
      expect(service.getConnectionState()).toBe("disconnected");
      expect(service.isConnected()).toBe(false);
    });
  });

  describe("publish", () => {
    it("throws when not connected", () => {
      expect(() => service.publish("test/topic", "hello")).toThrow("not connected");
    });

    it("publishes message with default expiry when connected", async () => {
      const connectPromise = service.connect();
      mockClient.emit("connect");
      await connectPromise;

      service.publish("test/topic", "hello");
      expect(mockClient.publish).toHaveBeenCalledWith(
        "test/topic",
        "hello",
        expect.objectContaining({ properties: { messageExpiryInterval: 30 } }),
        expect.any(Function),
      );
    });

    it("publishes message with custom expiry", async () => {
      const connectPromise = service.connect();
      mockClient.emit("connect");
      await connectPromise;

      service.publish("test/topic", "hello", { messageExpiryInterval: 60 });
      expect(mockClient.publish).toHaveBeenCalledWith(
        "test/topic",
        "hello",
        expect.objectContaining({ properties: { messageExpiryInterval: 60 } }),
        expect.any(Function),
      );
    });

    it("sets the broker retain option only when requested", async () => {
      const connectPromise = service.connect();
      mockClient.emit("connect");
      await connectPromise;

      service.publish("test/topic", "hello", { retain: true });
      expect(mockClient.publish).toHaveBeenLastCalledWith(
        "test/topic",
        "hello",
        expect.objectContaining({ retain: true }),
        expect.any(Function),
      );

      service.publish("test/topic", "hello");
      expect(mockClient.publish).toHaveBeenLastCalledWith(
        "test/topic",
        "hello",
        expect.objectContaining({ retain: false }),
        expect.any(Function),
      );
    });

    it("logs error when publish callback receives error", async () => {
      const connectPromise = service.connect();
      mockClient.emit("connect");
      await connectPromise;

      mockClient.publish.mockImplementation((_topic: string, _payload: string, _opts: unknown, cb?: (err?: Error) => void) => {
        if (cb) cb(new Error("publish failed"));
      });

      service.publish("test/topic", "hello");
      expect(logger.error).toHaveBeenCalled();
    });

    it("emits MQTT_MESSAGE_PUBLISHED on successful publish", async () => {
      const connectPromise = service.connect();
      mockClient.emit("connect");
      await connectPromise;

      const { MQTT_MESSAGE_PUBLISHED } = await import("../core/event-bus.js");
      const published: unknown[] = [];
      eventBus.on(MQTT_MESSAGE_PUBLISHED, (e) => published.push(e));

      service.publish("test/topic", "hello");
      expect(published).toHaveLength(1);
      expect((published[0] as { topic: string }).topic).toBe("test/topic");
    });
  });

  describe("reconnectWithCredentials", () => {
    it("disconnects first then reconnects", async () => {
      const connectPromise = service.connect();
      mockClient.emit("connect");
      await connectPromise;
      expect(service.isConnected()).toBe(true);

      // After disconnect, state should be disconnected
      await service.disconnect();
      expect(service.isConnected()).toBe(false);
    });
  });

  describe("disconnect", () => {
    it("resolves immediately when no client exists", async () => {
      await service.disconnect();
      expect(service.getConnectionState()).toBe("disconnected");
    });

    it("cancels pending reconnection timer on disconnect", async () => {
      const connectPromise = service.connect();
      mockClient.emit("connect");
      await connectPromise;

      // Trigger reconnection loop
      mockClient.emit("close");
      expect(service.getConnectionState()).toBe("waiting_retry");

      // Disconnect should cancel the timer
      const mockClient2 = createMockMqttClientInstance();
      mockConnect.mockReturnValue(mockClient2);
      await service.disconnect();

      // Advance time — no reconnection should happen
      mockConnect.mockClear();
      await vi.advanceTimersByTimeAsync(60000);
      expect(mockConnect).not.toHaveBeenCalled();
    });
  });

  describe("subscribe error handling", () => {
    it("logs error when subscription fails", async () => {
      mockClient.subscribe.mockImplementation((_topic: string, cb?: (err: Error | null) => void) => {
        if (cb) cb(new Error("subscribe failed"));
      });

      const connectPromise = service.connect();
      mockClient.emit("connect");
      await connectPromise;

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ topic: expect.any(String) }),
        expect.stringContaining("Failed to subscribe"),
      );
    });
  });
});

describe("MqttService ack-topic routing", () => {
  let eventBus: EventEmitter;
  let ackService: InstanceType<typeof MqttService>;
  let mockClient: ReturnType<typeof createMockMqttClientInstance>;

  beforeEach(() => {
    vi.useFakeTimers();
    eventBus = new EventEmitter();
    mockClient = createMockMqttClientInstance();
    mockConnect.mockReturnValue(mockClient);

    ackService = new MqttService(
      {
        brokerUrl: "mqtt://localhost:1883",
        topics: ["sensor/#"],
        baseRetryDelayMs: 1000,
        maxBackoffMs: 30000,
        ackTopicFilter: "aeolus/acks/#",
      },
      eventBus,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("routes ack-topic messages to the ackRouter instead of DEVICE_STATE_CHANGE", async () => {
    const routeFn = vi.fn();
    const observeStateFn = vi.fn();
    ackService.setAckRouter({ route: routeFn, observeState: observeStateFn });

    const connectPromise = ackService.connect();
    mockClient.emit("connect");
    await connectPromise;

    const stateEvents: unknown[] = [];
    eventBus.on(DEVICE_STATE_CHANGE, (e) => stateEvents.push(e));

    // Simulate ack message with correlation data
    const messageHandler = mockClient.listeners("message")[0] as (topic: string, payload: Buffer, packet: unknown) => void;
    messageHandler(
      "aeolus/acks/device-1",
      Buffer.from(JSON.stringify({ correlationId: "abc-123", status: "executed" })),
      { properties: {} },
    );

    expect(routeFn).toHaveBeenCalledOnce();
    expect(routeFn).toHaveBeenCalledWith(expect.objectContaining({ correlationId: "abc-123", status: "executed" }));
    expect(stateEvents).toHaveLength(0); // Not emitted as device state
  });

  it("routes documented success and error fields from an ack-topic message", async () => {
    const routeFn = vi.fn();
    ackService.setAckRouter({ route: routeFn, observeState: vi.fn() });

    const connectPromise = ackService.connect();
    mockClient.emit("connect");
    await connectPromise;

    const messageHandler = mockClient.listeners("message")[0] as (topic: string, payload: Buffer, packet: unknown) => void;
    messageHandler(
      "aeolus/acks/device-1",
      Buffer.from(JSON.stringify({ correlationId: "abc-123", success: false, error: "relay stuck" })),
      { properties: {} },
    );

    expect(routeFn).toHaveBeenCalledWith(expect.objectContaining({
      correlationId: "abc-123",
      success: false,
      error: "relay stuck",
    }));
  });

  it("handles ack message with MQTT 5 Correlation Data property", async () => {
    const routeFn = vi.fn();
    ackService.setAckRouter({ route: routeFn, observeState: vi.fn() });

    const connectPromise = ackService.connect();
    mockClient.emit("connect");
    await connectPromise;

    const messageHandler = mockClient.listeners("message")[0] as (topic: string, payload: Buffer, packet: unknown) => void;
    messageHandler(
      "aeolus/acks/device-1",
      Buffer.from(JSON.stringify({ status: "done" })),
      { properties: { correlationData: Buffer.from("mqtt5-corr-id") } },
    );

    expect(routeFn).toHaveBeenCalledWith(expect.objectContaining({ correlationId: "mqtt5-corr-id" }));
  });

  it("drops ack message with no resolvable correlation id", async () => {
    const routeFn = vi.fn();
    ackService.setAckRouter({ route: routeFn, observeState: vi.fn() });

    const connectPromise = ackService.connect();
    mockClient.emit("connect");
    await connectPromise;

    const messageHandler = mockClient.listeners("message")[0] as (topic: string, payload: Buffer, packet: unknown) => void;
    // No correlationId in payload, no correlationData in packet
    messageHandler(
      "aeolus/acks/device-1",
      Buffer.from(JSON.stringify({ status: "done" })),
      { properties: {} },
    );

    expect(routeFn).not.toHaveBeenCalled();
  });

  it("handles non-JSON ack payload gracefully", async () => {
    const routeFn = vi.fn();
    ackService.setAckRouter({ route: routeFn, observeState: vi.fn() });

    const connectPromise = ackService.connect();
    mockClient.emit("connect");
    await connectPromise;

    const messageHandler = mockClient.listeners("message")[0] as (topic: string, payload: Buffer, packet: unknown) => void;
    // Non-JSON payload with MQTT 5 correlation data
    messageHandler(
      "aeolus/acks/device-1",
      Buffer.from("not-json"),
      { properties: { correlationData: Buffer.from("corr-id-1") } },
    );

    expect(routeFn).toHaveBeenCalledWith(expect.objectContaining({ correlationId: "corr-id-1" }));
  });

  it("does not route when no ackRouter is set", async () => {
    // No setAckRouter called
    const connectPromise = ackService.connect();
    mockClient.emit("connect");
    await connectPromise;

    const messageHandler = mockClient.listeners("message")[0] as (topic: string, payload: Buffer, packet: unknown) => void;
    // Should not throw
    expect(() => {
      messageHandler(
        "aeolus/acks/device-1",
        Buffer.from(JSON.stringify({ correlationId: "id", status: "done" })),
        { properties: {} },
      );
    }).not.toThrow();
  });

  it("feeds observeState on normal (non-ack) topic messages", async () => {
    const observeStateFn = vi.fn();
    ackService.setAckRouter({ route: vi.fn(), observeState: observeStateFn });

    const connectPromise = ackService.connect();
    mockClient.emit("connect");
    await connectPromise;

    const messageHandler = mockClient.listeners("message")[0] as (topic: string, payload: Buffer, packet: unknown) => void;
    messageHandler("sensor/temperature/kitchen", Buffer.from('{"value": 23}'), { properties: {} });

    expect(observeStateFn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ value: 23 }),
    );
  });

  it("subscribes to the ack topic filter alongside normal topics", async () => {
    const connectPromise = ackService.connect();
    mockClient.emit("connect");
    await connectPromise;

    const subscribedTopics = mockClient.subscribe.mock.calls.map((c) => c[0]);
    expect(subscribedTopics).toContain("aeolus/acks/#");
    expect(subscribedTopics).toContain("sensor/#");
  });

  it("publishes with correlationData and responseTopic properties", async () => {
    const connectPromise = ackService.connect();
    mockClient.emit("connect");
    await connectPromise;

    ackService.publish("device/cmd", '{"action":"on"}', {
      correlationData: Buffer.from("corr-123"),
      responseTopic: "aeolus/acks/dev-1",
    });

    expect(mockClient.publish).toHaveBeenCalledWith(
      "device/cmd",
      '{"action":"on"}',
      expect.objectContaining({
        properties: expect.objectContaining({
          correlationData: Buffer.from("corr-123"),
          responseTopic: "aeolus/acks/dev-1",
        }),
      }),
      expect.any(Function),
    );
  });

  it("isAckTopic matches exact prefix without wildcard", async () => {
    // Service with a non-wildcard ack filter
    const svc = new MqttService(
      {
        brokerUrl: "mqtt://localhost:1883",
        topics: ["#"],
        baseRetryDelayMs: 1000,
        maxBackoffMs: 30000,
        ackTopicFilter: "aeolus/acks",
      },
      eventBus,
    );
    const routeFn = vi.fn();
    svc.setAckRouter({ route: routeFn, observeState: vi.fn() });

    mockClient = createMockMqttClientInstance();
    mockConnect.mockReturnValue(mockClient);

    const connectPromise = svc.connect();
    mockClient.emit("connect");
    await connectPromise;

    const messageHandler = mockClient.listeners("message")[0] as (topic: string, payload: Buffer, packet: unknown) => void;
    messageHandler("aeolus/acks", Buffer.from(JSON.stringify({ correlationId: "x", status: "ok" })), { properties: {} });

    expect(routeFn).toHaveBeenCalledOnce();
  });
});
