// src/__integration__/command-ack-flow.integration.test.ts
// Integration test: full command → device acknowledgement → ACKNOWLEDGED flow
// Exercises the real MqttService ack-routing path (resolveCorrelationId + ack-topic
// match routing to PendingCommandTracker.route) end-to-end.
//
// Validates: Requirements 13.1, 13.2, 13.3, 13.4

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import { MqttService } from "../mqtt/mqtt-service.js";
import { PendingCommandTracker } from "../automations/pending-command-tracker.js";
import { CommandService, type CommandServiceDeps, type ActionDescriptor } from "../automations/command-service.js";

// Mock logger — silent stubs
vi.mock("../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Create a fake MQTT client (EventEmitter with minimal MqttClient surface)
function createFakeMqttClient() {
  const emitter = new EventEmitter();
  const client = emitter as EventEmitter & {
    subscribe: ReturnType<typeof vi.fn>;
    publish: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  };
  client.subscribe = vi.fn((_topic: string, cb?: (err: Error | null) => void) => {
    if (cb) cb(null);
  });
  client.publish = vi.fn(
    (_topic: string, _payload: string, _opts: unknown, cb?: (err?: Error) => void) => {
      if (cb) cb();
    },
  );
  client.end = vi.fn((_force: boolean | undefined, cb?: () => void) => {
    if (cb) cb();
  });
  return client;
}

// Mock the mqtt module so MqttService.connect() gets our fake client
const mockConnect = vi.fn();
vi.mock("mqtt", () => ({
  default: { connect: (...args: unknown[]) => mockConnect(...args) },
  connect: (...args: unknown[]) => mockConnect(...args),
}));

describe("Command → Ack Flow Integration (Req 13)", () => {
  let eventBus: EventEmitter;
  let fakeClient: ReturnType<typeof createFakeMqttClient>;
  let mqttService: MqttService;
  let tracker: PendingCommandTracker;
  let commandService: CommandService;

  beforeEach(async () => {
    eventBus = new EventEmitter();
    fakeClient = createFakeMqttClient();
    mockConnect.mockReturnValue(fakeClient);

    tracker = new PendingCommandTracker();

    mqttService = new MqttService(
      {
        brokerUrl: "mqtt://localhost:1883",
        topics: ["sensor/#"],
        baseRetryDelayMs: 1000,
        maxBackoffMs: 30000,
        ackTopicFilter: "aeolus/acks/#",
      },
      eventBus,
      { ackRouter: tracker },
    );

    // Connect the service — triggers subscribe and message handler setup
    const connectPromise = mqttService.connect();
    fakeClient.emit("connect");
    await connectPromise;

    // Build CommandService with a connectorManager stub that declares ack capability
    const connectorManager = {
      executeAction: vi.fn().mockResolvedValue({ success: true }),
      getAcknowledgementCapability: vi.fn().mockReturnValue({
        supported: true,
        responseTopic: "aeolus/acks/dev-1",
      }),
    };

    const deps: CommandServiceDeps = {
      mqttService,
      connectorManager: connectorManager as unknown as CommandServiceDeps["connectorManager"],
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as CommandServiceDeps["logger"],
      pendingCommandTracker: tracker,
      ackResponseTopicBase: "aeolus/acks",
    };

    commandService = new CommandService(deps);
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await mqttService.disconnect();
  });

  it("dispatched command reaches ACKNOWLEDGED when device publishes correlated ack (Req 13.1, 13.2, 13.3)", async () => {
    // Capture the correlationId assigned during dispatch so we can simulate the
    // device reply. The handler receives the enriched action with correlation.
    let capturedCorrelationId: string | undefined;

    commandService.registerHandler("device_action", (action: ActionDescriptor) => {
      capturedCorrelationId = action.correlation?.correlationId;
      // Simulate device ack arriving shortly after dispatch resolves
      process.nextTick(() => {
        // Emit a "message" event on the fake client — the REAL MqttService
        // message handler picks it up, resolves the correlation id, and routes
        // through PendingCommandTracker.route().
        const messageHandler = fakeClient.listeners("message")[0] as (
          topic: string,
          payload: Buffer,
          packet: unknown,
        ) => void;
        messageHandler(
          "aeolus/acks/dev-1",
          Buffer.from(JSON.stringify({ correlationId: capturedCorrelationId, success: true })),
          { properties: {} },
        );
      });
      return { success: true };
    });

    const action: ActionDescriptor = {
      type: "device_action",
      target: "dev-1",
      params: { command: "turn_on" },
    };

    const result = await commandService.execute(action, "rule-integration-1");

    expect(result.success).toBe(true);
    expect(result.lifecycleState).toBe("ACKNOWLEDGED");
    expect(result.correlationId).toBeDefined();
    expect(capturedCorrelationId).toBeDefined();
    expect(result.correlationId).toBe(capturedCorrelationId);
  });

  it("returns a device-reported failure from the documented acknowledgement envelope", async () => {
    commandService.registerHandler("device_action", (action: ActionDescriptor) => {
      process.nextTick(() => {
        const messageHandler = fakeClient.listeners("message")[0] as (
          topic: string,
          payload: Buffer,
          packet: unknown,
        ) => void;
        messageHandler(
          "aeolus/acks/dev-1",
          Buffer.from(JSON.stringify({
            correlationId: action.correlation?.correlationId,
            success: false,
            error: "relay stuck",
          })),
          { properties: {} },
        );
      });
      return { success: true };
    });

    const result = await commandService.execute({
      type: "device_action",
      target: "dev-1",
      params: { command: "turn_on" },
    }, "rule-integration-failure");

    expect(result).toMatchObject({
      success: false,
      lifecycleState: "FAILED",
      error: "relay stuck",
    });
  });

  it("tracked command resolves as TIMED_OUT when no ack arrives (Req 13.4)", async () => {
    vi.useFakeTimers();

    // Handler does NOT simulate a device reply — the command will time out
    commandService.registerHandler("device_action", () => {
      return { success: true };
    });

    const action: ActionDescriptor = {
      type: "device_action",
      target: "dev-1",
      params: { command: "turn_on" },
    };

    const timeoutMs = 5000;
    const resultPromise = commandService.execute(action, "rule-integration-2", undefined, "acknowledged");

    // Advance past the configured timeout
    await vi.advanceTimersByTimeAsync(timeoutMs + 1);

    const result = await resultPromise;

    expect(result.success).toBe(false);
    expect(result.lifecycleState).toBe("TIMED_OUT");

    vi.useRealTimers();
  });
});
