// Predator Response — orchestration entry point.
// Classification decides whether Aeolus observes, ignores or issues verified actuation.

import {
  acceptClassification,
  applyPredatorPolicy,
  handlePredatorOperatorEvent,
  initialisePredatorPolicy,
  projectStationReadings,
  projectStationSummary,
} from "./predator-policy";

export default async function run(context: EventContext) {
  const topic = String(context.topic || "");
  const event = topic.split("/").pop();

  initialisePredatorPolicy();

  if (topic.startsWith("ui/")) {
    // A UI action runs with a fresh device snapshot, so this is a valid projection.
    projectStationReadings();
    await handlePredatorOperatorEvent(event);
    return;
  }

  const payload = context.state && typeof context.state === "object"
    ? context.state as Record<string, unknown>
    : {};

  if (topic.includes("/wildlife/detection/station")) {
    // This summary was emitted from the physical device publish that woke Wildlife
    // Detection. Use the payload itself rather than pretending this execution's
    // device snapshot is the same event.
    projectStationSummary(payload);
    return;
  }

  if (!topic.includes("/wildlife/detection/classified")) return;

  // Classification is also emitted immediately after a detection-device publish;
  // refresh the remaining station state before evaluating policy.
  projectStationReadings();
  const classification = acceptClassification(payload);
  if (classification) await applyPredatorPolicy(classification);
}
