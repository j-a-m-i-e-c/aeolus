// Mission Overview — read-only aggregation entry point.
// CTD, ROV and underway science remain independent owner automations.

import {
  initialiseMissionOverview,
  projectCtdSummary,
  projectRovSummary,
  projectUnderwaySummary,
} from "./mission-summary";

/** The Shared State bucket every science system writes its current summary into. */
const BUCKET = "vessel-summary";

/** The keys this overview composes, and the projection each one feeds. */
const SUBSYSTEMS: Array<{
  key: string;
  project: (source: Record<string, unknown>) => void;
}> = [
  { key: "ctd", project: projectCtdSummary },
  { key: "rov", project: projectRovSummary },
  { key: "underway", project: projectUnderwaySummary },
];

/**
 * The durable current value of one subsystem summary.
 *
 * Answers `{}` when a system has not reported yet, which the projections treat as
 * "nothing to copy" — so the seeded resting state stands rather than being overwritten
 * with zeroes.
 */
function currentSummary(key: string): Record<string, unknown> {
  const value = shared?.get(BUCKET, key);
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export default async function run(context: EventContext) {
  initialiseMissionOverview();

  // Composed from every system's DURABLE current value, not from the single payload that
  // happened to wake this run (ADR-0016).
  //
  // While each summary arrived as an Automation Event, the overview could only refresh
  // the system it had just been handed, and depended on seeing every event to stay
  // complete. Reading Shared State instead means a restart, a coalesced burst or a
  // missed wake-up all land in the same place: the overview reflects whatever each
  // system currently reports.
  const changed = context.meta?.sharedState?.key;

  // Every projection also writes `lastMissionEvent`, so the one that woke this run is
  // refreshed LAST and its label is the one the operator reads. Without that the label
  // would always describe underway science, whatever had actually just happened. The
  // other keys are still read, so the numbers are whole either way.
  for (const subsystem of SUBSYSTEMS) {
    if (subsystem.key === changed) continue;
    subsystem.project(currentSummary(subsystem.key));
  }
  const woken = SUBSYSTEMS.find((subsystem) => subsystem.key === changed);
  if (woken) woken.project(currentSummary(woken.key));
}
