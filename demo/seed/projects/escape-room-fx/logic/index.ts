// Room Systems — orchestration entry point.
// Game Master requests a look; this automation owns the physical FX controller.

import { initialiseRoomSystems, setRoomScene, toggleHaze } from "./room-systems";

export default async function run(context: EventContext) {
  const topic = String(context.topic || "");
  const event = topic.split("/").pop();
  const payload = context.state && typeof context.state === "object"
    ? context.state as Record<string, unknown>
    : {};

  initialiseRoomSystems();

  if (topic.startsWith("ui/")) {
    if (event === "toggle-smoke") await toggleHaze();
    return;
  }

  if (topic.includes("/escape/game/look-request")) {
    await setRoomScene(
      String(payload.scene || "puzzle"),
      Boolean(state.get("smoke")),
      "Room look transitioned to " + String(payload.scene || "puzzle"),
    );
  } else if (topic.includes("/escape/game/completed")) {
    await setRoomScene("victory", false, "Victory look triggered by game completion");
  }
}
