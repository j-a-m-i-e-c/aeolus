// Public-showcase-only stimuli. Normal operator intents stay in ui/index.tsx.
export function createDemoActions(aeolus: CustomComponentProps) {
  return {
    simulateSnag: () => aeolus.fire("simulate-snag"),
    resetCtd: () => aeolus.fire("reset-ctd"),
  };
}
