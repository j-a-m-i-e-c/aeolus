// Public-showcase-only stimuli. Normal operator intents stay in ui/index.tsx.
export function createDemoActions(aeolus: CustomComponentProps) {
  return {
    simulateTagDropout: () => aeolus.fire("simulate-tag-dropout"),
    resetPersonnel: () => aeolus.fire("reset-personnel"),
  };
}
