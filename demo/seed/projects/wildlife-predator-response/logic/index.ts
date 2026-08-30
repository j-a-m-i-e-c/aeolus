// Predator Response — orchestration entry point.
// Classification decides whether Aeolus observes, ignores or issues verified actuation.

import {
  acceptClassification,
  applyPredatorPolicy,
  handlePredatorOperatorEvent,
  initialisePredatorPolicy,
} from "./predator-policy";

export default async function run(context: EventContext) {
  const topic = String(context.topic || "");
  const event = topic.split("/").pop();

  initialisePredatorPolicy();

  if (topic.startsWith("ui/")) {
    await handlePredatorOperatorEvent(event);
    return;
  }

  if (!topic.includes("/wildlife/detection/classified")) return;

  const payload = context.state && typeof context.state === "object"
    ? context.state as Record<string, unknown>
    : {};
  const classification = acceptClassification(payload);
  if (classification) await applyPredatorPolicy(classification);
}
