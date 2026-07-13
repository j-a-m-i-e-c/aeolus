import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ActionExecutor,
  type ActionDescriptor,
  type ActionExecutorDeps,
  handlePublish,
  handleToggle,
  handleDeviceAction,
  handleLog,
  handleDelay,
  handleWebhook,
} from "./action-executor.js";

function createMockDeps(): ActionExecutorDeps {
  return {
    mqttService: {
      isConnected: vi.fn().mockReturnValue(true),
      publish: vi.fn(),
    } as unknown as ActionExecutorDeps["mqttService"],
    connectorManager: {
      executeAction: vi.fn(),
    } as unknown as ActionExecutorDeps["connectorManager"],
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as ActionExecutorDeps["logger"],
  };
}

describe("ActionExecutor", () => {
  let executor: ActionExecutor;
  let deps: ActionExecutorDeps;

  beforeEach(() => {
    deps = createMockDeps();
    executor = new ActionExecutor(deps);
  });

  describe("dispatching to correct handler", () => {
    it("dispatches mqtt_publish action to its registered handler", async () => {
      const handler = vi.fn();
      executor.registerHandler("mqtt_publish", handler);

      const action: ActionDescriptor = {
        type: "mqtt_publish",
        target: "home/lights/living",
        params: { payload: "on" },
      };

      await executor.execute(action, "rule-1");

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(action, "rule-1", deps);
    });

    it("dispatches http_webhook action to its registered handler", async () => {
      const handler = vi.fn();
      executor.registerHandler("http_webhook", handler);

      const action: ActionDescriptor = {
        type: "http_webhook",
        target: "https://example.com/hook",
        params: { method: "POST", body: '{"alert":true}' },
      };

      await executor.execute(action, "rule-2");

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(action, "rule-2", deps);
    });

    it("dispatches device_command action to its registered handler", async () => {
      const handler = vi.fn();
      executor.registerHandler("device_command", handler);

      const action: ActionDescriptor = {
        type: "device_command",
        target: "device-abc",
        params: { actionType: "toggle", brightness: 80 },
      };

      await executor.execute(action, "rule-3");

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(action, "rule-3", deps);
    });

    it("does not call other handlers when dispatching a specific type", async () => {
      const mqttHandler = vi.fn();
      const webhookHandler = vi.fn();
      const deviceHandler = vi.fn();

      executor.registerHandler("mqtt_publish", mqttHandler);
      executor.registerHandler("http_webhook", webhookHandler);
      executor.registerHandler("device_command", deviceHandler);

      const action: ActionDescriptor = {
        type: "mqtt_publish",
        target: "sensors/temp",
        params: { payload: "22.5" },
      };

      await executor.execute(action, "rule-4");

      expect(mqttHandler).toHaveBeenCalledOnce();
      expect(webhookHandler).not.toHaveBeenCalled();
      expect(deviceHandler).not.toHaveBeenCalled();
    });
  });

  describe("unknown action type", () => {
    it("logs a warning when action type has no registered handler", async () => {
      const action: ActionDescriptor = {
        type: "unknown_action",
        target: "somewhere",
        params: {},
      };

      await executor.execute(action, "rule-5");

      expect(deps.logger.warn).toHaveBeenCalledWith(
        { ruleId: "rule-5", actionType: "unknown_action" },
        expect.stringContaining("No handler for action type"),
      );
    });

    it("does not dispatch to any handler for unknown action type", async () => {
      const mqttHandler = vi.fn();
      const webhookHandler = vi.fn();
      const deviceHandler = vi.fn();

      executor.registerHandler("mqtt_publish", mqttHandler);
      executor.registerHandler("http_webhook", webhookHandler);
      executor.registerHandler("device_command", deviceHandler);

      const action: ActionDescriptor = {
        type: "nonexistent_type",
        target: "target",
        params: {},
      };

      await executor.execute(action, "rule-6");

      expect(mqttHandler).not.toHaveBeenCalled();
      expect(webhookHandler).not.toHaveBeenCalled();
      expect(deviceHandler).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("logs error and does not throw when handler throws", async () => {
      const failingHandler = vi.fn().mockRejectedValue(new Error("handler boom"));
      executor.registerHandler("fail", failingHandler);

      const action: ActionDescriptor = { type: "fail", target: "t", params: {} };
      await executor.execute(action, "rule-err");

      expect(deps.logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ ruleId: "rule-err", actionType: "fail" }),
        expect.stringContaining("Action execution failed"),
      );
    });
  });

  describe("executeSequence", () => {
    it("executes multiple actions in order", async () => {
      const order: string[] = [];
      executor.registerHandler("a", vi.fn(() => { order.push("a"); }));
      executor.registerHandler("b", vi.fn(() => { order.push("b"); }));

      await executor.executeSequence(
        [
          { type: "a", target: "t1", params: {} },
          { type: "b", target: "t2", params: {} },
        ],
        "rule-seq",
      );

      expect(order).toEqual(["a", "b"]);
    });

    it("continues executing after individual failure", async () => {
      executor.registerHandler("fail", vi.fn().mockRejectedValue(new Error("boom")));
      const okHandler = vi.fn();
      executor.registerHandler("ok", okHandler);

      await executor.executeSequence(
        [
          { type: "fail", target: "t1", params: {} },
          { type: "ok", target: "t2", params: {} },
        ],
        "rule-seq2",
      );

      expect(okHandler).toHaveBeenCalledOnce();
    });
  });

  describe("unregisterHandler", () => {
    it("removes a registered handler", async () => {
      const handler = vi.fn();
      executor.registerHandler("temp", handler);
      executor.unregisterHandler("temp");

      await executor.execute({ type: "temp", target: "t", params: {} }, "rule-unreg");
      expect(handler).not.toHaveBeenCalled();
      expect(deps.logger.warn).toHaveBeenCalled();
    });
  });
});

// ── Built-in handler tests ──────────────────────────────────────────────────

describe("handlePublish", () => {
  let deps: ActionExecutorDeps;

  beforeEach(() => {
    deps = createMockDeps();
  });

  it("publishes string payload to MQTT topic", () => {
    (deps.mqttService.isConnected as any).mockReturnValue(true);
    const action: ActionDescriptor = { type: "publish", target: "home/lights", params: { payload: "on" } };
    handlePublish(action, "rule-p1", deps);
    expect(deps.mqttService.publish).toHaveBeenCalledWith("home/lights", "on");
  });

  it("JSON-stringifies non-string payload", () => {
    (deps.mqttService.isConnected as any).mockReturnValue(true);
    const action: ActionDescriptor = { type: "publish", target: "home/data", params: { payload: { temp: 22 } } };
    handlePublish(action, "rule-p2", deps);
    expect(deps.mqttService.publish).toHaveBeenCalledWith("home/data", '{"temp":22}');
  });

  it("throws when MQTT is not connected", () => {
    (deps.mqttService.isConnected as any).mockReturnValue(false);
    const action: ActionDescriptor = { type: "publish", target: "topic", params: { payload: "x" } };
    expect(() => handlePublish(action, "rule-p3", deps)).toThrow("MQTT client not connected");
    expect(deps.logger.error).toHaveBeenCalled();
  });
});

describe("handleToggle", () => {
  let deps: ActionExecutorDeps;

  beforeEach(() => {
    deps = createMockDeps();
  });

  it("calls connectorManager.executeAction with toggle type", async () => {
    const action: ActionDescriptor = { type: "toggle", target: "device-1", params: { brightness: 100 } };
    await handleToggle(action, "rule-t1", deps);
    expect(deps.connectorManager.executeAction).toHaveBeenCalledWith("device-1", {
      type: "toggle",
      deviceId: "device-1",
      params: { brightness: 100 },
    });
  });
});

describe("handleDeviceAction", () => {
  let deps: ActionExecutorDeps;

  beforeEach(() => {
    deps = createMockDeps();
  });

  it("uses actionType from params", async () => {
    const action: ActionDescriptor = { type: "device_action", target: "dev-2", params: { actionType: "brightness", level: 50 } };
    await handleDeviceAction(action, "rule-da1", deps);
    expect(deps.connectorManager.executeAction).toHaveBeenCalledWith("dev-2", {
      type: "brightness",
      deviceId: "dev-2",
      params: { actionType: "brightness", level: 50 },
    });
  });

  it("defaults to 'unknown' when actionType is not a string", async () => {
    const action: ActionDescriptor = { type: "device_action", target: "dev-3", params: { actionType: 123 } };
    await handleDeviceAction(action, "rule-da2", deps);
    expect(deps.connectorManager.executeAction).toHaveBeenCalledWith("dev-3", {
      type: "unknown",
      deviceId: "dev-3",
      params: { actionType: 123 },
    });
  });
});

describe("handleLog", () => {
  let deps: ActionExecutorDeps;

  beforeEach(() => {
    deps = createMockDeps();
  });

  it("logs string message", () => {
    const action: ActionDescriptor = { type: "log", target: "", params: { message: "hello world" } };
    handleLog(action, "rule-l1", deps);
    expect(deps.logger.info).toHaveBeenCalledWith(
      { ruleId: "rule-l1", message: "hello world" },
      expect.stringContaining("hello world"),
    );
  });

  it("JSON-stringifies non-string message", () => {
    const action: ActionDescriptor = { type: "log", target: "", params: { message: { key: "val" } } };
    handleLog(action, "rule-l2", deps);
    expect(deps.logger.info).toHaveBeenCalledWith(
      { ruleId: "rule-l2", message: '{"key":"val"}' },
      expect.stringContaining('{"key":"val"}'),
    );
  });
});

describe("handleDelay", () => {
  let deps: ActionExecutorDeps;

  beforeEach(() => {
    deps = createMockDeps();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("delays for specified duration", async () => {
    const action: ActionDescriptor = { type: "delay", target: "", params: { duration: 100 } };
    const promise = handleDelay(action, "rule-d1", deps);
    vi.advanceTimersByTime(100);
    await promise;
  });

  it("treats zero duration as no-op and logs warning", async () => {
    const action: ActionDescriptor = { type: "delay", target: "", params: { duration: 0 } };
    await handleDelay(action, "rule-d2", deps);
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ ruleId: "rule-d2" }),
      expect.stringContaining("zero/negative"),
    );
  });

  it("treats negative duration as no-op", async () => {
    const action: ActionDescriptor = { type: "delay", target: "", params: { duration: -5 } };
    await handleDelay(action, "rule-d3", deps);
    expect(deps.logger.warn).toHaveBeenCalled();
  });

  it("defaults to 0 when duration is not a number", async () => {
    const action: ActionDescriptor = { type: "delay", target: "", params: { duration: "abc" } };
    await handleDelay(action, "rule-d4", deps);
    expect(deps.logger.warn).toHaveBeenCalled();
  });
});

describe("handleWebhook", () => {
  let deps: ActionExecutorDeps;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    deps = createMockDeps();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends POST request by default", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const action: ActionDescriptor = { type: "webhook", target: "https://example.com/hook", params: { body: '{"alert":true}' } };
    await handleWebhook(action, "rule-w1", deps);
    expect(globalThis.fetch).toHaveBeenCalledWith("https://example.com/hook", {
      method: "POST",
      headers: {},
      body: '{"alert":true}',
    });
  });

  it("uses specified method and headers", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const action: ActionDescriptor = {
      type: "webhook",
      target: "https://api.example.com",
      params: { method: "PUT", headers: { Authorization: "Bearer token" }, body: "data" },
    };
    await handleWebhook(action, "rule-w2", deps);
    expect(globalThis.fetch).toHaveBeenCalledWith("https://api.example.com", {
      method: "PUT",
      headers: { Authorization: "Bearer token" },
      body: "data",
    });
  });

  it("throws when response is not ok", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: "Internal Server Error" });
    const action: ActionDescriptor = { type: "webhook", target: "https://fail.com", params: {} };
    await expect(handleWebhook(action, "rule-w3", deps)).rejects.toThrow("Webhook returned 500");
  });

  it("sends undefined body when no body param", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const action: ActionDescriptor = { type: "webhook", target: "https://example.com", params: {} };
    await handleWebhook(action, "rule-w4", deps);
    expect(globalThis.fetch).toHaveBeenCalledWith("https://example.com", {
      method: "POST",
      headers: {},
      body: undefined,
    });
  });
});
