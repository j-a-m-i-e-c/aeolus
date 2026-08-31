// Public-showcase-only stimuli. Normal operator intents stay in ui/index.tsx.
export function createDemoActions(aeolus: CustomComponentProps) {
  return {
    simulateContacts: () => aeolus.fire("simulate-contacts"),
    clearPerimeter: () => aeolus.fire("clear-perimeter"),
  };
}
