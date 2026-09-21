// Game Master — orchestration entry point.
// Session state, operator actions and physical exit control are intentionally visible.

import {
  handleGameMasterAction,
  initialiseGameSession,
  projectObservedRoom,
  projectPuzzleStatus,
  projectRoomLook,
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
  // no comment. Room Systems writes the applied scene to Shared State, which is what
  // actually closes the loop.
  projectRoomLook();

  if (topic.startsWith("ui/")) {
    await handleGameMasterAction(event);
    return;
  }

  // Room Systems reports a different room than before, so the console can stop waiting.
  if (topic === "escape-observed/room") {
    projectObservedRoom(payload);
    return;
  }

  if (topic !== "escape-observed/puzzles") return;

  const complete = projectPuzzleStatus(payload);
  await reconcileExitForCompletion(complete);
}
