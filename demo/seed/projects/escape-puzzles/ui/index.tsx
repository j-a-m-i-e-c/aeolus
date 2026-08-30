// Puzzle Progress — UI composition entry point.
// State selection and operator intent stay visible; rendering detail lives in Files.

import PuzzleProgressPanel from "./PuzzleProgressPanel";

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
    simulateSolve: () => aeolus.fire("simulate-solve"),
    resetPuzzles: () => aeolus.fire("reset-puzzles"),
  };

  return <PuzzleProgressPanel model={model} actions={actions} />;
}
