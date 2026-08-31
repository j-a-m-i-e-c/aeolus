// Public-showcase-only stimuli. Normal operator intents stay in ui/index.tsx.
export function createDemoActions(aeolus: CustomComponentProps) {
  return {
    simulateGasRise: () => aeolus.fire("simulate-gas-rise"),
    resetAtmosphere: () => aeolus.fire("reset-atmosphere"),
  };
}
