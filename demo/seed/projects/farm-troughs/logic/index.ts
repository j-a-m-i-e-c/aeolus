// Trough Watering — orchestration entry point.
// Low-level telemetry is projected first; refill policy acts only after cattle leave.

import {
  handleTroughOperatorEvent,
  initialiseTroughState,
  projectTroughTelemetry,
  publishTroughThresholdTransitions,
  reconcileAutomaticRefill,
} from "./trough-control";

export default async function run(context: EventContext) {
  const topic = String(context.topic || "");
  const event = topic.split("/").pop();

  initialiseTroughState();

  if (topic.startsWith("ui/")) {
    await handleTroughOperatorEvent(event);
    return;
  }

  if (topic !== "sensor/farm/troughs") return;

  const troughs = projectTroughTelemetry(context);
  publishTroughThresholdTransitions(troughs);
  await reconcileAutomaticRefill(troughs);
}
