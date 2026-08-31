// Game Master — UI composition entry point.
// At a glance: the operator runs time, hints, room looks and intercom while puzzle/room state flows in live.

import GameMasterConsole from "./GameMasterConsole";

export default function GameMaster(aeolus: CustomComponentProps) {
  const model = {
    solved: aeolus.read("solved"),
    p1: aeolus.read("p1"),
    p2: aeolus.read("p2"),
    p3: aeolus.read("p3"),
    p4: aeolus.read("p4"),
    remaining: aeolus.read("remaining"),
    timerStartedAt: aeolus.read("timerStartedAt"),
    paused: aeolus.read("paused"),
    exitUnlocked: aeolus.read("exitUnlocked"),
    currentRoom: aeolus.read("currentRoom"),
    hintsSent: aeolus.read("hintsSent"),
    lastHint: aeolus.read("lastHint"),
    lastHintId: aeolus.read("lastHintId"),
    hintRoom: aeolus.read("hintRoom"),
    pendingHint: aeolus.read("pendingHint"),
    intercomTx: aeolus.read("intercomTx"),
    intercomPending: aeolus.read("intercomPending"),
    requestedLook: aeolus.read("requestedLook"),
    lastAction: aeolus.read("lastAction"),
  };

  const actions = {
    session: (event: string, remaining: number) => aeolus.fire(event, { remaining }),
    hint: (event: string) => aeolus.fire(event),
    roomLook: (event: string) => aeolus.fire(event),
    talkStart: () => aeolus.fire("talk-start"),
    talkStop: () => aeolus.fire("talk-stop"),
  };

  return <GameMasterConsole model={model} actions={actions} />;
}
