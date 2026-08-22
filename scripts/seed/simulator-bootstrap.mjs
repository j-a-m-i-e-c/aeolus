// scripts/seed/simulator-bootstrap.mjs
// phase-2-mqtt-simulator Task 6 — configure MQTT command profiles for simulated
// actuators through the SAME Phase 1 authenticated API a real device uses
// (PUT /api/devices/:id/mqtt-command-profile) — never by editing SQLite (Req 7.2).
//
// This is the SEED/BOOTSTRAP job, not the simulator runtime. It is the only
// component that holds an authenticated Aeolus session; the long-running
// simulator process never receives admin credentials (design §7.1, Req 7.6/7.7).
//
// Startup ordering (Req 7.8):
//   1. Mosquitto healthy
//   2. Aeolus backend healthy
//   3. simulator connects and publishes initial device state
//   4. Aeolus discovers/registers the generic MQTT devices
//   5. THIS bootstrap resolves those devices and applies MQTT Command Profiles
//   6. reference/demo automations can issue verified commands
//
// It is idempotent (Req 7.4): a device whose profile already matches is skipped,
// and only devices named in `specs` are touched (Req 7.5).

/**
 * The command-capable actuators of the reference-water scenario and the MQTT
 * command profile each should be configured with. The state topic determines
 * the Aeolus device id and the derived command topic (".../state" -> ".../set").
 * @type {Array<{stateTopic: string, profile: {acknowledgement: {supported: boolean}, qos?: number}}>}
 */
export const REFERENCE_WATER_ACTUATOR_SPECS = [
  {
    stateTopic: "switch/reference-water/transfer-pump/state",
    profile: { acknowledgement: { supported: true }, qos: 1 },
  },
];

/**
 * Normalise the managed subset of an MQTT command profile for comparison.
 * @param {any} profile
 * @returns {string}
 */
function normaliseProfile(profile) {
  if (!profile || typeof profile !== "object") return "null";
  const ack = profile.acknowledgement ?? null;
  return JSON.stringify({
    qos: profile.qos ?? null,
    acknowledgement: ack
      ? {
          supported: ack.supported === true,
          responseTopic: ack.responseTopic ?? null,
          ackIndicatorField: ack.ackIndicatorField ?? null,
          ackIndicatorValues: Array.isArray(ack.ackIndicatorValues) ? ack.ackIndicatorValues : null,
        }
      : null,
  });
}

/**
 * True when an existing device profile already matches the desired profile.
 * @param {any} existing
 * @param {any} desired
 * @returns {boolean}
 */
export function profileMatches(existing, desired) {
  return normaliseProfile(existing) === normaliseProfile(desired);
}

/**
 * @typedef {Object} BootstrapClient
 * @property {() => Promise<Array<{id: string, integration: string, topic?: string, mqttCommandProfile?: any}>>} listDevices
 * @property {(id: string, profile: any) => Promise<void>} setCommandProfile
 */

/**
 * @typedef {Object} ActuatorSpec
 * @property {string} stateTopic  Canonical MQTT state topic the simulator publishes.
 * @property {any} profile        Desired MQTT command profile (acknowledgement/qos).
 */

/**
 * Configure command profiles for simulated actuators, polling until each device
 * has been discovered by Aeolus. Idempotent and scoped to the given specs.
 *
 * @param {BootstrapClient} client
 * @param {ActuatorSpec[]} specs
 * @param {{timeoutMs?: number, pollMs?: number, now?: () => number, sleep?: (ms: number) => Promise<void>, logger?: {info: Function, warn: Function}}} [options]
 * @returns {Promise<{configured: string[], skipped: string[]}>}
 */
export async function configureSimulatedCommandProfiles(client, specs, options = {}) {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const pollMs = options.pollMs ?? 500;
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const logger = options.logger ?? console;

  // Key pending work by the canonical state topic. Aeolus derives an MQTT
  // device id from the topic but applies collision handling (a hash suffix on a
  // slug clash), so the persisted id is authoritative and may differ from a
  // naive segment-join. We therefore resolve each device by its EXACT persisted
  // `topic` and use the id Aeolus actually assigned — never a reconstructed one.
  // Reject a malformed spec BEFORE touching any device. A spec written without
  // the `profile` wrapper (e.g. acknowledgement/qos flattened onto the spec
  // itself) used to sail straight through: `spec.profile` was undefined, so
  // profileMatches() compared "no desired profile" against "no configured
  // profile", declared a match, and reported the actuator as idempotently
  // SKIPPED. The world then ran with actuators that declared no acknowledgement
  // capability, which silently demoted every verified automation command to a
  // fire-and-forget dispatch. Fail loudly instead.
  for (const spec of specs) {
    if (!spec || typeof spec.stateTopic !== "string" || !spec.stateTopic) {
      throw new Error(`Simulator bootstrap: actuator spec is missing a "stateTopic": ${JSON.stringify(spec)}`);
    }
    if (!spec.profile || typeof spec.profile !== "object") {
      throw new Error(
        `Simulator bootstrap: actuator spec for "${spec.stateTopic}" is missing its "profile" ` +
          `({ stateTopic, profile: { acknowledgement, qos } }). Found keys: ${Object.keys(spec).join(", ")}`,
      );
    }
  }

  /** @type {Map<string, ActuatorSpec>} */
  const pending = new Map(specs.map((spec) => [spec.stateTopic, spec]));

  const configured = [];
  const skipped = [];
  const deadline = now() + timeoutMs;

  while (pending.size > 0) {
    const devices = await client.listDevices();
    const byTopic = new Map(
      devices.filter((device) => typeof device.topic === "string").map((device) => [device.topic, device]),
    );

    for (const [stateTopic, spec] of [...pending]) {
      const device = byTopic.get(stateTopic);
      if (!device) continue; // not discovered yet

      if (device.integration !== "mqtt") {
        throw new Error(
          `Simulator bootstrap: device for topic "${stateTopic}" is not an MQTT device (id=${device.id}, integration=${device.integration})`,
        );
      }

      if (profileMatches(device.mqttCommandProfile, spec.profile)) {
        skipped.push(device.id);
        pending.delete(stateTopic);
        continue;
      }

      await client.setCommandProfile(device.id, spec.profile);
      configured.push(device.id);
      pending.delete(stateTopic);
      logger.info?.(`  ✓ Simulator command profile configured: ${device.id} (${stateTopic})`);
    }

    if (pending.size === 0) break;

    if (now() >= deadline) {
      throw new Error(
        `Simulator bootstrap timed out waiting for devices: ${[...pending.keys()].join(", ")}`,
      );
    }
    await sleep(pollMs);
  }

  return { configured, skipped };
}

/**
 * Build a {@link BootstrapClient} from the authenticated seed API caller
 * (scripts/seed/lib.mjs `createApi`). Only the seed job holds this session.
 * @param {(method: string, path: string, body?: any) => Promise<any>} api
 * @returns {BootstrapClient}
 */
export function createBootstrapClient(api) {
  return {
    listDevices: async () => {
      const devices = await api("GET", "/api/devices");
      return Array.isArray(devices) ? devices : [];
    },
    setCommandProfile: async (id, profile) => {
      await api("PUT", `/api/devices/${id}/mqtt-command-profile`, profile);
    },
  };
}
