// Livestock & Virtual Fence — UI composition entry point.
// State selection and operator intent stay visible; rendering detail lives in Files.

import LivestockDashboard from "./LivestockDashboard";

export default function Livestock(aeolus: CustomComponentProps) {
  const model = {
    strays: aeolus.read("strays"),
    herd: aeolus.read("herd"),
    tracked: aeolus.read("tracked"),
    avgBattery: aeolus.read("avgBattery"),
    paddock: aeolus.read("paddock"),
    breachSector: aeolus.read("breachSector"),
    movement: aeolus.read("movement"),
    voltage: aeolus.read("voltage"),
    fenceCurrent: aeolus.read("fenceCurrent"),
    fenceFault: aeolus.read("fenceFault"),
    recallInProgress: aeolus.read("recallInProgress"),
    demoScenarioPending: aeolus.read("demoScenarioPending"),
    lastAction: aeolus.read("lastAction"),
  };

  const actions = {
    recallStrays: () => aeolus.fire("recall-strays"),
    simulateStrays: () => aeolus.fire("simulate-strays"),
    moveHerd: () => aeolus.fire("move-herd"),
    resetLivestock: () => aeolus.fire("reset-livestock"),
    toggleFenceFault: (faulted: boolean) =>
      aeolus.fire(faulted ? "restore-fence" : "simulate-fence-fault"),
  };

  return <LivestockDashboard model={model} actions={actions} />;
}
