// Game Master — orchestration entry point.
// Session state, operator actions and physical exit control are intentionally visible.

import {
  handleGameMasterAction,
  initialiseGameSession,
  projectPuzzleStatus,
  projectRoomLook,
  projectRoomLookOutcome,
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

  // Room Systems has finished with the controller, so the console can stop waiting.
  if (topic.includes("/escape/observed/room-look")) {
    projectRoomLookOutcome(payload);
    return;
  }

  if (!topic.includes("/escape/observed/puzzles")) return;

  const complete = projectPuzzleStatus(payload);
  await reconcileExitForCompletion(complete);
  projectRoomLook();
}
