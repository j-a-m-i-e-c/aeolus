// src/simulator/command-router.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import type { Logger } from "pino";
import type { IPublishPacket } from "mqtt";
import { SimulatorCommandRouter } from "./command-router.js";
import { SimulatorDeviceRegistry } from "./device-registry.js";
import { FaultController } from "./fault-controller.js";
import type { SimulatedCommandOutcome, SimulatedInboundCommand } from "./types.js";

function stubLogger(): Logger {
  const noop = (): void => undefined;
  return { info: noop, warn: noop, error: noop, debug: noop } as unknown as Logger;
}

type OutcomeFn = (command: SimulatedInboundCommand) => SimulatedCommandOutcome | Promise<SimulatedCommandOutcome>;

const PUMP_STATE = "switch/reference-water/transfer-pump";
const PUMP_COMMAND = "switch/reference-water/transfer-pump/command";

interface Captured {
  topic: string;
  payload: string;
  options: Record<string, unknown>;
}

function setup(options?: { dedupeTtlMs?: number; nowRef?: { value: number }; maxQueueDepth?: number }) {
  const statePublished: Captured[] = [];
  const ackPublished: Captured[] = [];
  const invocations: string[] = [];
  let outcomeFn: OutcomeFn = () => ({ accepted: true });

  const registry = new SimulatorDeviceRegistry({
    publish: (topic, payload, opts) => statePublished.push({ topic, payload, options: opts }),
    logger: stubLogger(),
    maxDelayMs: 5000,
  });

  registry.register({
    key: "pump",
    name: "Transfer Pump",
    stateTopic: PUMP_STATE,
    commandTopic: PUMP_COMMAND,
    initialState: { on: false, running: false },
    commandProfile: { acknowledgement: { supported: true } },
    createModel: (ctx) => ({
      getState: () => ctx.state.read(),
      onCommand: (command) => {
        invocations.push(command.correlationId ?? "(none)");
        return outcomeFn(command);
      },
    }),
  });

  const nowRef = options?.nowRef ?? { value: 1000 };
  const faults = new FaultController({ maxDelayMs: 5000, logger: stubLogger() });
  const router = new SimulatorCommandRouter({
    registry,
    publish: (topic, payload, opts) => ackPublished.push({ topic, payload, options: opts as Record<string, unknown> }),
    logger: stubLogger(),
    maxDelayMs: 5000,
    faults,
    now: () => nowRef.value,
    ...(options?.dedupeTtlMs !== undefined ? { dedupeTtlMs: options.dedupeTtlMs } : {}),
    ...(options?.maxQueueDepth !== undefined ? { maxQueueDepth: options.maxQueueDepth } : {}),
  });

  return {
    router,
    registry,
    faults,
    statePublished,
    ackPublished,
    invocations,
    nowRef,
    setOutcome: (fn: OutcomeFn) => {
      outcomeFn = fn;
    },
  };
}

const buf = (obj: unknown): Buffer => Buffer.from(JSON.stringify(obj));
const mqtt5 = (correlationId: string, responseTopic: string): IPublishPacket =>
  ({ properties: { correlationData: Buffer.from(correlationId, "utf8"), responseTopic } }) as unknown as IPublishPacket;

afterEach(() => {
  vi.useRealTimers();
});

describe("SimulatorCommandRouter — acknowledgement", () => {
  it("publishes a positive ACK and resulting state for an accepted correlated command", async () => {
    const t = setup();
    t.setOutcome(() => ({ accepted: true, state: { patch: { on: true, running: true } } }));

    await t.router.handleCommand(PUMP_COMMAND, buf({ on: true }), mqtt5("corr-1", "aeolus/acks/pump"));

    expect(t.ackPublished).toHaveLength(1);
    expect(t.ackPublished[0].topic).toBe("aeolus/acks/pump");
    expect(JSON.parse(t.ackPublished[0].payload)).toEqual({ correlationId: "corr-1", success: true });
    expect((t.ackPublished[0].options.correlationData as Buffer).toString("utf8")).toBe("corr-1");

    expect(t.statePublished).toHaveLength(1);
    expect(t.statePublished[0].topic).toBe(PUMP_STATE);
    expect(JSON.parse(t.statePublished[0].payload)).toEqual({ on: true, running: true });
  });

  it("resolves correlation from the JSON payload when no MQTT 5 property is present", async () => {
    const t = setup();
    await t.router.handleCommand(
      PUMP_COMMAND,
      buf({ on: true, correlationId: "json-corr", responseTopic: "aeolus/acks/pump" }),
      undefined,
    );
    expect(t.ackPublished).toHaveLength(1);
    expect(t.ackPublished[0].topic).toBe("aeolus/acks/pump");
    expect(JSON.parse(t.ackPublished[0].payload).correlationId).toBe("json-corr");
  });

  it("gives MQTT 5 properties precedence over mirrored JSON fields", async () => {
    const t = setup();
    await t.router.handleCommand(
      PUMP_COMMAND,
      buf({ correlationId: "json-corr", responseTopic: "aeolus/acks/json" }),
      mqtt5("mqtt5-corr", "aeolus/acks/mqtt5"),
    );
    expect(t.ackPublished[0].topic).toBe("aeolus/acks/mqtt5");
    expect(JSON.parse(t.ackPublished[0].payload).correlationId).toBe("mqtt5-corr");
  });

  it("publishes a negative ACK and no state when the model rejects", async () => {
    const t = setup();
    t.setOutcome(() => ({ accepted: false, error: "interlock open" }));

    await t.router.handleCommand(PUMP_COMMAND, buf({ on: true }), mqtt5("corr-x", "aeolus/acks/pump"));

    expect(t.ackPublished).toHaveLength(1);
    expect(JSON.parse(t.ackPublished[0].payload)).toEqual({
      correlationId: "corr-x",
      success: false,
      error: "interlock open",
    });
    expect(t.statePublished).toHaveLength(0);
  });

  it("treats a thrown model handler as a rejection", async () => {
    const t = setup();
    t.setOutcome(() => {
      throw new Error("model boom");
    });
    await t.router.handleCommand(PUMP_COMMAND, buf({ on: true }), mqtt5("corr-t", "aeolus/acks/pump"));
    expect(JSON.parse(t.ackPublished[0].payload)).toMatchObject({ success: false, error: "model boom" });
    expect(t.statePublished).toHaveLength(0);
  });

  it("runs a dispatch-only command (no correlation) without manufacturing an ACK", async () => {
    const t = setup();
    t.setOutcome(() => ({ accepted: true, state: { patch: { on: true } } }));

    await t.router.handleCommand(PUMP_COMMAND, buf({ on: true }), undefined);

    expect(t.ackPublished).toHaveLength(0);
    expect(t.statePublished).toHaveLength(1);
    expect(t.invocations).toEqual(["(none)"]);
  });

  it("ignores a command on an unknown topic", async () => {
    const t = setup();
    await expect(t.router.handleCommand("switch/unknown/command", buf({ on: true }))).resolves.toBeUndefined();
    expect(t.ackPublished).toHaveLength(0);
    expect(t.statePublished).toHaveLength(0);
  });
});

describe("SimulatorCommandRouter — deduplication", () => {
  it("applies a duplicate correlated command only once and resends the prior ACK", async () => {
    const t = setup();
    t.setOutcome(() => ({ accepted: true, state: { patch: { on: true } } }));

    const packet = mqtt5("dup-1", "aeolus/acks/pump");
    await t.router.handleCommand(PUMP_COMMAND, buf({ on: true }), packet);
    await t.router.handleCommand(PUMP_COMMAND, buf({ on: true }), packet);

    expect(t.invocations).toEqual(["dup-1"]); // model ran once
    expect(t.statePublished).toHaveLength(1); // state applied once
    expect(t.ackPublished).toHaveLength(2); // ACK resent on the duplicate
    expect(t.ackPublished[0].payload).toBe(t.ackPublished[1].payload);
  });

  it("expires a remembered correlation id after the TTL", async () => {
    const nowRef = { value: 1000 };
    const t = setup({ dedupeTtlMs: 1000, nowRef });
    t.setOutcome(() => ({ accepted: true }));

    await t.router.handleCommand(PUMP_COMMAND, buf({}), mqtt5("ttl-1", "aeolus/acks/pump"));
    expect(t.invocations).toEqual(["ttl-1"]);

    nowRef.value = 2500; // beyond the 1000ms TTL
    await t.router.handleCommand(PUMP_COMMAND, buf({}), mqtt5("ttl-1", "aeolus/acks/pump"));
    expect(t.invocations).toEqual(["ttl-1", "ttl-1"]); // re-processed after expiry
  });
});

describe("SimulatorCommandRouter — fault injection", () => {
  it("rejectNext short-circuits the model with a negative ACK and no state", async () => {
    const t = setup();
    t.setOutcome(() => ({ accepted: true, state: { patch: { on: true } } }));
    t.faults.arm("pump", { rejectNext: { reason: "armed reject" } });

    await t.router.handleCommand(PUMP_COMMAND, buf({ on: true }), mqtt5("f1", "aeolus/acks/pump"));

    expect(t.invocations).toEqual([]); // model never ran
    expect(JSON.parse(t.ackPublished[0].payload)).toMatchObject({ success: false, error: "armed reject" });
    expect(t.statePublished).toHaveLength(0);
    // One-shot: the next command runs normally.
    await t.router.handleCommand(PUMP_COMMAND, buf({ on: true }), mqtt5("f1b", "aeolus/acks/pump"));
    expect(t.invocations).toEqual(["f1b"]);
  });

  it("dropNextAck suppresses the ACK but still applies state (drives an ACK timeout)", async () => {
    const t = setup();
    t.setOutcome(() => ({ accepted: true, state: { patch: { on: true } } }));
    t.faults.arm("pump", { dropNextAck: true });

    await t.router.handleCommand(PUMP_COMMAND, buf({ on: true }), mqtt5("f2", "aeolus/acks/pump"));

    expect(t.ackPublished).toHaveLength(0);
    expect(t.statePublished).toHaveLength(1);
  });

  it("suppressNextState publishes the ACK but no resulting state", async () => {
    const t = setup();
    t.setOutcome(() => ({ accepted: true, state: { patch: { on: true } } }));
    t.faults.arm("pump", { suppressNextState: true });

    await t.router.handleCommand(PUMP_COMMAND, buf({ on: true }), mqtt5("f3", "aeolus/acks/pump"));

    expect(t.ackPublished).toHaveLength(1);
    expect(JSON.parse(t.ackPublished[0].payload).success).toBe(true);
    expect(t.statePublished).toHaveLength(0);
  });

  it("mismatchNextState publishes a wrong state (drives a state mismatch)", async () => {
    const t = setup();
    t.setOutcome(() => ({ accepted: true, state: { patch: { on: true, running: true } } }));
    t.faults.arm("pump", { mismatchNextState: { on: false, running: false } });

    await t.router.handleCommand(PUMP_COMMAND, buf({ on: true }), mqtt5("f4", "aeolus/acks/pump"));

    expect(t.statePublished).toHaveLength(1);
    expect(JSON.parse(t.statePublished[0].payload)).toMatchObject({ on: false, running: false });
  });
});

describe("SimulatorCommandRouter — serialization and delays", () => {
  it("serializes command handling per device", async () => {
    const t = setup();
    let releaseFirst: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    t.setOutcome(async (command) => {
      if (command.correlationId === "s1") await gate;
      return { accepted: true };
    });

    const p1 = t.router.handleCommand(PUMP_COMMAND, buf({}), mqtt5("s1", "aeolus/acks/pump"));
    const p2 = t.router.handleCommand(PUMP_COMMAND, buf({}), mqtt5("s2", "aeolus/acks/pump"));

    await new Promise((resolve) => setImmediate(resolve));
    expect(t.invocations).toEqual(["s1"]); // second command waits its turn

    releaseFirst();
    await Promise.all([p1, p2]);
    expect(t.invocations).toEqual(["s1", "s2"]);
  });

  it("delays the ACK independently and clamps it to the maximum", async () => {
    vi.useFakeTimers();
    const t = setup();
    t.setOutcome(() => ({ accepted: true, acknowledgement: { delayMs: 60000 } })); // clamped to 5000

    const pending = t.router.handleCommand(PUMP_COMMAND, buf({}), mqtt5("d1", "aeolus/acks/pump"));

    await vi.advanceTimersByTimeAsync(4999);
    expect(t.ackPublished).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(t.ackPublished).toHaveLength(1);
  });

  it("fails fast when the per-device command queue is full", async () => {
    const t = setup({ maxQueueDepth: 1 });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    t.setOutcome(async () => {
      await gate;
      return { accepted: true };
    });

    // First command occupies the queue (blocked on the gate).
    const p1 = t.router.handleCommand(PUMP_COMMAND, buf({}), mqtt5("q1", "aeolus/acks/pump"));
    // Second command is dropped fail-fast (depth already at the cap of 1).
    const p2 = t.router.handleCommand(PUMP_COMMAND, buf({}), mqtt5("q2", "aeolus/acks/pump"));

    await new Promise((resolve) => setImmediate(resolve));
    expect(t.invocations).toEqual(["q1"]); // only the first was accepted into the queue

    release();
    await Promise.all([p1, p2]);
    expect(t.invocations).toEqual(["q1"]); // q2 never processed
  });

  it("delays the resulting state independently of the ACK", async () => {
    vi.useFakeTimers();
    const t = setup();
    t.setOutcome(() => ({ accepted: true, state: { patch: { running: true }, delayMs: 500 } }));

    await t.router.handleCommand(PUMP_COMMAND, buf({ on: true }), mqtt5("d2", "aeolus/acks/pump"));

    expect(t.ackPublished).toHaveLength(1); // ACK immediate
    expect(t.statePublished).toHaveLength(0); // state still pending

    await vi.advanceTimersByTimeAsync(500);
    expect(t.statePublished).toHaveLength(1);
    expect(JSON.parse(t.statePublished[0].payload)).toEqual({ on: false, running: true });
  });
});
