// Wildlife Detection — orchestration entry point.
// Edge telemetry is projected locally; only new classifications become domain events.

import {
  handleWildlifeDemoEvent,
  projectWildlifeStation,
  publishNewClassification,
} from "./detection-pipeline";

export default async function run(context: EventContext) {
  const topic = String(context.topic || "");
  const event = topic.split("/").pop();

  if (topic.startsWith("ui/")) {
    handleWildlifeDemoEvent(event);
    return;
  }

  if (!topic.startsWith("sensor/wildlife/")) return;

  const station = projectWildlifeStation();
  publishNewClassification(station);
}
