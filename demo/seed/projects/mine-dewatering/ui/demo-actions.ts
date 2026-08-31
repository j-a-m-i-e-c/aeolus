// Public-showcase-only stimuli. Normal operator intents stay in ui/index.tsx.
export function createDemoActions(aeolus: CustomComponentProps) {
  return {
    simulateHeavyInflow: () => aeolus.fire("simulate-heavy-inflow"),
    resetSump: () => aeolus.fire("reset-sump"),
  };
}
