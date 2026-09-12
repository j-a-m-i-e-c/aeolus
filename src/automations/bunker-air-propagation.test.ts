// showcase-cleanup §9.1 — sealing the bunker must reach the Bunker Overview.
//
// The intended flow is Air & Filtration -> physical filter state -> bunker/summary/air
// -> Bunker Overview -> the AIRLOCK visual. In practice the overview only sometimes
// followed a seal, and the cause is worth stating precisely because it is a trap the
// whole showcase can fall into:
//
//   `devices.list()` inside a sandboxed automation is a SNAPSHOT, serialized into the
//   isolate once per execution. Re-reading it after `devices.action()` returns the
//   world as it was BEFORE the command.
//
// Air & Filtration re-projected from that snapshot after a successful seal, so it
// computed `sealed: false` and emitted that summary — racing the correct one produced
// when the filter controller's own state publish re-triggered the automation. Whichever
// landed second won.
//
// These tests drive the authored Logic against a stubbed sandbox whose device snapshot
// is deliberately stale, which is the condition the real runtime creates.

import { describe, expect, it, beforeEach } from "vitest";
import {
  projectAirState,
  publishAirSummary,
  setBunkerSeal,
} from "../../demo/seed/projects/bunker-air/logic/air-control";

const FILTER_TOPIC = "switch/bunker/filter/state";

const store = new Map<string, unknown>();
const emitted: Array<{ topic: string; payload: Record<string, unknown> }> = [];

/**
 * Install the sandbox globals with a device snapshot the caller controls.
 *
 * `snapshot` is what `devices.list()` reports for the whole execution, exactly as the
 * real isolate behaves — it does not change when a command succeeds.
 */
function installSandbox(snapshot: Record<string, unknown>, commandSucceeds = true): void {
  const globals = globalThis as Record<string, unknown>;
  globals.state = {
    get: (key: string) => store.get(key),
    set: (key: string, value: unknown) => { store.set(key, value); },
  };
  globals.devices = {
    list: () => [{ id: "filter-1", topic: FILTER_TOPIC, state: snapshot }],
    action: async () => ({
      success: commandSucceeds,
      commandId: "cmd-1",
      lifecycleState: commandSucceeds ? "ACKNOWLEDGED" : "TIMED_OUT",
    }),
    commandEvidence: (commandId: string) => ({ commandId }),
  };
  globals.events = {
    emit: (topic: string, payload: Record<string, unknown>) => { emitted.push({ topic, payload }); },
  };
}

const airSummaries = (): Record<string, unknown>[] =>
  emitted.filter((entry) => entry.topic === "bunker/summary/air").map((entry) => entry.payload);

describe("bunker air propagation", () => {
  beforeEach(() => {
    store.clear();
    emitted.length = 0;
  });

  it("reports the seal it just achieved, not the state it started from", async () => {
    // The unsealed bunker, and a snapshot that stays unsealed for the whole execution
    // because that is what the isolate hands the automation.
    installSandbox({ on: true, sealed: false, overpressure: 8, filterLife: 78, tempC: 19.4 });

    await setBunkerSeal(true);

    // The defect in one assertion: this used to be `false`, because the re-projection
    // read the pre-command snapshot back.
    expect(store.get("sealed")).toBe(true);
    const summaries = airSummaries();
    expect(summaries.length).toBeGreaterThan(0);
    expect(summaries.at(-1)).toMatchObject({ sealed: true });
    // And no summary at all may claim the bunker is open after a successful seal,
    // because a single stale emit landing last is the whole bug.
    expect(summaries.every((summary) => summary.sealed === true)).toBe(true);
  });

  it("reports an unseal the same way", async () => {
    installSandbox({ on: true, sealed: true, overpressure: 15, filterLife: 78, tempC: 21.8 });
    store.set("sealed", true);

    await setBunkerSeal(false);

    expect(store.get("sealed")).toBe(false);
    expect(airSummaries().every((summary) => summary.sealed === false)).toBe(true);
  });

  it("leaves the overview describing the unchanged bunker when a seal is not verified", async () => {
    installSandbox({ on: true, sealed: false, overpressure: 8, filterLife: 78, tempC: 19.4 }, false);
    store.set("sealed", false);

    await setBunkerSeal(true);

    // A command that failed verification must not report a seal, and must still report
    // something — silence would leave the overview showing whatever it last heard.
    expect(store.get("sealed")).toBe(false);
    expect(airSummaries().at(-1)).toMatchObject({ sealed: false });
  });

  it("still projects the controller's own reading when the controller publishes", async () => {
    // The telemetry path is where reading the snapshot is correct: this runs *because*
    // the controller published, so the snapshot is the state that woke the automation.
    installSandbox({ on: true, sealed: true, overpressure: 15, filterLife: 71, tempC: 21.8 });

    projectAirState();

    expect(store.get("sealed")).toBe(true);
    expect(store.get("overpressure")).toBe(15);
    expect(store.get("filterLife")).toBe(71);
    expect(store.get("tempC")).toBe(21.8);
    expect(airSummaries().at(-1)).toMatchObject({
      sealed: true,
      overpressure: 15,
      filterLife: 71,
      tempC: 21.8,
    });
  });

  it("carries every key the overview whitelists", async () => {
    // The overview copies a fixed set of keys and silently drops anything else, so a
    // summary missing one of them propagates nothing for that field.
    installSandbox({ on: true, sealed: false, overpressure: 8, filterLife: 78, tempC: 19.4 });
    projectAirState();
    emitted.length = 0;

    publishAirSummary();

    const summary = airSummaries().at(-1)!;
    for (const key of ["sealed", "overpressure", "filterLife", "tempC"]) {
      expect(summary[key], `air summary is missing ${key}`).not.toBeUndefined();
    }
  });
});
