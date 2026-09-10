// src/automations/command-service.execution-context.test.ts
// phase-1-runtime-foundations Task 7 — commands issued inside an automation
// execution are stamped with executionId + causationId, with no cross-execution
// leakage under concurrency (Checkpoint 7).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { initSchema } from "../db/database.js";
import { CommandService, type CommandServiceDeps, automationSource } from "./command-service.js";
import { CommandHistoryStore } from "./command-history-store.js";
import { runInExecutionContext, currentExecutionContext } from "./execution-context.js";

vi.mock("../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

let db: DatabaseType;
let store: CommandHistoryStore;

function buildService(): CommandService {
  const deps = {
    mqttService: { isConnected: () => true, publish: vi.fn() },
    connectorManager: { executeAction: vi.fn().mockResolvedValue({ success: true }), getAcknowledgementCapability: () => undefined },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    commandHistoryStore: store,
    executionContext: { current: () => currentExecutionContext() },
  } as unknown as CommandServiceDeps;
  const svc = new CommandService(deps);
  // Delay so two concurrent executions interleave across the event loop.
  svc.registerHandler("device_action", async () => {
    await new Promise((r) => setTimeout(r, 5));
    return { success: true };
  });
  return svc;
}

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  store = new CommandHistoryStore(db);
});

afterEach(() => db.close());

describe("CommandService execution-context stamping (Req 5.6, 5.7)", () => {
  it("stamps executionId and causationId from the active execution", async () => {
    const svc = buildService();
    const result = await runInExecutionContext(
      { executionId: "X1", causationId: "E1", automationId: "rule-A" },
      () => svc.execute({ type: "device_action", target: "dev-1", params: {} }, automationSource("rule-A")),
    );
    const rec = store.get(result.commandId!);
    expect(rec?.executionId).toBe("X1");
    expect(rec?.causationId).toBe("E1");
    expect(rec?.ruleId).toBe("rule-A");
  });

  it("does not leak execution identity across concurrent executions", async () => {
    const svc = buildService();
    const [r1, r2] = await Promise.all([
      runInExecutionContext(
        { executionId: "X1", causationId: "E1", automationId: "A" },
        () => svc.execute({ type: "device_action", target: "dev-1", params: {} }, automationSource("A")),
      ),
      runInExecutionContext(
        { executionId: "X2", causationId: "E2", automationId: "B" },
        () => svc.execute({ type: "device_action", target: "dev-2", params: {} }, automationSource("B")),
      ),
    ]);

    const rec1 = store.get(r1.commandId!);
    const rec2 = store.get(r2.commandId!);
    expect(rec1).toMatchObject({ executionId: "X1", causationId: "E1", targetDeviceId: "dev-1" });
    expect(rec2).toMatchObject({ executionId: "X2", causationId: "E2", targetDeviceId: "dev-2" });
  });

  it("issues no execution stamp for a command outside any execution", async () => {
    const svc = buildService();
    const result = await svc.execute(
      { type: "device_action", target: "dev-1", params: {} },
      automationSource("rule-A"),
    );
    const rec = store.get(result.commandId!);
    expect(rec?.executionId).toBeUndefined();
    expect(rec?.causationId).toBeUndefined();
  });
});

describe("CommandService trigger provenance (showcase-cleanup §2.7)", () => {
  it("stamps the trigger topic, which every execution has", async () => {
    const svc = buildService();
    const result = await runInExecutionContext(
      { executionId: "X1", automationId: "rule-A", triggerTopic: "sensor/mine/gas" },
      () => svc.execute({ type: "device_action", target: "dev-1", params: {} }, automationSource("rule-A")),
    );
    expect(store.get(result.commandId!)?.triggerTopic).toBe("sensor/mine/gas");
  });

  it("stamps the originator's kind and id when the trigger carried metadata", async () => {
    const svc = buildService();
    const result = await runInExecutionContext(
      {
        executionId: "X1",
        automationId: "rule-A",
        triggerTopic: "sensor/mine/gas",
        triggerMeta: {
          eventId: "evt-1",
          timestamp: 1,
          source: { kind: "mqtt-device", id: "gas-sensor-3" },
          traceId: "evt-1",
          depth: 0,
        },
      },
      () => svc.execute({ type: "device_action", target: "dev-1", params: {} }, automationSource("rule-A")),
    );

    const rec = store.get(result.commandId!);
    expect(rec?.triggerKind).toBe("mqtt-device");
    expect(rec?.triggerId).toBe("gas-sensor-3");
  });

  it("records the topic alone for an operator fire, which carries no metadata", async () => {
    // The manual/operator fire path builds its context without event metadata, so an
    // absent kind is the normal case for exactly the executions a visitor is most
    // likely to be looking at. Claiming a kind here would mean inventing one.
    const svc = buildService();
    const result = await runInExecutionContext(
      { executionId: "X1", automationId: "rule-A", triggerTopic: "ui/rule-A/run-cue" },
      () => svc.execute({ type: "device_action", target: "dev-1", params: {} }, automationSource("rule-A")),
    );

    const rec = store.get(result.commandId!);
    expect(rec?.triggerTopic).toBe("ui/rule-A/run-cue");
    expect(rec?.triggerKind).toBeUndefined();
    expect(rec?.triggerId).toBeUndefined();
  });

  it("stamps every command of one execution with the same trigger", async () => {
    // What makes a group able to name its cause from any member.
    const svc = buildService();
    const [a, b] = await runInExecutionContext(
      { executionId: "X1", automationId: "rule-A", triggerTopic: "ui/rule-A/run-cue" },
      async () => [
        await svc.execute({ type: "device_action", target: "dmx-1", params: {} }, automationSource("rule-A")),
        await svc.execute({ type: "device_action", target: "fx-1", params: {} }, automationSource("rule-A")),
      ],
    );

    expect(store.get(a!.commandId!)?.triggerTopic).toBe("ui/rule-A/run-cue");
    expect(store.get(b!.commandId!)?.triggerTopic).toBe("ui/rule-A/run-cue");
    expect(store.listForExecution("X1", "rule-A")).toHaveLength(2);
  });

  it("records no trigger for a command issued outside any execution", async () => {
    const svc = buildService();
    const result = await svc.execute(
      { type: "device_action", target: "dev-1", params: {} },
      automationSource("rule-A"),
    );

    const rec = store.get(result.commandId!);
    expect(rec?.triggerTopic).toBeUndefined();
    expect(rec?.triggerKind).toBeUndefined();
  });
});
