// src/api/routes/command-status.ts — Map a command outcome to an HTTP status.
//
// The device action route returns the full Command_Result as the body for every
// outcome; this pure function chooses a truthful HTTP status so a timeout or
// rejection is not indistinguishable from success at the transport layer. It
// reads only the reported lifecycleState and the coarse failureKind — never the
// human-readable error string — so the mapping is stable and testable.

import type { ActionResult } from "../../core/types.js";

/**
 * Map a completed {@link ActionResult} to an expressive HTTP status code.
 *
 * - success (DISPATCHED | ACKNOWLEDGED | OBSERVED) → 200
 * - TIMED_OUT      → 504 (upstream did not confirm within the budget)
 * - STATE_MISMATCH → 409 (observed device state conflicts with the request)
 * - FAILED, by failureKind:
 *     not_found                    → 404
 *     transport                    → 503 (broker/connector unavailable)
 *     execution                    → 502 (connector/device errored downstream)
 *     unsupported | invalid_params → 422 (request invalid for this device)
 *     (unclassified)               → 422 (safe default for a rejection)
 *
 * 202 is intentionally not produced: the route awaits the configured completion outcome within
 * the REST action timeout, so a dispatched-but-unconfirmed command resolves to
 * DISPATCHED (200) or TIMED_OUT (504) rather than an async-accepted response.
 */
export function httpStatusForCommandResult(result: ActionResult): number {
  if (result.success) return 200;

  switch (result.lifecycleState) {
    case "TIMED_OUT":
      return 504;
    case "STATE_MISMATCH":
      return 409;
    default:
      // FAILED (or an unspecified failure lifecycle) — disambiguate by cause.
      switch (result.failureKind) {
        case "not_found":
          return 404;
        case "transport":
          return 503;
        case "execution":
          return 502;
        case "unsupported":
        case "invalid_params":
          return 422;
        default:
          return 422;
      }
  }
}
