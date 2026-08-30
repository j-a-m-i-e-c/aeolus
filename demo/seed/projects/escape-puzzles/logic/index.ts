// Puzzle Progress — orchestration entry point.
// Physical puzzle state is projected, then changes are published to Game Master.

import { handlePuzzleDemoEvent, projectPuzzleNetwork, publishPuzzleProgress } from "./puzzle-progress";

export default async function run(context: EventContext) {
  const topic = String(context.topic || "");
  const event = topic.split("/").pop();

  if (topic.startsWith("ui/")) {
    handlePuzzleDemoEvent(event);
    return;
  }

  if (topic !== "sensor/escape/puzzles") return;

  const progress = projectPuzzleNetwork();
  publishPuzzleProgress(progress);
}
