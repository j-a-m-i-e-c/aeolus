// src/simulator/index.ts
// phase-2-mqtt-simulator Task 1 — simulator process entry point.
//
// This is a SEPARATE process from the Aeolus backend. It is never imported by
// `src/index.ts`, so the backend build (`tsup src/index.ts`) never bundles it
// and normal Aeolus startup never launches it. Run it explicitly:
//
//   AEOLUS_SIMULATOR_ENABLED=true npm run sim
//
// The simulator is OFF by default: without the enablement flag the process logs
// and exits cleanly (Req 1.9).

import { pathToFileURL } from "node:url";
import { loadSimulatorConfig, describeSimulatorConfig } from "./config.js";
import { createSimulatorLogger } from "./logger.js";
import { SimulatorRuntime } from "./runtime.js";
import { resolveScenarios } from "./scenarios/index.js";

export async function main(): Promise<void> {
  const parsed = loadSimulatorConfig(process.env);

  // An unset AEOLUS_SIMULATOR_SCENARIOS means the showcase set, which lives once as
  // SHOWCASE_SCENARIO_KEYS — the Makefile and both compose files used to carry their
  // own copy of that list. See resolveScenarios for why the default is applied at the
  // entry point rather than in the config loader or the runtime.
  const config = { ...parsed, scenarios: resolveScenarios(parsed.scenarios) };

  const logger = createSimulatorLogger(config.logLevel);

  if (!config.enabled) {
    logger.warn("Aeolus simulator is disabled. Set AEOLUS_SIMULATOR_ENABLED=true to run it. Exiting.");
    return;
  }

  logger.info(describeSimulatorConfig(config), "Starting Aeolus simulator");

  const runtime = new SimulatorRuntime(config, logger);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Simulator shutting down");
    try {
      await runtime.stop();
    } catch (err) {
      logger.error({ error: (err as Error).message }, "Error during simulator shutdown");
    } finally {
      process.exit(0);
    }
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await runtime.start();
}

// Only auto-run when invoked directly (not when imported by a test).
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((err: Error) => {
    // The logger may not exist yet if config parsing threw; use stderr as a last resort.
    console.error("Fatal simulator error:", err);
    process.exit(1);
  });
}
