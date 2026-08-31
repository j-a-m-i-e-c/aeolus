// Puzzle Progress — UI composition entry point.
// At a glance: four physical puzzle sensors become progress, attempts and completion timing.

import PuzzleProgressPanel from "./PuzzleProgressPanel";

import { createDemoActions } from "./demo-actions";

export default function PuzzleProgress(aeolus: CustomComponentProps) {
  const model = {
    p1: aeolus.read("p1"),
    p2: aeolus.read("p2"),
    p3: aeolus.read("p3"),
    p4: aeolus.read("p4"),
    solved: aeolus.read("solved"),
    currentRoom: aeolus.read("currentRoom"),
    attempts: aeolus.read("attempts"),
    solveSeconds: aeolus.read("solveSeconds"),
    lastAction: aeolus.read("lastAction"),
  };

  const actions = {
    ...createDemoActions(aeolus),
  };

  return <PuzzleProgressPanel model={model} actions={actions} />;
}
