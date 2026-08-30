// Mine Operations Overview — read-only aggregation entry point.
// Owner automations publish summaries; this project composes the operating picture.

import {
  initialiseMineOverview,
  projectAtmosphereSummary,
  projectDewateringSummary,
  projectPersonnelSummary,
  projectVentilationSummary,
} from "./operations-summary";

export default async function run(context: EventContext) {
  const topic = String(context.topic || "");
  const summary = context.state && typeof context.state === "object"
    ? context.state as Record<string, unknown>
    : {};

  initialiseMineOverview();

  if (topic.includes("/mine/summary/atmosphere")) projectAtmosphereSummary(summary);
  else if (topic.includes("/mine/summary/ventilation")) projectVentilationSummary(summary);
  else if (topic.includes("/mine/summary/personnel")) projectPersonnelSummary(summary);
  else if (topic.includes("/mine/summary/dewatering")) projectDewateringSummary(summary);
}
