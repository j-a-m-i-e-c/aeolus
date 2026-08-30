// Site Energy — orchestration entry point.
// Priority is explicit: protect reserve, publish permission, then use surplus energy.

import {
  handleEnergyOperatorEvent,
  initialiseEnergyState,
  projectEnergyTelemetry,
  publishEnergyPolicy,
  reconcileOpportunityLoad,
} from "./energy-control";

export default async function run(context: EventContext) {
  const topic = String(context.topic || "");
  const event = topic.split("/").pop();

  initialiseEnergyState();

  if (topic.startsWith("ui/")) {
    await handleEnergyOperatorEvent(event);
    return;
  }

  if (topic !== "sensor/farm/energy/battery") return;

  const energy = projectEnergyTelemetry(context);
  publishEnergyPolicy(energy);

  // Charger-bank automation is intentionally lowest priority.
  await reconcileOpportunityLoad(energy);
}
