// Public-showcase-only stimuli. Normal operator intents stay in ui/index.tsx.
export function createDemoActions(aeolus: CustomComponentProps) {
  return {
    simulateStrays: () => aeolus.fire("simulate-strays"),
    moveHerd: () => aeolus.fire("move-herd"),
    resetLivestock: () => aeolus.fire("reset-livestock"),
    toggleFenceFault: (faulted: boolean) => aeolus.fire(faulted ? "restore-fence" : "simulate-fence-fault"),
  };
}
