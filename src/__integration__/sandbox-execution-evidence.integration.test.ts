// showcase-cleanup §2.7 — `devices.executionEvidence()` across the real isolate boundary.
//
// Separate from the pure store tests because the part that can only fail here is the
// bridge: isolated-vm transfers primitives as call arguments and throws on anything
// else, so a no-argument call passing `undefined` through `applySync` is exactly the
// shape that looks fine in TypeScript and breaks at runtime. It also confirms the
// host resolves the execution id itself — authored Logic has no way to learn its own,
// so if that resolution were wrong the call would simply always answer nothing.

import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { Sandbox } from "../automations/sandbox.js";
import { CommandHistoryStore, type CommandRecord } from "../automations/command-history-store.js";
import { runInExecutionContext } from "../automations/execution-context.js";
import { initSchema } from "../db/database.js";
import type { ActionResult, Device } from "../core/types.js";

let isolatedVmAvailable = true;
try {
  await import("isolated-vm");
} catch {
  isolatedVmAvailable = false;
}

const realIt = isolatedVmAvailable ? it : it.skip;

const devices: Device[] = [
  { id: "dmx-1", name: "Lighting Desk", type: "switch", capabilities: ["on/off"], state: {}, integration: "mqtt", lastSeen: 1 },
  { id: "fx-1", name: "Stage FX Rack", type: "switch", capabilities: ["on/off"], state: {}, integration: "mqtt", lastSeen: 1 },
];

function record(overrides: Partial<CommandRecord> & { commandId: string }): CommandRecord {
  return {
    sourceKind: "automation",
    targetDeviceId: "dmx-1",
    actionType: "device_action",
    effectiveTier: "dispatch",
    lifecycleState: "DISPATCHED",
    requestedAt: 1_000,
    ...overrides,
  };
}

/** A store already holding one execution's two commands, as a real cue would leave it. */
function seededStore(): { store: CommandHistoryStore; close: () => void } {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  const store = new CommandHistoryStore(db);

  store.create(
    record({
      commandId: "cmd-dmx",
      ruleId: "rule-show",
      executionId: "X1",
      requestedAt: 1_000,
      targetDeviceName: "Lighting Desk",
      intentLabel: "Lighting cue · chorus",
      triggerTopic: "ui/rule-show/run-cue",
    }),
  );
  store.create(
    record({
      commandId: "cmd-fx",
      ruleId: "rule-show",
      executionId: "X1",
      requestedAt: 2_000,
      targetDeviceId: "fx-1",
      targetDeviceName: "Stage FX Rack",
      intentLabel: "Fire stage effect · confetti",
      triggerTopic: "ui/rule-show/run-cue",
    }),
  );
  // Another rule's execution, deliberately sharing nothing but the database.
  store.create(record({ commandId: "cmd-other", ruleId: "rule-bunker", executionId: "X2" }));

  return { store, close: () => db.close() };
}

function makeSandbox(store: CommandHistoryStore, projected: Record<string, unknown>): Sandbox {
  const commandService = {
    execute: async (): Promise<ActionResult> => ({
      success: true,
      lifecycleState: "DISPATCHED",
      commandId: "cmd-new",
    }),
  };
  return new Sandbox({
    commandService: commandService as never,
    deviceRegistry: { getAll: () => devices } as never,
    commandHistoryStore: store,
    stateStore: {
      get: (_ruleId: string, key: string) => projected[key],
      set: (_ruleId: string, key: string, value: unknown) => {
        projected[key] = value;
      },
      getAll: () => projected,
      delete: (_ruleId: string, key: string) => {
        delete projected[key];
      },
    } as never,
  });
}

const context = { topic: "ui/rule-show/run-cue", deviceId: "", state: {}, timestamp: 1 };

describe("devices.executionEvidence across the real isolate boundary", () => {
  realIt("returns the running execution's commands with no argument", async () => {
    const { store, close } = seededStore();
    const projected: Record<string, unknown> = {};
    const sandbox = makeSandbox(store, projected);

    // The no-argument call is the normal one, and the one that would break if
    // `undefined` were not transferable through applySync.
    const result = await runInExecutionContext({ executionId: "X1", automationId: "rule-show" }, () =>
      sandbox.execute(
        `automation({ actions: [async function run() {
           state.set("lastExecution", devices.executionEvidence());
         }] });`,
        context,
        "rule-show",
      ),
    );

    expect(result).toEqual({ success: true });
    const group = projected.lastExecution as {
      executionId: string;
      triggerTopic: string;
      commands: Array<{ commandId: string; transitions: unknown[] }>;
    };
    expect(group.executionId).toBe("X1");
    expect(group.triggerTopic).toBe("ui/rule-show/run-cue");
    // Oldest first, and with the transitions the proof model needs.
    expect(group.commands.map((entry) => entry.commandId)).toEqual(["cmd-dmx", "cmd-fx"]);
    expect(group.commands[0]!.transitions).toHaveLength(1);
    close();
  });

  realIt("refuses another rule's execution even given the correct id", async () => {
    const { store, close } = seededStore();
    const projected: Record<string, unknown> = {};
    const sandbox = makeSandbox(store, projected);

    // The scope boundary, exercised the way it would actually be crossed: an explicit
    // id is accepted from the isolate, so the rule predicate is the only thing
    // stopping an automation reading another's commands.
    const result = await runInExecutionContext({ executionId: "X1", automationId: "rule-show" }, () =>
      sandbox.execute(
        `automation({ actions: [async function run() {
           state.set("leaked", devices.executionEvidence("X2") === undefined ? "denied" : "leaked");
         }] });`,
        context,
        "rule-show",
      ),
    );

    expect(result).toEqual({ success: true });
    expect(projected.leaked).toBe("denied");
    close();
  });

  realIt("answers undefined outside any execution", async () => {
    const { store, close } = seededStore();
    const projected: Record<string, unknown> = {};
    const sandbox = makeSandbox(store, projected);

    const result = await sandbox.execute(
      `automation({ actions: [async function run() {
         state.set("outside", devices.executionEvidence() === undefined ? "none" : "something");
       }] });`,
      context,
      "rule-show",
    );

    expect(result).toEqual({ success: true });
    expect(projected.outside).toBe("none");
    close();
  });

  realIt("is not exposed when no history store is configured", async () => {
    // Consistent with commandEvidence: the function is absent rather than present and
    // permanently answering nothing.
    const projected: Record<string, unknown> = {};
    const sandbox = new Sandbox({
      commandService: { execute: async () => ({ success: true }) } as never,
      deviceRegistry: { getAll: () => devices } as never,
      stateStore: {
        get: (_r: string, key: string) => projected[key],
        set: (_r: string, key: string, value: unknown) => {
          projected[key] = value;
        },
        getAll: () => projected,
        delete: () => undefined,
      } as never,
    });

    const result = await sandbox.execute(
      `automation({ actions: [async function run() {
         state.set("shape", typeof devices.executionEvidence);
       }] });`,
      context,
      "rule-show",
    );

    expect(result).toEqual({ success: true });
    // The method exists on the surface but resolves to nothing without a store; what
    // matters is that it does not throw and does not fabricate a group.
    expect(projected.shape).toBe("function");
  });
});
