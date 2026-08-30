// Sugar Glider Den — orchestration entry point.
// A passive nest sensor becomes a transition-based thermal alert stream.

import { handleDenOperatorEvent, projectDenTelemetry } from "./den-monitoring";

export default async function run(context: EventContext) {
  const topic = String(context.topic || "");
  const event = topic.split("/").pop();

  if (topic.startsWith("ui/")) {
    handleDenOperatorEvent(event);
    return;
  }

  if (topic === "sensor/wildlife/nest") {
    projectDenTelemetry();
  }
}
