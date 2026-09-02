// Water Management — orchestration entry point.
// The main control loop is readable here; device/command detail stays in Files.

import {
  handleWaterOperatorEvent,
  initialiseWaterState,
  isWaterTelemetry,
  projectWaterTelemetry,
  publishSourceReserve,
  reconcileBatchTransfer,
  reconcileWaterPolicy,
} from "./water-control";

export default async function run(context: EventContext) {
  const topic = String(context.topic || "");
  const event = topic.split("/").pop();

  initialiseWaterState();

  if (topic.startsWith("ui/")) {
    await handleWaterOperatorEvent(event);
    return;
  }

  if (!isWaterTelemetry(topic)) return;

  const water = projectWaterTelemetry(topic);
  const pumpOn = await reconcileBatchTransfer(water);

  publishSourceReserve(water);
  await reconcileWaterPolicy(water, pumpOn);
}
