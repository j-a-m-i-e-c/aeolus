// Sugar Glider Den — orchestration entry point.
// Den-box telemetry drives a verified cooling response, not an alert to dismiss.

import {
  applyThermalPolicy,
  handleDenOperatorEvent,
  initialiseDenPolicy,
  projectDenTelemetry,
  projectFanReadings,
} from "./den-monitoring";

export default async function run(context: EventContext) {
  const topic = String(context.topic || "");
  const event = topic.split("/").pop();

  initialiseDenPolicy();
  // The pane cannot read devices, so every invocation refreshes the fan and power
  // readings before any policy decision is made or displayed.
  projectFanReadings();

  if (topic.startsWith("ui/")) {
    await handleDenOperatorEvent(event);
    return;
  }

  if (topic === "sensor/wildlife/nest") {
    const reading = projectDenTelemetry();
    await applyThermalPolicy(reading);
  }
}
