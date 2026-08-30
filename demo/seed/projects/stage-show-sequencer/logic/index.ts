// Show Control — orchestration entry point.
// Lighting cues execute first; physical FX run only after safety permissives pass.

import {
  executeCue,
  fireOperatorEffect,
  handleStageDemoEvent,
  projectStageState,
  stopPhysicalEffects,
} from "./show-control";

export default async function run(context: EventContext) {
  const topic = String(context.topic || "");
  const event = topic.split("/").pop();
  const payload = context.state && typeof context.state === "object"
    ? context.state as Record<string, unknown>
    : {};

  if (topic.startsWith("ui/")) {
    if (event === "run-cue") await executeCue(payload);
    else if (event === "fire-effect") await fireOperatorEffect(payload);
    else if (event === "stop-fx") await stopPhysicalEffects();
    else handleStageDemoEvent(event);
    return;
  }

  if (topic.includes("/stage/")) {
    projectStageState();
  }
}
