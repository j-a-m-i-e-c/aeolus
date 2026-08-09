// src/simulator/logger.ts
// phase-2-mqtt-simulator Task 1 — the simulator's own logger.
//
// Deliberately independent of the backend `src/logger.ts`, which couples to the
// backend config and in-process log buffer. The simulator is a separate process
// and must not import backend runtime modules (Req 1.3).

import pino, { type Logger } from "pino";

/** Create a JSON logger scoped to the simulator process. */
export function createSimulatorLogger(level: string): Logger {
  return pino({
    level,
    timestamp: pino.stdTimeFunctions.isoTime,
    base: { service: "aeolus-simulator" },
  });
}

export type { Logger };
