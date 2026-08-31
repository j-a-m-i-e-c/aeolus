// Public-showcase-only stimuli. Normal operator intents stay in ui/index.tsx.
export function createDemoActions(aeolus: CustomComponentProps) {
  return {
    simulateVisit: () => aeolus.fire("simulate-visit"),
    simulateHeat: () => aeolus.fire("simulate-heat"),
    resetNest: () => aeolus.fire("reset-nest"),
  };
}
