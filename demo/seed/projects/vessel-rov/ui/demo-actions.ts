// Public-showcase-only stimuli. Normal operator intents stay in ui/index.tsx.
export function createDemoActions(aeolus: CustomComponentProps) {
  return {
    simulateRovCurrent: () => aeolus.fire("simulate-rov-current"),
    resetRov: () => aeolus.fire("reset-rov"),
  };
}
