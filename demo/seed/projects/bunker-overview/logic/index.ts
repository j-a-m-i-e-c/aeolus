// Continuity Overview — read-only aggregation entry point.
// Each subsystem owns its hardware; this project only composes their summaries.

import {
  projectAirSummary,
  projectCommsSummary,
  projectPerimeterSummary,
  projectPowerSummary,
} from "./continuity-summary";

export default async function run(context: EventContext) {
  const topic = String(context.topic || "");
  const summary = context.state && typeof context.state === "object"
    ? context.state as Record<string, unknown>
    : {};

  if (topic.includes("/bunker/summary/perimeter")) projectPerimeterSummary(summary);
  else if (topic.includes("/bunker/summary/air")) projectAirSummary(summary);
  else if (topic.includes("/bunker/summary/power")) projectPowerSummary(summary);
  else if (topic.includes("/bunker/summary/comms")) projectCommsSummary(summary);
}
