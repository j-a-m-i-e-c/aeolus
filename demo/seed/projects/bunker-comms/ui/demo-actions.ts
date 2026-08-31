// Public-showcase-only stimuli. Normal operator intents stay in ui/index.tsx.
export function createDemoActions(aeolus: CustomComponentProps) {
  return {
    simulateContact: () => aeolus.fire("simulate-contact"),
  };
}
