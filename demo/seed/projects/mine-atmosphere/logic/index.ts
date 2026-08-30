// Atmospheric Safety — orchestration entry point.
// Gas telemetry becomes a severity band, then a ventilation-demand event.

import { handleAtmosphereOperatorEvent, projectAtmosphere } from "./atmospheric-safety";

export default async function run(context: EventContext) {
  const topic = String(context.topic || "");
  const event = topic.split("/").pop();

  if (topic.startsWith("ui/")) {
    handleAtmosphereOperatorEvent(event);
    return;
  }

  if (topic.startsWith("sensor/mine/gas/")) {
    projectAtmosphere(true);
  }
}
