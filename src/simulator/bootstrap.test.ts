// src/simulator/bootstrap.test.ts
// Unit tests for the seed/bootstrap helper (demo/seed/simulator-bootstrap.mjs).
// The bootstrap is admin-privileged seed-time code, exercised here against a
// fake client so it needs no running backend.
import { describe, it, expect, vi } from "vitest";
import {
  profileMatches,
  configureSimulatedCommandProfiles,
} from "../../demo/seed/simulator-bootstrap.mjs";
import { AGRICULTURE_ACTUATOR_SPECS } from "../../demo/seed/agriculture-simulator-bootstrap.mjs";
import { RESEARCH_VESSEL_ACTUATOR_SPECS } from "../../demo/seed/research-vessel-simulator-bootstrap.mjs";
import { UNDERGROUND_MINING_ACTUATOR_SPECS } from "../../demo/seed/underground-mining-simulator-bootstrap.mjs";
import { WILDLIFE_ACTUATOR_SPECS } from "../../demo/seed/wildlife-simulator-bootstrap.mjs";
import { STAGE_SHOW_ACTUATOR_SPECS } from "../../demo/seed/stage-show-simulator-bootstrap.mjs";
import { ESCAPE_ROOM_ACTUATOR_SPECS } from "../../demo/seed/escape-room-simulator-bootstrap.mjs";
import { OFF_GRID_BUNKER_ACTUATOR_SPECS } from "../../demo/seed/off-grid-bunker-simulator-bootstrap.mjs";

/** Every world's specs, in the order demo/seed/seed.mjs concatenates them. */
const WORLD_ACTUATOR_SPECS: Array<readonly [string, readonly unknown[]]> = [
  ["agriculture", AGRICULTURE_ACTUATOR_SPECS],
  ["research-vessel", RESEARCH_VESSEL_ACTUATOR_SPECS],
  ["underground-mining", UNDERGROUND_MINING_ACTUATOR_SPECS],
  ["wildlife", WILDLIFE_ACTUATOR_SPECS],
  ["stage-show", STAGE_SHOW_ACTUATOR_SPECS],
  ["escape-room", ESCAPE_ROOM_ACTUATOR_SPECS],
  ["off-grid-bunker", OFF_GRID_BUNKER_ACTUATOR_SPECS],
];

interface FakeDevice {
  id: string;
  integration: string;
  topic?: string;
  mqttCommandProfile?: unknown;
}

function fakeClient(pages: FakeDevice[][]) {
  const set: Array<{ id: string; profile: unknown }> = [];
  let call = 0;
  const client = {
    listDevices: async (): Promise<FakeDevice[]> => {
      const page = pages[Math.min(call, pages.length - 1)];
      call += 1;
      return page;
    },
    setCommandProfile: async (id: string, profile: unknown): Promise<void> => {
      set.push({ id, profile });
    },
  };
  return { client, set, calls: () => call };
}

const PUMP_STATE = "switch/reference-water/transfer-pump/state";
const PUMP_ID = "switch-reference-water-transfer-pump-state";
const ackProfile = { acknowledgement: { supported: true }, qos: 1 };

const silentOpts = { logger: { info: () => undefined, warn: () => undefined } };

describe("profileMatches", () => {
  it("treats equal managed fields as a match regardless of key order", () => {
    expect(profileMatches({ qos: 1, acknowledgement: { supported: true } }, { acknowledgement: { supported: true }, qos: 1 })).toBe(true);
  });
  it("detects a difference in acknowledgement support", () => {
    expect(profileMatches({ acknowledgement: { supported: false } }, { acknowledgement: { supported: true } })).toBe(false);
  });
  it("treats a missing profile as different from a real one", () => {
    expect(profileMatches(undefined, ackProfile)).toBe(false);
    expect(profileMatches(null, null)).toBe(true);
  });
});

describe("configureSimulatedCommandProfiles", () => {
  it("configures a device that has no profile yet", async () => {
    const { client, set } = fakeClient([[{ id: PUMP_ID, integration: "mqtt", topic: PUMP_STATE }]]);
    const result = await configureSimulatedCommandProfiles(client, [{ stateTopic: PUMP_STATE, profile: ackProfile }], silentOpts);
    expect(result.configured).toEqual([PUMP_ID]);
    expect(result.skipped).toEqual([]);
    expect(set).toEqual([{ id: PUMP_ID, profile: ackProfile }]);
  });

  it("resolves the device by its persisted state topic, not a reconstructed id (collision-safe)", async () => {
    // Aeolus assigned a collision-suffixed id that a naive segment-join would
    // never produce. Resolution must still find it via the exact persisted topic.
    const collisionId = `mqtt-${PUMP_ID}-deadbeefcafe`;
    const { client, set } = fakeClient([[{ id: collisionId, integration: "mqtt", topic: PUMP_STATE }]]);
    const result = await configureSimulatedCommandProfiles(client, [{ stateTopic: PUMP_STATE, profile: ackProfile }], silentOpts);
    expect(result.configured).toEqual([collisionId]);
    expect(set).toEqual([{ id: collisionId, profile: ackProfile }]);
  });

  it("is idempotent: skips a device whose profile already matches", async () => {
    const { client, set } = fakeClient([[{ id: PUMP_ID, integration: "mqtt", topic: PUMP_STATE, mqttCommandProfile: ackProfile }]]);
    const result = await configureSimulatedCommandProfiles(client, [{ stateTopic: PUMP_STATE, profile: ackProfile }], silentOpts);
    expect(result.skipped).toEqual([PUMP_ID]);
    expect(result.configured).toEqual([]);
    expect(set).toHaveLength(0);
  });

  it("polls until the device is discovered", async () => {
    // First list has no devices; second reveals the pump.
    const { client, set, calls } = fakeClient([[], [{ id: PUMP_ID, integration: "mqtt", topic: PUMP_STATE }]]);
    const sleep = vi.fn(async () => undefined);
    let clock = 0;
    const result = await configureSimulatedCommandProfiles(client, [{ stateTopic: PUMP_STATE, profile: ackProfile }], {
      ...silentOpts,
      pollMs: 10,
      now: () => (clock += 10),
      sleep,
    });
    expect(result.configured).toEqual([PUMP_ID]);
    expect(calls()).toBe(2);
    expect(sleep).toHaveBeenCalledOnce();
    expect(set).toHaveLength(1);
  });

  it("throws listing the devices it never resolved before the timeout", async () => {
    const { client } = fakeClient([[]]);
    let clock = 0;
    await expect(
      configureSimulatedCommandProfiles(client, [{ stateTopic: PUMP_STATE, profile: ackProfile }], {
        ...silentOpts,
        timeoutMs: 50,
        pollMs: 10,
        now: () => (clock += 100), // jumps past the deadline immediately
        sleep: async () => undefined,
      }),
    ).rejects.toThrow(new RegExp(PUMP_STATE));
  });

  it("only touches devices named in the specs", async () => {
    const { client, set } = fakeClient([
      [
        { id: PUMP_ID, integration: "mqtt", topic: PUMP_STATE },
        { id: "sensor-unrelated-thing", integration: "mqtt", topic: "sensor/unrelated/thing" },
      ],
    ]);
    await configureSimulatedCommandProfiles(client, [{ stateTopic: PUMP_STATE, profile: ackProfile }], silentOpts);
    expect(set.map((s) => s.id)).toEqual([PUMP_ID]);
  });

  it("throws when a resolved device is not an MQTT device", async () => {
    const { client } = fakeClient([[{ id: PUMP_ID, integration: "hue", topic: PUMP_STATE }]]);
    await expect(
      configureSimulatedCommandProfiles(client, [{ stateTopic: PUMP_STATE, profile: ackProfile }], silentOpts),
    ).rejects.toThrow(/not an MQTT device/i);
  });

  it("rejects a spec whose acknowledgement/qos was flattened instead of wrapped in `profile`", async () => {
    // Regression: a flattened spec silently reported the actuator as idempotently
    // SKIPPED, because profileMatches(undefined, undefined) is a match. The world
    // then ran with no acknowledgement capability, so CommandService clamped every
    // `observed` command down to a fire-and-forget dispatch. Fail at seed time.
    const { client, set } = fakeClient([[{ id: PUMP_ID, integration: "mqtt", topic: PUMP_STATE }]]);
    const flattened = { stateTopic: PUMP_STATE, commandTopic: "switch/reference-water/transfer-pump/set", acknowledgement: { supported: true }, qos: 1 };
    await expect(
      configureSimulatedCommandProfiles(client, [flattened], silentOpts),
    ).rejects.toThrow(/missing its "profile"/i);
    expect(set).toHaveLength(0);
  });

  it("throws on a spec with no stateTopic", async () => {
    const { client } = fakeClient([[]]);
    await expect(
      configureSimulatedCommandProfiles(client, [{ profile: ackProfile }], silentOpts),
    ).rejects.toThrow(/missing a "stateTopic"/i);
  });
});

describe("every demo world's actuator specs are shaped for the bootstrap", () => {
  // The seed passes all of these to configureSimulatedCommandProfiles as one
  // list, and a wrongly shaped entry used to be invisible in the seed output (it
  // landed in `skipped`, indistinguishable from a genuinely idempotent skip).
  // Lock the shape per world so a new world cannot repeat it.
  it.each(WORLD_ACTUATOR_SPECS)(
    "%s declares { stateTopic, profile } with acknowledgement support for every actuator",
    (world, specs) => {
      expect(specs.length, `${world} must declare at least one actuator`).toBeGreaterThan(0);
      for (const spec of specs) {
        const s = spec as Record<string, unknown>;
        expect(typeof s.stateTopic, `${world}: stateTopic must be a string`).toBe("string");
        expect(s.profile, `${world}: ${String(s.stateTopic)} must wrap its profile`).toBeTruthy();
        expect(
          (s.profile as { acknowledgement?: { supported?: boolean } }).acknowledgement?.supported,
          `${world}: ${String(s.stateTopic)} must declare acknowledgement support`,
        ).toBe(true);
        // A flattened spec is the exact regression this guards against.
        expect(
          s.acknowledgement,
          `${world}: ${String(s.stateTopic)} must not flatten acknowledgement onto the spec`,
        ).toBeUndefined();
      }
    },
  );

  it("is the full set the seed actually passes to the bootstrap", () => {
    // Keeps this guard honest: if a new world is wired into demo/seed/seed.mjs but not
    // added here, the count drifts and this fails.
    const declared = WORLD_ACTUATOR_SPECS.reduce((n, [, specs]) => n + specs.length, 0);
    expect(declared).toBe(23);
  });
});
