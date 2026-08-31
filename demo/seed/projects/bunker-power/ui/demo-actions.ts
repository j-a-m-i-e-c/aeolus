// Public-showcase-only stimuli. Normal operator intents stay in ui/index.tsx.
export function createDemoActions(aeolus: CustomComponentProps) {
  return {
    simulateLowPower: () => aeolus.fire("simulate-low-power"),
    resetPower: () => aeolus.fire("reset-power"),
  };
}
