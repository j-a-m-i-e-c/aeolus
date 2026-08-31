// Livestock & Virtual Fence — UI composition entry point.
// At a glance: herd location, virtual-fence state and collar health feed recall and movement decisions.

import LivestockDashboard from "./LivestockDashboard";

import { createDemoActions } from "./demo-actions";

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
    ...createDemoActions(aeolus),
  };

  return <LivestockDashboard model={model} actions={actions} />;
}
