// Room Systems — UI composition entry point.
// At a glance: room scene state and physical FX controls are projected into one operator surface.

import RoomSystemsPanel from "./RoomSystemsPanel";

export default function RoomSystems(aeolus: CustomComponentProps) {
  const model = {
    scene: aeolus.read("scene"),
    smoke: aeolus.read("smoke"),
    audio: aeolus.read("audio"),
    lightPct: aeolus.read("lightPct"),
    pending: aeolus.read("pending"),
    transitioning: aeolus.read("transitioning"),
    changedAt: aeolus.read("changedAt"),
    lastAction: aeolus.read("lastAction"),
  };

  const actions = {
    toggleSmoke: () => aeolus.fire("toggle-smoke"),
  };

  return <RoomSystemsPanel model={model} actions={actions} />;
}
