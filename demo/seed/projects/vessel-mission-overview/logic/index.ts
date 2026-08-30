// Mission Overview — read-only aggregation entry point.
// CTD, ROV and underway science remain independent owner automations.

import {
  initialiseMissionOverview,
  projectCtdSummary,
  projectRovSummary,
  projectUnderwaySummary,
} from "./mission-summary";

export default async function run(context: EventContext) {
  const topic = String(context.topic || "");
  const summary = context.state && typeof context.state === "object"
    ? context.state as Record<string, unknown>
    : {};

  initialiseMissionOverview();

  if (topic.includes("/vessel/summary/ctd")) projectCtdSummary(summary);
  else if (topic.includes("/vessel/summary/rov")) projectRovSummary(summary);
  else if (topic.includes("/vessel/summary/underway")) projectUnderwaySummary(summary);
}
