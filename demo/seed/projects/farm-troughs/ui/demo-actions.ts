// Public-showcase-only stimuli. Normal operator intents stay in ui/index.tsx.
export function createDemoActions(aeolus: CustomComponentProps) {
  return {
    simulateDrinking: () => aeolus.fire("simulate-drinking"),
    resetTroughs: () => aeolus.fire("reset-troughs"),
  };
}
