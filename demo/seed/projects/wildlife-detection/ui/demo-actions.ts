// Public-showcase-only stimuli. Normal operator intents stay in ui/index.tsx.
export function createDemoActions(aeolus: CustomComponentProps) {
  return {
    simulateNative: () => aeolus.fire("simulate-native"),
    simulateFox: () => aeolus.fire("simulate-fox"),
    simulateCat: () => aeolus.fire("simulate-cat"),
    resetWildlife: () => aeolus.fire("reset-wildlife"),
  };
}
