// Guards the per-rung evidence recorded on command transitions.
//
// `command_transitions.details` is durable and, through an automation's own
// projection, operator-visible. These tests hold the line that it is built from a
// named shape and that an empty result stays NULL, so "no evidence recorded" never
// becomes indistinguishable from "recorded, and it was empty".

import { describe, expect, it } from "vitest";
import { buildCommandEvidence, describeRung } from "./command-lifecycle.js";
import type { CommandLifecycleState } from "../core/types.js";

const ALL_STATES: CommandLifecycleState[] = [
  "REQUESTED",
  "DISPATCHED",
  "ACKNOWLEDGED",
  "OBSERVED",
  "FAILED",
  "TIMED_OUT",
  "STATE_MISMATCH",
];

describe("buildCommandEvidence", () => {
  it("returns undefined when nothing is known", () => {
    expect(buildCommandEvidence({})).toBeUndefined();
  });

  it("drops an empty reason rather than recording a blank explanation", () => {
    expect(buildCommandEvidence({ reason: "" })).toBeUndefined();
  });

  it("keeps only the parts that were supplied", () => {
    expect(buildCommandEvidence({ tier: "observed", reason: "waiting" })).toEqual({
      tier: "observed",
      reason: "waiting",
    });
  });

  it("carries the whole contract when a command must prove an observation", () => {
    expect(
      buildCommandEvidence({
        tier: "observed",
        observedDeviceId: "flow-1",
        condition: { field: "litresPerMinute", op: "gt", value: 0 },
        timeoutMs: 8000,
        reason: "Command accepted into the pipeline",
      }),
    ).toEqual({
      tier: "observed",
      observedDeviceId: "flow-1",
      condition: { field: "litresPerMinute", op: "gt", value: 0 },
      timeoutMs: 8000,
      reason: "Command accepted into the pipeline",
    });
  });

  it("preserves a zero timeout, which is a real bound rather than a missing one", () => {
    expect(buildCommandEvidence({ timeoutMs: 0 })).toEqual({ timeoutMs: 0 });
  });
});

describe("describeRung", () => {
  // A new lifecycle state must not be addable without deciding what it tells an
  // operator, so every state is required to have an account.
  it.each(ALL_STATES)("has a non-empty account of %s", (state) => {
    expect(describeRung(state).length).toBeGreaterThan(0);
  });

  it("prefers the device's own account of a failure to the generic label", () => {
    const generic = describeRung("FAILED");
    expect(describeRung("FAILED", "pump reported overcurrent")).toBe("pump reported overcurrent");
    expect(describeRung("FAILED", "pump reported overcurrent")).not.toBe(generic);
  });

  it("falls back to the generic label when the error is absent or empty", () => {
    expect(describeRung("TIMED_OUT", "")).toBe(describeRung("TIMED_OUT"));
    expect(describeRung("TIMED_OUT", undefined)).toBe(describeRung("TIMED_OUT"));
  });

  it("distinguishes a timeout from a contradiction", () => {
    // These are different physical situations: nothing replied, versus the device
    // replied with something that disproves the command.
    expect(describeRung("TIMED_OUT")).not.toBe(describeRung("STATE_MISMATCH"));
  });
});

// ── Service-level: evidence that a real command flow records real rungs ───────

import { afterEach, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { initSchema } from "../db/database.js";
import { CommandService, type CommandServiceDeps, restSource } from "./command-service.js";
import { CommandHistoryStore } from "./command-history-store.js";
import { PendingCommandTracker } from "./pending-command-tracker.js";

vi.mock("../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

let db: DatabaseType;
let store: CommandHistoryStore;

function deps(overrides?: Partial<CommandServiceDeps>): CommandServiceDeps {
  return {
    mqttService: { isConnected: vi.fn().mockReturnValue(true), publish: vi.fn() } as unknown as CommandServiceDeps["mqttService"],
    connectorManager: {
      executeAction: vi.fn().mockResolvedValue({ success: true }),
      getAcknowledgementCapability: vi.fn().mockReturnValue(undefined),
    } as unknown as CommandServiceDeps["connectorManager"],
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as CommandServiceDeps["logger"],
    commandHistoryStore: store,
    ...overrides,
  };
}

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  store = new CommandHistoryStore(db);
});

afterEach(() => db.close());

describe("CommandService — recorded evidence", () => {
  it("states the contract on the opening rung of an observed-tier command", async () => {
    const registry = { getById: vi.fn().mockReturnValue({ id: "flow-1" }) };
    const tracker = new PendingCommandTracker();
    const svc = new CommandService(deps({
      deviceRegistry: registry as unknown as CommandServiceDeps["deviceRegistry"],
      pendingCommandTracker: tracker,
    }));
    svc.registerHandler("device_action", async () => ({ success: true }));

    const conditionSpec = { field: "litresPerMinute", op: "gt", value: 0 };
    const result = await svc.execute(
      { type: "device_action", target: "pump-1", params: {} },
      restSource(),
      {
        condition: (state) => Number(state.litresPerMinute) > 0,
        conditionSpec,
        deviceId: "flow-1",
        timeoutMs: 30,
      },
    );

    const [requested] = store.get(result.commandId!)!.transitions;
    // What had to be proven is on record before the outcome is known, and the
    // condition recorded is the same plain data the predicate was built from.
    expect(requested?.details).toMatchObject({
      tier: "observed",
      observedDeviceId: "flow-1",
      condition: conditionSpec,
      timeoutMs: 30,
    });
  });

  it("restates the unmet condition on a timeout, because that is the whole failure", async () => {
    const registry = { getById: vi.fn().mockReturnValue({ id: "flow-1" }) };
    const tracker = new PendingCommandTracker();
    const svc = new CommandService(deps({
      deviceRegistry: registry as unknown as CommandServiceDeps["deviceRegistry"],
      pendingCommandTracker: tracker,
    }));
    svc.registerHandler("device_action", async () => ({ success: true }));

    const conditionSpec = { field: "litresPerMinute", op: "gt", value: 0 };
    const result = await svc.execute(
      { type: "device_action", target: "pump-1", params: {} },
      restSource(),
      { condition: () => false, conditionSpec, deviceId: "flow-1", timeoutMs: 20 },
    );

    expect(result.lifecycleState).toBe("TIMED_OUT");
    const transitions = store.get(result.commandId!)!.transitions;
    const last = transitions.at(-1);
    expect(last?.toState).toBe("TIMED_OUT");
    expect(last?.details).toMatchObject({
      tier: "observed",
      observedDeviceId: "flow-1",
      condition: conditionSpec,
      timeoutMs: 20,
    });
    expect(String(last?.details?.reason).length).toBeGreaterThan(0);
  });

  it("explains a dispatch-tier command without implying a missing observation", async () => {
    const svc = new CommandService(deps());
    svc.registerHandler("device_action", async () => ({ success: true }));

    const result = await svc.execute({ type: "device_action", target: "dev-1", params: {} }, restSource());

    const transitions = store.get(result.commandId!)!.transitions;
    expect(transitions.map((t) => t.toState)).toEqual(["REQUESTED", "DISPATCHED"]);
    // A dispatch-tier ladder is honestly short: no condition, no timeout, because
    // none was ever required.
    expect(transitions[0]?.details).toMatchObject({ tier: "dispatch" });
    expect(transitions[0]?.details?.condition).toBeUndefined();
    expect(transitions[0]?.details?.timeoutMs).toBeUndefined();
    expect(String(transitions[1]?.details?.reason).length).toBeGreaterThan(0);
  });

  it("records the device's own account when a handler reports a failure", async () => {
    const svc = new CommandService(deps());
    svc.registerHandler("device_action", async () => ({ success: false, error: "pump reported overcurrent" }));

    const result = await svc.execute({ type: "device_action", target: "dev-1", params: {} }, restSource());

    const last = store.get(result.commandId!)!.transitions.at(-1);
    expect(last?.toState).toBe("FAILED");
    expect(last?.details?.reason).toBe("pump reported overcurrent");
  });

  it("says the observation was impossible when the observed device is absent", async () => {
    const registry = { getById: vi.fn().mockReturnValue(undefined) };
    const svc = new CommandService(deps({
      deviceRegistry: registry as unknown as CommandServiceDeps["deviceRegistry"],
      pendingCommandTracker: new PendingCommandTracker(),
    }));
    svc.registerHandler("device_action", async () => ({ success: true }));

    const result = await svc.execute(
      { type: "device_action", target: "pump-1", params: {} },
      restSource(),
      { condition: () => true, deviceId: "ghost-1" },
    );

    const last = store.get(result.commandId!)!.transitions.at(-1);
    expect(last?.toState).toBe("FAILED");
    expect(last?.details).toMatchObject({ observedDeviceId: "ghost-1" });
    expect(String(last?.details?.reason)).toContain("ghost-1");
  });
});

// ── The scope on the evidence read ───────────────────────────────────────────
//
// `devices.commandEvidence()` is the one new read this feature adds. Its whole
// authorization story is "the automation may read back commands it issued", so
// these tests are the security tests for it.

describe("CommandHistoryStore.getForRule", () => {
  function record(overrides: Record<string, unknown> = {}) {
    return {
      commandId: "c1",
      sourceKind: "automation" as const,
      targetDeviceId: "dev-1",
      actionType: "device_action",
      effectiveTier: "dispatch" as const,
      lifecycleState: "REQUESTED" as const,
      requestedAt: 1000,
      ruleId: "rule-a",
      ...overrides,
    };
  }

  it("returns the command with its rungs to the rule that issued it", () => {
    store.create(record());
    const evidence = store.getForRule("c1", "rule-a");
    expect(evidence?.commandId).toBe("c1");
    expect(evidence?.transitions.map((t) => t.toState)).toEqual(["REQUESTED"]);
  });

  it("hides a command issued by a different rule", () => {
    store.create(record({ ruleId: "rule-b" }));
    // Indistinguishable from a command that does not exist — no partial answer,
    // no error that would confirm the id is real.
    expect(store.getForRule("c1", "rule-a")).toBeUndefined();
  });

  it("hides a command with no rule attribution at all", () => {
    store.create(record({ sourceKind: "rest", ruleId: undefined, sourceId: "api" }));
    expect(store.getForRule("c1", "rule-a")).toBeUndefined();
  });

  it("hides an unknown command id", () => {
    expect(store.getForRule("nope", "rule-a")).toBeUndefined();
  });

  it("refuses empty identifiers rather than matching loosely", () => {
    store.create(record());
    expect(store.getForRule("", "rule-a")).toBeUndefined();
    expect(store.getForRule("c1", "")).toBeUndefined();
  });

  it("carries the recorded evidence through to the caller", () => {
    store.create(record({ effectiveTier: "observed" }), {
      tier: "observed",
      condition: { field: "measuredRpm", op: "gte", value: 2000 },
      timeoutMs: 5000,
      reason: "Command accepted into the pipeline",
    });
    store.transition({
      commandId: "c1",
      toState: "DISPATCHED",
      timestamp: 1100,
      terminal: false,
      details: { reason: "The connector accepted the dispatch" },
    });

    const evidence = store.getForRule("c1", "rule-a")!;
    expect(evidence.transitions[0]?.details?.condition).toEqual({ field: "measuredRpm", op: "gte", value: 2000 });
    expect(evidence.transitions[1]?.details?.reason).toBe("The connector accepted the dispatch");
  });
});
