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
    status: aeolus.read("status"),
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
    appliedLook: aeolus.read("appliedLook"),
    lookRequestedAt: aeolus.read("lookRequestedAt"),
    roomHaze: aeolus.read("roomHaze"),
    lastCommand: aeolus.read("lastCommand"),
    lastAction: aeolus.read("lastAction"),
  };

  const actions = {
    // No remaining-seconds argument any more: the Logic derives the clock from its own
    // recorded transition, so the browser cannot decide how much time is left.
    session: (event: string) => aeolus.fire(event),
    startGame: () => aeolus.fire("start-game"),
    hint: (event: string) => aeolus.fire(event),
    roomLook: (event: string) => aeolus.fire(event),
    talkStart: () => aeolus.fire("talk-start"),
    talkStop: () => aeolus.fire("talk-stop"),
  };

  return <GameMasterConsole model={model} actions={actions} />;
}
