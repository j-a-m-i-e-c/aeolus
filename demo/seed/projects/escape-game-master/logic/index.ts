// Game Master — orchestration entry point.
// Session state, operator actions and physical exit control are intentionally visible.

import {
  handleGameMasterAction,
  initialiseGameSession,
  projectPuzzleStatus,
  projectRoomLook,
  projectRoomLookOutcome,
  reconcileExitForCompletion,
  reconcileExpiry,
} from "./game-master";

export default async function run(context: EventContext) {
  const topic = String(context.topic || "");
  const event = topic.split("/").pop();
  const payload = context.state && typeof context.state === "object"
    ? context.state as Record<string, unknown>
    : {};

  initialiseGameSession();
  // A session that has run out of time is retired here, so the recorded status catches
  // up with the clock the next time anything wakes this automation.
  reconcileExpiry();
  // What the room is physically doing, read once, here.
  //
  // This used to be called again after each action, on the stated reasoning that it
  // refreshed the scene "before and after acting". It cannot: devices.list() is a
  // snapshot serialised into the isolate once per execution, so a second read returns
  // the same values as the first. The repeat was harmless — identical values written
  // twice — but the reasoning was the same one that produced real misreports in nine
  // other projects, and a comment claiming a refresh that cannot happen is worse than
  // no comment. Room Systems reports the applied scene back through
  // `escape/observed/room-look`, which is what actually closes the loop.
  projectRoomLook();

  if (topic.startsWith("ui/")) {
    await handleGameMasterAction(event);
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
}
