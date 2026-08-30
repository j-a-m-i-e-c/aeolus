// Dewatering — orchestration entry point.
// AUTO policy is intentionally obvious: start high, stop after recovery.

import {
  commandSumpPump,
  handleDewateringOperatorEvent,
  initialiseDewatering,
  projectDewateringState,
} from "./dewatering-control";

export default async function run(context: EventContext) {
  const topic = String(context.topic || "");
  const event = topic.split("/").pop();

  initialiseDewatering();

  if (topic.startsWith("ui/")) {
    await handleDewateringOperatorEvent(event);
    return;
  }

  if (topic !== "sensor/mine/sump/deep") return;

  const { levelM, pumpOn } = projectDewateringState();
  if (state.get("autoEnabled") === false) return;

  if (levelM >= 3.5 && !pumpOn) {
    await commandSumpPump(true, "High sump level · automatic pump start");
  } else if (levelM <= 1.5 && pumpOn) {
    await commandSumpPump(false, "Sump recovered · automatic pump stop");
  }
}
