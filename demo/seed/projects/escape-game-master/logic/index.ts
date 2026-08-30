// Game Master — orchestration entry point.
// Session state, operator actions and physical exit control are intentionally visible.

import {
  handleGameMasterAction,
  initialiseGameSession,
  projectPuzzleStatus,
  reconcileExitForCompletion,
} from "./game-master";

export default async function run(context: EventContext) {
  const topic = String(context.topic || "");
  const event = topic.split("/").pop();
  const payload = context.state && typeof context.state === "object"
    ? context.state as Record<string, unknown>
    : {};

  initialiseGameSession();

  if (topic.startsWith("ui/")) {
    await handleGameMasterAction(event, payload);
    return;
  }

  if (!topic.includes("/escape/puzzles/status")) return;

  const complete = projectPuzzleStatus(payload);
  await reconcileExitForCompletion(complete);
}
