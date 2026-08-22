// src/__integration__/simulator-harness-isolation.integration.test.ts
//
// Locks the property that makes a SHARED broker safe across tests.
//
// Each simulator E2E file starts one mosquitto container in beforeAll and reuses it
// for every test, because a container per test is slow and was the step that
// intermittently overran the hook budget. The cost of sharing is that simulator state
// publications are retained, so one test's final state is replayed to the next test's
// MqttService the moment it subscribes.
//
// createSimulatorE2E() gates setup on the registry reporting the scenario's
// INITIAL_STATE rather than merely on a device being present, so a stale retained
// message cannot satisfy readiness.
//
// What these tests pin down is the shared-broker CONTRACT: pre-existing retained state
// on the broker still yields an environment at initial state, and stop() leaves a
// borrowed broker running for the next test. Note the first test also passes with a
// weaker presence-only gate, because simulator.start() reliably publishes before the
// gate is evaluated — it guards the observable contract, not the specific mechanism.
//
// Requires Docker; skipped without it.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mqtt from "mqtt";
import {
  createSimulatorE2E,
  startDockerBroker,
  dockerAvailable,
  AEOLUS_DEVICE_IDS,
  STATE_TOPICS,
  INITIAL_STATE,
  type DockerBroker,
  type SimulatorE2E,
} from "./simulator-harness.js";

const describeE2E = dockerAvailable() ? describe : describe.skip;

/** State a finished test plausibly leaves behind: pump running, water moving. */
const STALE = {
  sourceTank: { levelPct: 12, litres: 7200 },
  headerTank: { levelPct: 97, litres: 4850 },
  pump: { on: true, running: true },
  flow: { litresPerMinute: 133 },
};

describeE2E("simulator harness isolation on a shared broker", () => {
  let broker: DockerBroker;

  beforeAll(async () => {
    broker = await startDockerBroker();
  }, 120000);

  afterAll(() => {
    broker?.stop();
  });

  it("hands back initial state even when the broker already holds stale retained state", async () => {
    const brokerUrl = `mqtt://127.0.0.1:${broker.port}`;

    // Publish stale state RETAINED, exactly as the simulator would have, so a fresh
    // subscriber receives it immediately on connect.
    const seeder = await new Promise<mqtt.MqttClient>((resolve, reject) => {
      const c = mqtt.connect(brokerUrl, { protocolVersion: 5 });
      c.once("connect", () => resolve(c));
      c.once("error", reject);
    });
    await Promise.all(
      (Object.keys(STALE) as Array<keyof typeof STALE>).map(
        (key) =>
          new Promise<void>((resolve, reject) => {
            seeder.publish(
              STATE_TOPICS[key],
              JSON.stringify(STALE[key]),
              { retain: true, qos: 1 },
              (err) => (err ? reject(err) : resolve()),
            );
          }),
      ),
    );
    await new Promise<void>((resolve) => seeder.end(false, {}, () => resolve()));

    let env: SimulatorE2E | undefined;
    try {
      env = await createSimulatorE2E({ broker });

      // Setup must not return until the fresh simulator's own initial state landed.
      expect(env.registry.getById(AEOLUS_DEVICE_IDS.flow)?.state).toMatchObject(
        INITIAL_STATE.flow,
      );
      expect(env.registry.getById(AEOLUS_DEVICE_IDS.pump)?.state).toMatchObject(
        INITIAL_STATE.pump,
      );
      expect(env.registry.getById(AEOLUS_DEVICE_IDS.headerTank)?.state).toMatchObject(
        INITIAL_STATE.headerTank,
      );
      expect(env.registry.getById(AEOLUS_DEVICE_IDS.sourceTank)?.state).toMatchObject(
        INITIAL_STATE.sourceTank,
      );
    } finally {
      await env?.stop();
    }
  }, 30000);

  it("leaves the borrowed broker running for the next test", async () => {
    // stop() must tear down only an environment it owns. If the previous test's
    // stop() had killed the shared container, this setup could not succeed.
    const env = await createSimulatorE2E({ broker });
    try {
      expect(env.registry.getById(AEOLUS_DEVICE_IDS.pump)).toBeDefined();
    } finally {
      await env.stop();
    }
  }, 30000);
});
