// src/automations/command-service.lifecycle.test.ts — Branch coverage for the command lifecycle paths

import { describe, it, expect, vi } from "vitest";
import { CommandService, type CommandServiceDeps } from "./command-service.js";
import { PendingCommandTracker } from "./pending-command-tracker.js";

vi.mock("../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function createMockDeps(overrides?: Partial<CommandServiceDeps>): CommandServiceDeps {
  return {
    mqttService: { isConnected: vi.fn().mockReturnValue(true), publish: vi.fn() } as unknown as CommandServiceDeps["mqttService"],
    connectorManager: {
      executeAction: vi.fn().mockResolvedValue({ success: true }),
      getAcknowledgementCapability: vi.fn().mockReturnValue(undefined),
    } as unknown as CommandServiceDeps["connectorManager"],
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as CommandServiceDeps["logger"],
    ...overrides,
  };
}

describe("CommandService lifecycle branches", () => {
  describe("confirm flow", () => {
    it("returns FAILED when observed device is not found in registry", async () => {
      const deviceRegistry = { getById: vi.fn().mockReturnValue(undefined) };
      const deps = createMockDeps({ deviceRegistry: deviceRegistry as unknown as CommandServiceDeps["deviceRegistry"] });
      const executor = new CommandService(deps);
      executor.registerHandler("device_action", vi.fn());

      const result = await executor.execute(
        { type: "device_action", target: "dev-1", params: {} },
        "rule-1",
        { condition: () => true, deviceId: "missing-observer" },
      );

      expect(result.success).toBe(false);
      expect(result.lifecycleState).toBe("FAILED");
      expect(result.error).toContain("missing-observer");
    });

    it("registers with tracker and returns OBSERVED on satisfied predicate", async () => {
      const tracker = new PendingCommandTracker();
      const deviceRegistry = { getById: vi.fn().mockReturnValue({ id: "dev-1" }) };
      const deps = createMockDeps({
        deviceRegistry: deviceRegistry as unknown as CommandServiceDeps["deviceRegistry"],
        pendingCommandTracker: tracker,
      });
      const executor = new CommandService(deps);
      executor.registerHandler("device_action", vi.fn());

      const promise = executor.execute(
        { type: "device_action", target: "dev-1", params: {} },
        "rule-1",
        { condition: (state) => state.on === true, timeoutMs: 5000 },
      );

      // Simulate the device state satisfying the predicate
      // The tracker has a pending command — route an observation
      await new Promise((r) => setTimeout(r, 10));
      tracker.observeState("dev-1", { on: true });

      const result = await promise;
      expect(result.success).toBe(true);
      expect(result.lifecycleState).toBe("OBSERVED");
      expect(result.correlationId).toBeDefined();
    });

    it("returns TIMED_OUT when confirmation times out", async () => {
      vi.useFakeTimers();
      const tracker = new PendingCommandTracker();
      const deviceRegistry = { getById: vi.fn().mockReturnValue({ id: "dev-1" }) };
      const deps = createMockDeps({
        deviceRegistry: deviceRegistry as unknown as CommandServiceDeps["deviceRegistry"],
        pendingCommandTracker: tracker,
      });
      const executor = new CommandService(deps);
      executor.registerHandler("device_action", vi.fn());

      const promise = executor.execute(
        { type: "device_action", target: "dev-1", params: {} },
        "rule-1",
        { condition: (state) => state.on === true, timeoutMs: 1000 },
      );

      await vi.advanceTimersByTimeAsync(1001);
      const result = await promise;
      expect(result.success).toBe(false);
      expect(result.lifecycleState).toBe("TIMED_OUT");
      vi.useRealTimers();
    });
  });

  describe("handler returning explicit failure", () => {
    it("returns FAILED with handler error when handler returns success:false", async () => {
      const deps = createMockDeps();
      const executor = new CommandService(deps);
      executor.registerHandler("device_action", async () => ({ success: false, error: "device offline" }));

      const result = await executor.execute(
        { type: "device_action", target: "dev-1", params: {} },
        "rule-1",
      );

      expect(result.success).toBe(false);
      expect(result.lifecycleState).toBe("FAILED");
      expect(result.error).toBe("device offline");
    });

    it("returns dispatch data on successful handler with data", async () => {
      const deps = createMockDeps();
      const executor = new CommandService(deps);
      executor.registerHandler("device_action", async () => ({ success: true, data: { watts: 42 } }));

      const result = await executor.execute(
        { type: "device_action", target: "dev-1", params: {} },
        "rule-1",
      );

      expect(result.success).toBe(true);
      expect(result.lifecycleState).toBe("DISPATCHED");
      expect(result.data).toEqual({ watts: 42 });
    });
  });

  describe("acknowledgement capability flow", () => {
    it("assigns correlation and registers with tracker when ack capability present", async () => {
      vi.useFakeTimers();
      const tracker = new PendingCommandTracker();
      const deviceRegistry = { getById: vi.fn().mockReturnValue({ id: "dev-1" }) };
      const connectorManager = {
        executeAction: vi.fn().mockResolvedValue({ success: true }),
        getAcknowledgementCapability: vi.fn().mockReturnValue({ supported: true, responseTopic: "aeolus/acks/dev-1" }),
      };
      const deps = createMockDeps({
        deviceRegistry: deviceRegistry as unknown as CommandServiceDeps["deviceRegistry"],
        pendingCommandTracker: tracker,
        connectorManager: connectorManager as unknown as CommandServiceDeps["connectorManager"],
      });
      const executor = new CommandService(deps);
      executor.registerHandler("device_action", vi.fn());

      const promise = executor.execute(
        { type: "device_action", target: "dev-1", params: {} },
        "rule-1",
      );

      // Let the handler run
      await vi.advanceTimersByTimeAsync(0);
      expect(tracker.size).toBe(1);

      // Timeout to resolve
      await vi.advanceTimersByTimeAsync(5001);
      const result = await promise;
      expect(result.lifecycleState).toBe("TIMED_OUT");
      expect(result.correlationId).toBeDefined();
      vi.useRealTimers();
    });

    it("uses default ack response topic when capability has no responseTopic", async () => {
      vi.useFakeTimers();
      const tracker = new PendingCommandTracker();
      const deviceRegistry = { getById: vi.fn().mockReturnValue({ id: "dev-1" }) };
      const connectorManager = {
        executeAction: vi.fn().mockResolvedValue({ success: true }),
        getAcknowledgementCapability: vi.fn().mockReturnValue({ supported: true }),
      };
      const deps = createMockDeps({
        deviceRegistry: deviceRegistry as unknown as CommandServiceDeps["deviceRegistry"],
        pendingCommandTracker: tracker,
        connectorManager: connectorManager as unknown as CommandServiceDeps["connectorManager"],
        ackResponseTopicBase: "aeolus/acks",
      });
      const executor = new CommandService(deps);
      executor.registerHandler("device_action", vi.fn());

      const promise = executor.execute(
        { type: "device_action", target: "dev-1", params: {} },
        "rule-1",
      );

      await vi.advanceTimersByTimeAsync(5001);
      const result = await promise;
      expect(result.correlationId).toBeDefined();
      expect(result.lifecycleState).toBe("TIMED_OUT");
      vi.useRealTimers();
    });
  });

  describe("completion logging branches", () => {
    it("logs warn for TIMED_OUT with observedDeviceId and timeout", async () => {
      vi.useFakeTimers();
      const tracker = new PendingCommandTracker();
      const deviceRegistry = { getById: vi.fn().mockReturnValue({ id: "dev-1" }) };
      const loggerMock = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
      const deps = createMockDeps({
        deviceRegistry: deviceRegistry as unknown as CommandServiceDeps["deviceRegistry"],
        pendingCommandTracker: tracker,
        logger: loggerMock as unknown as CommandServiceDeps["logger"],
      });
      const executor = new CommandService(deps);
      executor.registerHandler("device_action", vi.fn());

      const promise = executor.execute(
        { type: "device_action", target: "dev-1", params: {} },
        "rule-1",
        { condition: () => false, timeoutMs: 500 },
      );

      await vi.advanceTimersByTimeAsync(501);
      await promise;

      expect(loggerMock.warn).toHaveBeenCalledWith(
        expect.objectContaining({ lifecycleState: "TIMED_OUT", observedDeviceId: "dev-1", timeoutMs: 500 }),
        expect.stringContaining("TIMED_OUT"),
      );
      vi.useRealTimers();
    });

    it("logs error for FAILED state", async () => {
      const loggerMock = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
      const deps = createMockDeps({ logger: loggerMock as unknown as CommandServiceDeps["logger"] });
      const executor = new CommandService(deps);
      executor.registerHandler("device_action", async () => { throw new Error("boom"); });

      await executor.execute(
        { type: "device_action", target: "dev-1", params: {} },
        "rule-1",
      );

      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({ lifecycleState: "FAILED" }),
        expect.stringContaining("FAILED"),
      );
    });
  });

  describe("no handler returns FAILED with lifecycleState", () => {
    it("reports lifecycleState FAILED when no handler is registered", async () => {
      const deps = createMockDeps();
      const executor = new CommandService(deps);

      const result = await executor.execute(
        { type: "unknown_type", target: "dev-1", params: {} },
        "rule-1",
      );

      expect(result.lifecycleState).toBe("FAILED");
      expect(result.success).toBe(false);
    });
  });
});
