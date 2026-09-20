// Item 21 of the Build 48 definition of done, automated (ADR-0016).
//
// The defect was found by watching a real broker, so the fix is checked the same way.
// A Raspberry Pi run with `mosquitto_sub -t '#' -v` showed this, every few seconds:
//
//   sensor/bunker/supplies                              {"waterLitres":7442,...}
//   aeolus/events/<power-rule-id>/bunker/summary/power   {..."waterLitres":7442,...}
//
// The second line is the Bunker Overview being handed a number it already had. This
// test reproduces the exact first line and asserts the second no longer exists.
//
// Nothing here is a double. A throwaway mosquitto container is the broker, a raw
// wildcard subscriber is the observer, and the automation under test is the REAL
// compiled `bunker-power` Automation Project running in a REAL isolated-vm sandbox
// with the REAL SharedStateStore and AutomationEventService behind it. The point is
// that the only way to pass is for no summary to reach the wire — a mocked MQTT
// client could be satisfied by a store that simply forgot to publish.
//
// It also guards the failure mode the spec calls out: quieting `aeolus/events/...`
// by opening `aeolus/shared-state/...` instead would fix nothing, so the assertion
// is on EVERY topic the broker relays, not on one prefix.
//
// Needs Docker, and skips without it, matching the other broker-backed tests.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import mqtt, { type MqttClient } from "mqtt";
import type { Database as DatabaseType } from "better-sqlite3";
import { Sandbox } from "../automations/sandbox.js";
import { SharedStateStore } from "../shared-state/shared-state-store.js";
import { AutomationEventService } from "../automations/automation-event-service.js";
import { AutomationStateStore } from "../automations/automation-state-store.js";
import { compileAutomationProject } from "../automations/automation-project.js";
import { runInExecutionContext } from "../automations/execution-context.js";
import { loadProject } from "../../demo/seed/project-loader.mjs";
import { createTestDatabase } from "../__test-helpers__/index.js";
import { startDockerBroker, dockerAvailable, waitFor, type DockerBroker } from "./simulator-harness.js";
import logger from "../logger.js";
import type { ActionResult, Device } from "../core/types.js";

const describeE2E = dockerAvailable() ? describe : describe.skip;

const RULE_ID = "bunker-power-rule";

/**
 * The bunker's power hardware, as the Device Registry would report it.
 *
 * Battery is deliberately well above the 30% reserve so the Logic takes the plain
 * projection path and issues no generator command — this test is about reporting,
 * not actuation.
 */
const DEVICES: Device[] = [
  {
    id: "sensor-bunker-power", name: "Power", type: "sensor", capabilities: [],
    topic: "sensor/bunker/power", integration: "mqtt", lastSeen: 1,
    state: { battery: 74, solarW: 1800, loadW: 1200, netW: 600 },
  },
  {
    id: "sensor-bunker-supplies", name: "Supplies", type: "sensor", capabilities: [],
    topic: "sensor/bunker/supplies", integration: "mqtt", lastSeen: 1,
    // The very reading from the Pi trace.
    state: { waterLitres: 7442, occupants: 4, foodDays: 64, beans: 312, bunks: 6, medicalCheckedDaysAgo: 12 },
  },
  {
    id: "switch-bunker-generator", name: "Generator", type: "switch", capabilities: ["on/off"],
    topic: "switch/bunker/generator/state", integration: "mqtt", lastSeen: 1,
    state: { on: false, fuel: 62, outputW: 0 },
  },
] as Device[];

describeE2E("Shared State never reaches the broker (real mosquitto)", () => {
  let broker: DockerBroker;
  let compiledJs: string;

  let db: DatabaseType;
  let eventBus: EventEmitter;
  let sharedState: SharedStateStore;
  let stateStore: AutomationStateStore;
  let observer: MqttClient;
  let publisher: MqttClient;
  /** Every topic the broker relayed to a `#` subscriber. */
  let seen: Array<{ topic: string; payload: string }>;

  beforeAll(async () => {
    broker = await startDockerBroker();
    // The production compiler over the real project tree, so what runs in the
    // isolate is what a deployment would run.
    ({ compiledJs } = await compileAutomationProject(loadProject("bunker-power")));
  }, 180000);

  afterAll(() => {
    broker?.stop();
  });

  beforeEach(async () => {
    db = createTestDatabase();
    eventBus = new EventEmitter();
    sharedState = new SharedStateStore(db, eventBus);
    stateStore = new AutomationStateStore(db);
    stateStore.loadFromDb();
    seen = [];

    const url = `mqtt://127.0.0.1:${broker.port}`;
    observer = mqtt.connect(url, { protocolVersion: 5 });
    publisher = mqtt.connect(url, { protocolVersion: 5 });
    await Promise.all([
      new Promise<void>((r) => observer.once("connect", () => r())),
      new Promise<void>((r) => publisher.once("connect", () => r())),
    ]);
    observer.on("message", (topic, payload) => seen.push({ topic, payload: payload.toString() }));
    await new Promise<void>((resolve, reject) =>
      observer.subscribe("#", { qos: 1 }, (err) => (err ? reject(err) : resolve())),
    );
  }, 30000);

  afterEach(async () => {
    await Promise.all([
      new Promise<void>((r) => observer.end(true, {}, () => r())),
      new Promise<void>((r) => publisher.end(true, {}, () => r())),
    ]);
    db.close();
  });

  /** A real AutomationEventService publishing to the real broker. */
  function makeEventService(): AutomationEventService {
    return new AutomationEventService({
      // Narrow to what the service uses: a real publish onto the live connection.
      mqttService: {
        publish: (topic: string, payload: string) => {
          publisher.publish(topic, payload, { qos: 1 });
        },
      } as never,
      logger,
    });
  }

  function makeSandbox(): Sandbox {
    return new Sandbox({
      commandService: {
        execute: async (): Promise<ActionResult> =>
          ({ success: true, lifecycleState: "DISPATCHED", commandId: "cmd-1" }),
      } as never,
      deviceRegistry: { getAll: () => DEVICES } as never,
      stateStore,
      sharedStateStore: sharedState,
      automationEventService: makeEventService(),
    });
  }

  /** Run authored Logic the way the engine does, inside an execution context. */
  async function runLogic(js: string, topic: string) {
    return runInExecutionContext(
      { automationId: RULE_ID, executionId: "exec-1", triggerMeta: { depth: 0 } } as never,
      () => makeSandbox().execute(js, { topic, deviceId: "", state: {}, timestamp: Date.now() }, RULE_ID),
    );
  }

  it("relays the device reading but no summary, running the real bunker-power project", async () => {
    // The stimulus from the trace: the supplies sensor reports.
    publisher.publish("sensor/bunker/supplies", JSON.stringify({ waterLitres: 7442, occupants: 4 }), { qos: 1 });
    await waitFor(() => seen.some((m) => m.topic === "sensor/bunker/supplies"), {
      label: "device telemetry reaches the broker",
    });

    const result = await runLogic(compiledJs, "sensor/bunker/power");
    expect(result.success, `Logic failed: ${result.error ?? ""}`).toBe(true);

    // The summary was produced — without this the silence below would be vacuous,
    // satisfied by Logic that simply did nothing.
    expect(sharedState.get("bunker-summary", "power")).toMatchObject({
      battery: 74, waterLitres: 7442, occupants: 4,
    });

    // Give anything the execution might publish time to land, rather than asserting
    // on a race. A false pass here is the only way this test could mislead.
    await new Promise((r) => setTimeout(r, 400));

    // Device telemetry still flows. The broker is working; it simply has no summary.
    expect(seen.map((m) => m.topic)).toContain("sensor/bunker/supplies");

    const summaries = seen.filter((m) => /summary/i.test(m.topic) || /summary/i.test(m.payload));
    expect(
      summaries.map((m) => m.topic),
      "a current snapshot reached the broker",
    ).toEqual([]);
  }, 30000);

  it("opens no replacement namespace for Shared State", async () => {
    await runLogic(compiledJs, "sensor/bunker/power");
    sharedState.set("mine-summary", "atmosphere", { ch4: 0.42 });
    sharedState.delete("mine-summary", "atmosphere");
    await new Promise((r) => setTimeout(r, 400));

    // The spec's explicit trap: moving the same traffic to another prefix.
    for (const forbidden of [/^aeolus\/shared-state\//, /^aeolus\/buckets\//, /^aeolus\/state\//]) {
      expect(seen.filter((m) => forbidden.test(m.topic)).map((m) => m.topic)).toEqual([]);
    }
    // A write and a delete, and the broker heard neither.
    expect(seen.filter((m) => m.topic.includes("mine-summary"))).toEqual([]);
  }, 30000);

  it("still carries a genuine Automation Event, so silence is not just a broken publisher", async () => {
    // The control. If `events.emit()` were also silent here, the assertions above
    // would prove nothing about Shared State — only that this wiring cannot publish.
    const event = await compileAutomationProject({
      files: [{
        path: "logic/index.ts",
        content: `export default async function run() {
          shared.set("bunker-summary", "power", { battery: 74 });
          events.emit("generator-started", { reason: "low reserve" });
        }`,
      }],
      logicEntry: "logic/index.ts",
    } as never);

    const result = await runLogic(event.compiledJs, "sensor/bunker/power");
    expect(result.success, `Logic failed: ${result.error ?? ""}`).toBe(true);

    await waitFor(() => seen.some((m) => m.topic.includes("generator-started")), {
      label: "a real Automation Event reaches the broker",
    });

    const emitted = seen.find((m) => m.topic.includes("generator-started"))!;
    // Real events keep the reserved namespace and their occurrence semantics.
    expect(emitted.topic).toBe(`aeolus/events/${RULE_ID}/generator-started`);
    expect(JSON.parse(emitted.payload)).toMatchObject({ name: "generator-started" });

    // And the Shared State write in the SAME execution stayed off the wire.
    expect(sharedState.get("bunker-summary", "power")).toEqual({ battery: 74 });
    expect(seen.filter((m) => m.topic.includes("summary"))).toEqual([]);
  }, 30000);
});
