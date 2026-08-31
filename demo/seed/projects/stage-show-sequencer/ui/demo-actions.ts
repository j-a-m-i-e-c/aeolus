// Public-showcase-only stimuli. Normal operator intents stay in ui/index.tsx.
export function createDemoActions(aeolus: CustomComponentProps) {
  return {
    simulateTrip: () => aeolus.fire("simulate-trip"),
    resetSafety: () => aeolus.fire("reset-safety"),
  };
}
