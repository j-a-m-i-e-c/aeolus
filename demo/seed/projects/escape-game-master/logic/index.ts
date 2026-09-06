// Game Master — orchestration entry point.
// Session state, operator actions and physical exit control are intentionally visible.

import {
  handleGameMasterAction,
  initialiseGameSession,
  projectPuzzleStatus,
  projectRoomLook,
  reconcileExitForCompletion,
} from "./game-master";

export default async function run(context: EventContext) {
  const topic = String(context.topic || "");
  const event = topic.split("/").pop();
  const payload = context.state && typeof context.state === "object"
    ? context.state as Record<string, unknown>
    : {};

  initialiseGameSession();
  // Refresh what the room is physically doing before and after acting, so the
  // console reports the controller's observed scene rather than the last thing this
  // automation asked for.
  projectRoomLook();

  if (topic.startsWith("ui/")) {
    await handleGameMasterAction(event, payload);
    projectRoomLook();
    return;
  }

  if (!topic.includes("/escape/puzzles/status")) return;

  const complete = projectPuzzleStatus(payload);
  await reconcileExitForCompletion(complete);
  projectRoomLook();
}
