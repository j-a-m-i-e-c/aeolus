// Livestock & Virtual Fence — orchestration entry point.
// Collar containment and the physical energiser remain separate telemetry paths.

import {
  handleLivestockOperatorEvent,
  initialiseLivestockState,
  projectCollarTelemetry,
  projectFenceTelemetry,
} from "./livestock-control";

export default async function run(context: EventContext) {
  const topic = String(context.topic || "");
  const event = topic.split("/").pop();

  initialiseLivestockState();

  if (topic.startsWith("ui/")) {
    await handleLivestockOperatorEvent(event);
    return;
  }

  if (topic === "sensor/fence/collars") {
    projectCollarTelemetry(context);
  } else if (topic === "sensor/fence/energiser") {
    projectFenceTelemetry(context);
  }
}
