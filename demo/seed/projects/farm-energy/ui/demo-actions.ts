// Public-showcase-only stimuli. Normal operator intents stay in ui/index.tsx.
export function createDemoActions(aeolus: CustomComponentProps) {
  return {
    simulateLowBattery: () => aeolus.fire("simulate-low-battery"),
    restoreBattery: () => aeolus.fire("restore-battery"),
    resetEnergy: () => aeolus.fire("reset-energy"),
  };
}
