// Public-showcase-only stimuli. Normal operator intents stay in ui/index.tsx.
export function createDemoActions(aeolus: CustomComponentProps) {
  return {
    simulateSolve: () => aeolus.fire("simulate-solve"),
    resetPuzzles: () => aeolus.fire("reset-puzzles"),
  };
}
