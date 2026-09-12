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

  // Sensors and the deterrent switch both wake this automation. The deterrent is read
  // only so the pane can show what the classification led to; actuating it belongs to
  // Predator Response and happens nowhere in this project.
  if (!topic.includes("/wildlife/")) return;

  const station = projectWildlifeStation();
  publishNewClassification(station);
}
