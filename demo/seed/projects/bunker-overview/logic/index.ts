// Off-grid Bunker overview — read-only aggregation entry point.
// Each subsystem owns its hardware; this project only composes their summaries.

import {
  projectAirSummary,
  projectCommsSummary,
  projectPerimeterSummary,
  projectPowerSummary,
} from "./bunker-summary";

/** The Shared State bucket every bunker subsystem writes its current summary into. */
const BUCKET = "bunker-summary";

/**
 * The durable current value of one subsystem summary.
 *
 * Answers `{}` when a subsystem has not reported yet, which the projections treat as
 * "nothing to copy" rather than as zeroes.
 */
function currentSummary(key: string): Record<string, unknown> {
  const value = shared?.get(BUCKET, key);
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export default async function run(_context: EventContext) {
  // Composed from every subsystem's DURABLE current value, not from the single payload
  // that happened to wake this run (ADR-0016).
  //
  // While each summary arrived as an Automation Event, the overview could only refresh
  // the subsystem it had just been handed, and depended on seeing every event to stay
  // complete. Reading Shared State instead means a restart, a coalesced burst or a
  // missed wake-up all land in the same place: the overview reflects whatever each
  // subsystem currently reports. Which key woke this run stops mattering.
  projectPerimeterSummary(currentSummary("perimeter"));
  projectAirSummary(currentSummary("air"));
  projectPowerSummary(currentSummary("power"));
  projectCommsSummary(currentSummary("comms"));
}
