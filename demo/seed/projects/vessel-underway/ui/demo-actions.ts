// Public-showcase-only stimuli. Normal operator intents stay in ui/index.tsx.
export function createDemoActions(aeolus: CustomComponentProps) {
  return {
    simulateFront: () => aeolus.fire("simulate-front"),
    resetUnderway: () => aeolus.fire("reset-underway"),
  };
}
