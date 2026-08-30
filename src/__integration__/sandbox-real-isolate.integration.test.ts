// Linux/native integration proof for the authored-Logic V8 boundary.
// This is intentionally separate from the pure sandbox tests: it must actually
// instantiate isolated-vm, run the bootstrap, and cross a host callback.

import { describe, expect, it } from "vitest";
import { Sandbox } from "../automations/sandbox.js";
import type { ActionResult, Device } from "../core/types.js";
import { CommandResultCollector } from "../automations/command-result-collector.js";

let isolatedVmAvailable = true;
try {
  await import("isolated-vm");
} catch {
  isolatedVmAvailable = false;
}

const realIt = isolatedVmAvailable ? it : it.skip;

const devices: Device[] = [
  { id: "light-1", name: "Light", type: "light", capabilities: ["on/off"], state: { on: false }, integration: "test", lastSeen: 1 },
  { id: "sensor-1", name: "Sensor", type: "sensor", capabilities: [], state: { value: 1 }, integration: "test", lastSeen: 1 },
];

function makeSandbox(results: string[] = [], collector?: CommandResultCollector): Sandbox {
  const commandService = {
    execute: async (action: { target: string; params: Record<string, unknown> }): Promise<ActionResult> => {
      results.push(`${action.target}:${String(action.params.actionType)}`);
      return { success: true, lifecycleState: "DISPATCHED", commandId: `cmd-${results.length}` };
    },
  };
  return new Sandbox({
    commandService: commandService as never,
    deviceRegistry: { getAll: () => devices } as never,
    collector,
    // Deliberately omit Data Store and Automation Events: optional capabilities
    // must not make otherwise-valid Logic fail during bootstrap.
  });
}

describe("real isolated-vm automation boundary", () => {
  realIt("hides Node globals and boots without optional db/events capabilities", async () => {
    const sandbox = makeSandbox();
    const result = await sandbox.execute(`
      if (typeof process !== "undefined" || typeof require !== "undefined") {
        throw new Error("Node globals leaked into isolate");
      }
      if (typeof db !== "undefined" || typeof events !== "undefined") {
        throw new Error("missing optional capabilities were fabricated");
      }
      automation({ actions: [async function run() { log.info("isolated"); }] });
    `, { topic: "manual/test", deviceId: "", state: {}, timestamp: Date.now() }, "rule-isolate-globals");

    expect(result).toEqual({ success: true });
  });

  realIt("crosses async device commands and keeps actionAll predicates inside the isolate", async () => {
    const calls: string[] = [];
    const sandbox = makeSandbox(calls);
    const result = await sandbox.execute(`
      automation({ actions: [async function run() {
        const one = await devices.action("light-1", "on");
        if (!one.success) throw new Error("single command failed");

        const bulk = await devices.actionAll(
          function (device) { return device.type === "light"; },
          "off"
        );
        if (bulk.error || bulk.total !== 1 || bulk.succeeded !== 1 || bulk.failed !== 0) {
          throw new Error("unexpected bulk result: " + JSON.stringify(bulk));
        }
      }] });
    `, { topic: "manual/test", deviceId: "", state: {}, timestamp: Date.now() }, "rule-isolate-command");

    expect(result).toEqual({ success: true });
    expect(calls).toEqual(["light-1:on", "light-1:off"]);
  });


  realIt("records actionAll predicate failures as execution failures and fails fast", async () => {
    const calls: string[] = [];
    const collector = new CommandResultCollector();
    const executionId = "exec-bulk-preflight";
    const sandbox = makeSandbox(calls, collector);
    collector.open(executionId);

    const result = await collector.context.run(executionId, () => sandbox.execute(`
      automation({ actions: [
        async function bulk() {
          const outcome = await devices.actionAll(function () {
            throw new Error("predicate exploded");
          }, "on");
          if (!outcome.error) throw new Error("bulk failure was not surfaced");
        },
        async function shouldNotRun() {
          await devices.action("light-1", "on");
        }
      ] });
    `, { topic: "manual/test", deviceId: "", state: {}, timestamp: Date.now() }, "rule-isolate-bulk-failure"));

    expect(result).toEqual({ success: true });
    expect(calls).toEqual([]);
    expect(collector.close(executionId)).toEqual([
      expect.objectContaining({ success: false, failureKind: "execution", error: "predicate exploded" }),
    ]);
  });

  realIt("classifies real isolate runtime errors and CPU timeouts", async () => {
    const sandbox = makeSandbox();
    const runtime = await sandbox.execute(
      `throw new Error("real isolate boom");`,
      { topic: "manual/test", deviceId: "", state: {}, timestamp: Date.now() },
      "rule-isolate-runtime",
    );
    expect(runtime).toMatchObject({ success: false, reason: "runtime" });

    const timeout = await sandbox.execute(
      `while (true) {}`,
      { topic: "manual/test", deviceId: "", state: {}, timestamp: Date.now() },
      "rule-isolate-timeout",
    );
    expect(timeout).toMatchObject({ success: false, reason: "timeout" });
  }, 15_000);
});
