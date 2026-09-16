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

  if (topic.startsWith("ui/")) {
    // UI actions need the current snapshot before deciding whether a stop is valid.
    projectFanReadings();
    await handleDenOperatorEvent(event);
    return;
  }

  // The pane renders both the fan tachometer and the shared solar/battery supply.
  // Those devices therefore have to wake this automation as they change; otherwise
  // a verified command could leave a stale 0 rpm on screen until the den temperature
  // happened to publish again. The broad manifest trigger is filtered here so unrelated
  // wildlife telemetry does no policy work.
  if (topic === "switch/wildlife/den-fan/state" || topic === "sensor/wildlife/site-power") {
    projectFanReadings();
    return;
  }

  if (topic === "sensor/wildlife/nest") {
    projectFanReadings();
    const reading = projectDenTelemetry();
    await applyThermalPolicy(reading);
  }
}
