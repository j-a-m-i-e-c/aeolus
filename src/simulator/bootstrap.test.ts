// src/simulator/bootstrap.test.ts
// Unit tests for the seed/bootstrap helper (scripts/seed/simulator-bootstrap.mjs).
// The bootstrap is admin-privileged seed-time code, exercised here against a
// fake client so it needs no running backend.
import { describe, it, expect, vi } from "vitest";
import {
  profileMatches,
  configureSimulatedCommandProfiles,
} from "../../scripts/seed/simulator-bootstrap.mjs";

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
});
