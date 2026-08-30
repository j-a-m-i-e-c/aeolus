// Air & Filtration — orchestration entry point.
// Read the flow here; command and projection detail lives in Files.

import { projectAirState, setBunkerSeal } from "./air-control";

export default async function run(context: EventContext) {
  const topic = String(context.topic || "");
  const event = topic.split("/").pop();

  if (topic.startsWith("ui/")) {
    if (event === "seal") await setBunkerSeal(true);
    if (event === "unseal") await setBunkerSeal(false);
    return;
  }

  if (topic === "switch/bunker/filter/state") {
    projectAirState();
  }
}
