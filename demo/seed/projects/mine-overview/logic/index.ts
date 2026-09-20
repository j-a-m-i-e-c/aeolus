// Mine Operations Overview — read-only aggregation entry point.
// Owner automations publish summaries; this project composes the operating picture.

import {
  initialiseMineOverview,
  projectAtmosphereSummary,
  projectDewateringSummary,
  projectPersonnelSummary,
  projectVentilationSummary,
} from "./operations-summary";

/** The Shared State bucket every mine subsystem writes its current summary into. */
const BUCKET = "mine-summary";

/** The keys this overview composes, and the projection each one feeds. */
const SUBSYSTEMS: Array<{
  key: string;
  project: (source: Record<string, unknown>) => void;
}> = [
  { key: "atmosphere", project: projectAtmosphereSummary },
  { key: "ventilation", project: projectVentilationSummary },
  { key: "personnel", project: projectPersonnelSummary },
  { key: "dewatering", project: projectDewateringSummary },
];

/**
 * The durable current value of one subsystem summary.
 *
 * Answers `{}` when a subsystem has not reported yet, which the projections treat as
 * "nothing to copy" — so the seeded defaults stand rather than being overwritten with
 * zeroes.
 */
function currentSummary(key: string): Record<string, unknown> {
  const value = shared?.get(BUCKET, key);
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export default async function run(context: EventContext) {
  initialiseMineOverview();

  // Composed from every subsystem's DURABLE current value, not from the single payload
  // that happened to wake this run (ADR-0016).
  //
  // While each summary arrived as an Automation Event, the overview could only refresh
  // the subsystem it had just been handed, and depended on seeing every event to stay
  // complete. Reading Shared State instead means a restart, a coalesced burst or a
  // missed wake-up all land in the same place: the overview reflects whatever each
  // subsystem currently reports.
  const changed = context.meta?.sharedState?.key;

  // Every projection also writes `lastMineEvent`, so the one that woke this run is
  // refreshed LAST and its label is the one the operator reads. Without that the label
  // would always describe dewatering, whatever had actually just happened. The other
  // keys are still read, so the numbers are whole either way.
  for (const subsystem of SUBSYSTEMS) {
    if (subsystem.key === changed) continue;
    subsystem.project(currentSummary(subsystem.key));
  }
  const woken = SUBSYSTEMS.find((subsystem) => subsystem.key === changed);
  if (woken) woken.project(currentSummary(woken.key));
}
