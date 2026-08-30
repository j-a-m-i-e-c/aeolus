// Perimeter Security — orchestration entry point.
// The key policy is visible: contacts drive floodlights while AUTO is enabled.

import {
  describePerimeter,
  handlePerimeterOperatorEvent,
  projectFloodlightState,
  projectPerimeterTelemetry,
  publishPerimeterSummary,
  setFloodlights,
} from "./perimeter-control";

export default async function run(context: EventContext) {
  const topic = String(context.topic || "");
  const event = topic.split("/").pop();
  const { observed: lightsOn, drifted } = projectFloodlightState();

  if (topic.startsWith("ui/")) {
    await handlePerimeterOperatorEvent(event, lightsOn);
    return;
  }

  if (topic !== "sensor/bunker/perimeter") {
    if (drifted) publishPerimeterSummary();
    return;
  }

  const { contacts, sector } = projectPerimeterTelemetry();
  const desiredLights = contacts > 0;

  if (Boolean(state.get("autoLights")) && lightsOn !== desiredLights) {
    await setFloodlights(
      desiredLights,
      desiredLights
        ? "AUTO · perimeter contact enabled floodlights"
        : "AUTO · all clear, floodlights off",
    );
  } else {
    describePerimeter(contacts, sector);
  }

  publishPerimeterSummary();
}
