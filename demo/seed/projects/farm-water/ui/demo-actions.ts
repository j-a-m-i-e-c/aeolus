// Public-showcase-only stimuli. The real operator actions stay in ui/index.tsx.
export function createWaterDemoActions(aeolus: CustomComponentProps) {
  return {
    simulateHeaderLow: () => aeolus.fire("simulate-header-low"),
    simulatePropertyDemand: () => aeolus.fire("simulate-property-demand"),
    resetWater: () => aeolus.fire("reset-water"),
  };
}
