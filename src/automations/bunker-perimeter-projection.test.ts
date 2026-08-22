// src/automations/bunker-perimeter-projection.test.ts
//
// Behavioural regression guard for the Off-Grid Bunker "Perimeter Security" pane.
//
// Reported bug: pressing "Turn floodlights on" produced no visible change in the
// pane, and the floodlights could not be turned back off. Root cause was in this
// automation's projection, not in the command pipeline: `lightsOn` was seeded ONCE
// from the device and thereafter only rewritten on a SUCCESSFUL command, while the
// toggle target was `!lightsOn`. So any command that was not verified left the
// projection permanently disagreeing with physical state, and every subsequent
// click re-sent the same `on: true` — an un-turn-off-able button.
//
// The fix makes observed device state the single source of truth: the Logic
// re-projects `lightsOn` from the floodlight device at the START of every run.
//
// The Logic is plain ES5 in a template string, so it runs directly in Node with
// stubbed sandbox APIs — no isolated-vm (unavailable on Windows dev) and no broker.

import { describe, it, expect } from "vitest";
import { bunkerPerimeterAutomation } from "../../scripts/seed/tabs/off-grid-bunker/perimeter.mjs";

const LIGHTS_TOPIC = "switch/bunker/floodlights/state";
const PERIMETER_TOPIC = "sensor/bunker/perimeter";

interface CommandRecord {
  topic: string;
  on: boolean;
  tier: unknown;
  condition: unknown;
}

/** A stub bunker: a floodlight actuator, a perimeter classifier, and a state store. */
function makeWorld(options?: { lightsOn?: boolean; withLights?: boolean }) {
  const lightsOn = options?.lightsOn ?? false;
  const withLights = options?.withLights ?? true;

  const store = new Map<string, unknown>();
  const deviceState: Record<string, Record<string, unknown>> = {
    [PERIMETER_TOPIC]: { sector: "east", contacts: 0, classification: "none" },
  };
  if (withLights) {
    deviceState[LIGHTS_TOPIC] = { on: lightsOn, brightness: lightsOn ? 100 : 0, mode: "auto" };
  }

  const world = {
    store,
    deviceState,
    /** Flip to false to model an unverified command (ack/observation timeout). */
    commandsVerify: true,
    commands: [] as CommandRecord[],
    emitted: [] as Array<{ topic: string; payload: Record<string, unknown> }>,
    devices: {
      list: () =>
        Object.entries(deviceState).map(([topic, state]) => ({ id: `dev:${topic}`, topic, state })),
      action: async (
        id: string,
        _actionType: string,
        params: { payload: { on: boolean } },
        opts: { tier?: unknown; condition?: unknown },
      ) => {
        const topic = id.slice("dev:".length);
        world.commands.push({ topic, on: params.payload.on, tier: opts?.tier, condition: opts?.condition });
        if (!world.commandsVerify) {
          return { success: false, error: "observation timed out", lifecycleState: "TIMED_OUT" };
        }
        // A verified command means the actuator really moved and republished.
        if (topic === LIGHTS_TOPIC) {
          const on = params.payload.on;
          deviceState[LIGHTS_TOPIC] = { on, brightness: on ? 100 : 0, mode: "auto" };
        }
        return { success: true, lifecycleState: "OBSERVED" };
      },
    },
    state: {
      get: (key: string) => store.get(key),
      set: (key: string, value: unknown) => void store.set(key, value),
    },
    events: {
      emit: (topic: string, payload: Record<string, unknown>) => void world.emitted.push({ topic, payload }),
    },
  };
  return world;
}

type World = ReturnType<typeof makeWorld>;

/** Run the automation's single action once, for one event topic. */
async function run(world: World, topic: string): Promise<void> {
  let actions: Array<(ctx: unknown) => unknown> = [];
  const automation = (config: { actions: Array<(ctx: unknown) => unknown> }) => {
    actions = config.actions;
  };
  // The Logic is a string of ES5 destined for the isolate; compiling it here is
  // how the test exercises the real authored source without isolated-vm.
  const load = new Function(
    "automation",
    "devices",
    "state",
    "events",
    `${bunkerPerimeterAutomation.scriptSource}\nreturn null;`,
  );
  load(automation, world.devices, world.state, world.events);
  expect(actions).toHaveLength(1);
  await actions[0]({ topic, state: {}, deviceId: "test", timestamp: Date.now() });
}

/**
 * The values the pane renders, derived exactly as `uiSource` derives them, so the
 * assertions below are about what an operator actually sees.
 */
function pane(world: World) {
  const lights = Boolean(world.store.get("lightsOn"));
  const available = world.store.get("lightsAvailable") !== false;
  const pending = Boolean(world.store.get("pending"));
  return {
    lights,
    mode: world.store.get("autoLights") === false ? "MANUAL" : "AUTO",
    buttonLabel: !available
      ? "Floodlight controller offline"
      : pending
        ? "Verifying floodlight command…"
        : lights
          ? "Turn floodlights off"
          : "Turn floodlights on",
    footer: (world.store.get("lastAction") as { label?: string } | undefined)?.label,
  };
}

/** True physical state of the simulated floodlights. */
const physicallyOn = (world: World): boolean => Boolean(world.deviceState[LIGHTS_TOPIC]?.on);

describe("Bunker Perimeter Security — floodlight projection", () => {
  it("turns the floodlights on and back off across two clicks", async () => {
    const world = makeWorld();
    await run(world, PERIMETER_TOPIC);
    expect(pane(world).buttonLabel).toBe("Turn floodlights on");

    await run(world, "ui/rule/toggle-lights");
    expect(physicallyOn(world)).toBe(true);
    expect(pane(world).lights).toBe(true);
    expect(pane(world).buttonLabel).toBe("Turn floodlights off");

    await run(world, "ui/rule/toggle-lights");
    expect(physicallyOn(world)).toBe(false);
    expect(pane(world).lights).toBe(false);
    expect(pane(world).buttonLabel).toBe("Turn floodlights on");
    expect(world.commands.map((c) => c.on)).toEqual([true, false]);
  });

  it("recovers from an unverified command instead of latching the toggle direction", async () => {
    // THE reported bug. Before the fix the failed command left lightsOn false while
    // the operator kept clicking, so every command was another on:true and the
    // lights could never be turned off.
    const world = makeWorld();
    await run(world, PERIMETER_TOPIC);

    world.commandsVerify = false;
    await run(world, "ui/rule/toggle-lights");
    expect(pane(world).footer).toContain("not verified");
    expect(pane(world).lights).toBe(false);

    world.commandsVerify = true;
    await run(world, "ui/rule/toggle-lights");
    expect(physicallyOn(world)).toBe(true);

    await run(world, "ui/rule/toggle-lights");
    expect(physicallyOn(world)).toBe(false);
    expect(world.commands.map((c) => c.on)).toEqual([true, true, false]);
  });

  it("never reports floodlights the device did not confirm", async () => {
    const world = makeWorld();
    world.commandsVerify = false;
    await run(world, "ui/rule/toggle-lights");
    // Physical truth is OFF, so the projection must stay OFF and say why.
    expect(pane(world).lights).toBe(false);
    expect(pane(world).footer).toBe("Floodlight command not verified: observation timed out");
  });

  it("gives visible feedback and issues no command when the controller is missing", async () => {
    // Previously `if(!d)return;` — a click produced no state change whatsoever,
    // which is the "button does nothing" half of the report.
    const world = makeWorld({ withLights: false });
    await run(world, "ui/rule/toggle-lights");
    expect(world.commands).toHaveLength(0);
    expect(pane(world).buttonLabel).toBe("Floodlight controller offline");
    expect(pane(world).footer).toContain("not reachable");
  });

  it("labels the button from observed state on a cold pane, so the first click is not inverted", async () => {
    // Lights are physically ON before this rule has ever run. The floodlight
    // device's own state topic is inside the rule's trigger, so the projection is
    // correct before the operator can click.
    const world = makeWorld({ lightsOn: true });
    await run(world, LIGHTS_TOPIC);
    expect(pane(world).buttonLabel).toBe("Turn floodlights off");

    await run(world, "ui/rule/toggle-lights");
    expect(world.commands.map((c) => c.on)).toEqual([false]);
    expect(physicallyOn(world)).toBe(false);
  });

  it("follows a floodlight change it did not command", async () => {
    const world = makeWorld();
    await run(world, PERIMETER_TOPIC);
    world.deviceState[LIGHTS_TOPIC] = { on: true, brightness: 100, mode: "auto" };
    await run(world, LIGHTS_TOPIC);
    expect(pane(world).lights).toBe(true);
    expect(world.commands).toHaveLength(0);
  });

  it("keeps AUTO engaged when a manual override is not verified", async () => {
    // Entering MANUAL is a consequence of a command that actually landed. A failed
    // override must not quietly disable the contact policy.
    const world = makeWorld();
    await run(world, PERIMETER_TOPIC);
    expect(pane(world).mode).toBe("AUTO");

    world.commandsVerify = false;
    await run(world, "ui/rule/toggle-lights");
    expect(pane(world).mode).toBe("AUTO");
  });

  it("enters MANUAL only once the override is verified", async () => {
    const world = makeWorld();
    await run(world, PERIMETER_TOPIC);
    await run(world, "ui/rule/toggle-lights");
    expect(pane(world).mode).toBe("MANUAL");
  });

  it("AUTO lights the perimeter on contact and clears it again", async () => {
    const world = makeWorld();
    await run(world, PERIMETER_TOPIC);

    world.deviceState[PERIMETER_TOPIC] = { sector: "north", contacts: 2, classification: "shambling-biped" };
    await run(world, PERIMETER_TOPIC);
    expect(physicallyOn(world)).toBe(true);
    expect(pane(world).mode).toBe("AUTO");
    expect(pane(world).footer).toContain("AUTO");

    world.deviceState[PERIMETER_TOPIC] = { sector: "north", contacts: 0, classification: "none" };
    await run(world, PERIMETER_TOPIC);
    expect(physicallyOn(world)).toBe(false);
  });

  it("retries a lost AUTO command on the next perimeter publish", async () => {
    const world = makeWorld();
    await run(world, PERIMETER_TOPIC);

    world.commandsVerify = false;
    world.deviceState[PERIMETER_TOPIC] = { sector: "north", contacts: 2, classification: "shambling-biped" };
    await run(world, PERIMETER_TOPIC);
    expect(physicallyOn(world)).toBe(false);

    world.commandsVerify = true;
    world.deviceState[PERIMETER_TOPIC] = { sector: "north", contacts: 3, classification: "shambling-biped" };
    await run(world, PERIMETER_TOPIC);
    expect(physicallyOn(world)).toBe(true);
  });

  it("does not command the floodlights while in MANUAL override", async () => {
    const world = makeWorld();
    await run(world, PERIMETER_TOPIC);
    await run(world, "ui/rule/toggle-lights"); // -> MANUAL, lights on
    const issued = world.commands.length;

    world.deviceState[PERIMETER_TOPIC] = { sector: "east", contacts: 0, classification: "none" };
    await run(world, PERIMETER_TOPIC);
    expect(world.commands).toHaveLength(issued);
    expect(physicallyOn(world)).toBe(true);
  });

  it("returns control to AUTO and reconciles the lights with current contacts", async () => {
    const world = makeWorld();
    await run(world, PERIMETER_TOPIC);
    await run(world, "ui/rule/toggle-lights"); // MANUAL, lights on, no contacts
    expect(pane(world).mode).toBe("MANUAL");

    await run(world, "ui/rule/return-auto");
    expect(pane(world).mode).toBe("AUTO");
    expect(physicallyOn(world)).toBe(false); // no contacts -> policy says off
  });

  it("clears the pending flag on both the verified and unverified paths", async () => {
    const world = makeWorld();
    await run(world, "ui/rule/toggle-lights");
    expect(world.store.get("pending")).toBe(false);

    world.commandsVerify = false;
    await run(world, "ui/rule/toggle-lights");
    expect(world.store.get("pending")).toBe(false);
  });

  it("requests observed-tier confirmation against the commanded field", async () => {
    // The pane's whole claim is "verified floodlighting", so the command must ask
    // to observe `on` reaching the commanded value rather than fire and forget.
    const world = makeWorld();
    await run(world, "ui/rule/toggle-lights");
    expect(world.commands[0].tier).toBe("observed");
    expect(world.commands[0].condition).toEqual({ field: "on", op: "eq", value: true });
  });

  it("mirrors the projection into the overview summary event", async () => {
    const world = makeWorld();
    await run(world, PERIMETER_TOPIC);
    await run(world, "ui/rule/toggle-lights");
    const summary = world.emitted.filter((e) => e.topic === "bunker/summary/perimeter").pop();
    expect(summary?.payload).toMatchObject({ lightsOn: true, autoLights: false });
  });

  it("emits at most one summary per run", async () => {
    // evaluateAutomationEvent submits to the ExecutionGate with an empty deviceId
    // and a fixed topic, so two summaries in flight together share a dedup key and
    // the LATER one is suppressed as a duplicate — which would leave the overview
    // holding the pre-command value. For a boolean that reads as the exact
    // opposite of the truth, which is the bug this guards.
    const world = makeWorld();
    for (const topic of [
      PERIMETER_TOPIC,
      "ui/rule/toggle-lights",
      LIGHTS_TOPIC,
      "ui/rule/return-auto",
      "sensor/bunker/power",
      "ui/rule/simulate-contacts",
    ]) {
      const before = world.emitted.length;
      await run(world, topic);
      const emitted = world.emitted.filter((e, i) => i >= before && e.topic === "bunker/summary/perimeter");
      expect(emitted.length, `run for "${topic}" emitted ${emitted.length} summaries`).toBeLessThanOrEqual(1);
    }
  });

  it("re-publishes a summary when it observes drift it did not command", async () => {
    // The self-healing path for the overview: if the pane's own command outcome was
    // never usable, the floodlight device's state publish must still carry the
    // observed truth onward to the Continuity Overview.
    const world = makeWorld();
    await run(world, PERIMETER_TOPIC);
    const before = world.emitted.length;

    world.deviceState[LIGHTS_TOPIC] = { on: true, brightness: 100, mode: "auto" };
    await run(world, LIGHTS_TOPIC);

    const summary = world.emitted
      .filter((e, i) => i >= before && e.topic === "bunker/summary/perimeter")
      .pop();
    expect(summary?.payload).toMatchObject({ lightsOn: true });
  });

  it("stays silent on an unrelated bunker publish that changes nothing", async () => {
    const world = makeWorld();
    await run(world, PERIMETER_TOPIC);
    const before = world.emitted.length;
    await run(world, "sensor/bunker/power");
    expect(world.emitted.filter((e, i) => i >= before && e.topic === "bunker/summary/perimeter")).toHaveLength(0);
  });

  describe("when the command boundary returns a result the script cannot read", () => {
    // This was the live failure: devices.action() resolved to an isolated-vm
    // Reference rather than the ActionResult, so `r.success` was undefined and the
    // Logic always took the not-verified branch even though the device actuated.
    // The projection must still converge on observed truth, and the overview with
    // it, rather than latching one step behind (which reads as inverted).
    const unreadableResult = () => ({ typeof: "object", copySync: () => undefined });

    it("converges on observed state once the device publishes", async () => {
      const world = makeWorld();
      await run(world, PERIMETER_TOPIC);

      // The command reaches the device; only its reported result is unusable.
      const realAction = world.devices.action;
      world.devices.action = async (id, type, params, opts) => {
        await realAction(id, type, params, opts);
        return unreadableResult() as never;
      };

      await run(world, "ui/rule/toggle-lights");
      expect(physicallyOn(world)).toBe(true);
      expect(pane(world).footer).toContain("not verified");

      // The floodlight state publish must carry the truth to both panes.
      const before = world.emitted.length;
      await run(world, LIGHTS_TOPIC);
      expect(pane(world).lights).toBe(true);
      const summary = world.emitted
        .filter((e, i) => i >= before && e.topic === "bunker/summary/perimeter")
        .pop();
      expect(summary?.payload).toMatchObject({ lightsOn: true });
    });

    it("reports a missing result explicitly rather than as 'unknown'", async () => {
      const world = makeWorld();
      world.devices.action = async () => unreadableResult() as never;
      await run(world, "ui/rule/toggle-lights");
      expect(pane(world).footer).toContain("no result from the command boundary");
    });
  });

  it("reaches this rule for both the perimeter sensor and the floodlight actuator", () => {
    // Mirrors AutomationEngine.topicMatches so the widened trigger is covered.
    const matches = (pattern: string, topic: string): boolean => {
      if (!pattern) return false;
      if (pattern === topic) return true;
      const p = pattern.split("/");
      const t = topic.split("/");
      for (let i = 0; i < p.length; i++) {
        if (p[i] === "#") return true;
        if (p[i] === "+") continue;
        if (i >= t.length || p[i] !== t[i]) return false;
      }
      return p.length === t.length;
    };
    const trigger = bunkerPerimeterAutomation.triggerTopic;
    expect(matches(trigger, PERIMETER_TOPIC)).toBe(true);
    expect(matches(trigger, LIGHTS_TOPIC)).toBe(true);
    expect(matches(trigger, "sensor/farm/dam/level")).toBe(false);
  });

  it("writes every projection key its UI reads", () => {
    const written = new Set(
      [...bunkerPerimeterAutomation.scriptSource.matchAll(/state\.set\(\s*["']([^"']+)["']/g)].map((m) => m[1]),
    );
    for (const key of [
      ...bunkerPerimeterAutomation.uiSource.matchAll(/aeolus\.read\(\s*["']([^"']+)["']/g),
    ].map((m) => m[1])) {
      expect(written, `UI reads "${key}" but the Logic never state.set()s it`).toContain(key);
    }
  });
});
