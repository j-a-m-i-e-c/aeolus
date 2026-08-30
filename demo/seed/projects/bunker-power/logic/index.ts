// Power & Supplies — orchestration entry point.
// Telemetry is projected first; generator policy stays obvious here.

import { handlePowerDemoEvent, projectPowerAndSupplies, setGenerator } from "./power-control";

export default async function run(context: EventContext) {
  const topic = String(context.topic || "");
  const event = topic.split("/").pop();

  if (topic.startsWith("ui/")) {
    if (event === "generator-on") await setGenerator(true, "Generator started by operator");
    else if (event === "generator-off") await setGenerator(false, "Generator stopped by operator");
    else handlePowerDemoEvent(event);
    return;
  }

  if (!topic.startsWith("sensor/bunker/")) return;

  const { battery, generatorOn } = projectPowerAndSupplies();
  if (battery <= 30 && !generatorOn) {
    await setGenerator(true, "Low reserve detected · backup generator started automatically");
  }
}
