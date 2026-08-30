// Personnel & Muster — orchestration entry point.
// Tracking stays passive until an operator asks the muster controller to act.

import { commandMuster, handlePersonnelDemoEvent, projectPersonnelState } from "./personnel-muster";

export default async function run(context: EventContext) {
  const topic = String(context.topic || "");
  const event = topic.split("/").pop();

  if (topic.startsWith("ui/")) {
    if (event === "initiate-muster") await commandMuster(true);
    else if (event === "clear-muster") await commandMuster(false);
    else handlePersonnelDemoEvent(event);
    return;
  }

  if (topic === "sensor/mine/personnel") {
    projectPersonnelState();
  }
}
