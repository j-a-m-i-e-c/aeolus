// Underway Science — orchestration entry point.
// Surface telemetry builds a short profile and detects hydrographic fronts in-stream.

import {
  detectHydrographicFront,
  handleUnderwayDemoEvent,
  projectUnderwayState,
  setSamplingPump,
} from "./underway-science";

export default async function run(context: EventContext) {
  const topic = String(context.topic || "");
  const event = topic.split("/").pop();

  if (topic.startsWith("ui/")) {
    if (event === "sampling-start") await setSamplingPump(true);
    else if (event === "sampling-stop") await setSamplingPump(false);
    else handleUnderwayDemoEvent(event);
    return;
  }

  const previousSst = Number(state.get("sst"));
  const previousSalinity = Number(state.get("salinity"));
  const underway = projectUnderwayState();
  detectHydrographicFront(previousSst, previousSalinity, underway);
}
