// Water Management — UI entry point.
// At a glance: shed catchment -> transfer pump -> header tank -> house + office.
// The operator requests verified water transfers; the separate demo helper only injects outside conditions.

import WaterManagementDashboard from "./WaterManagementDashboard";
import { createWaterDemoActions } from "./demo-actions";

export default function WaterManagement(aeolus: CustomComponentProps) {
  const water = {
    sourcePct: aeolus.read("damPct"),
    headerPct: aeolus.read("headerPct"),
    officePct: aeolus.read("shedPct"),
    housePct: aeolus.read("housePct"),
    pumpOn: aeolus.read("pumpOn"),
    flowLpm: aeolus.read("flowLpm"),
    batterySoc: aeolus.read("batterySoc"),
    energyAllowed: aeolus.read("energyAllowed"),
    distributionActive: aeolus.read("distributionActive"),
    houseRefillActive: aeolus.read("houseRefillActive"),
    shedRefillActive: aeolus.read("shedRefillActive"),
    transferActive: aeolus.read("transferActive"),
    transferStopping: aeolus.read("transferStopping"),
    transferMode: aeolus.read("transferMode"),
    transferTargetLitres: aeolus.read("transferTargetLitres"),
    transferProgressLitres: aeolus.read("transferProgressLitres"),
    flowTotalLitres: aeolus.read("flowTotalLitres"),
    lastTransferLitres: aeolus.read("lastTransferLitres"),
    demoScenarioPending: aeolus.read("demoScenarioPending"),
    lastCommand: aeolus.read("lastCommand"),
    lastAction: aeolus.read("lastAction"),
  };

  const operatorActions = {
    transfer500: () => aeolus.fire("transfer-500"),
    transfer1000: () => aeolus.fire("transfer-1000"),
    pumpStop: () => aeolus.fire("pump-stop"),
  };

  return (
    <WaterManagementDashboard
      model={water}
      actions={{ ...operatorActions, ...createWaterDemoActions(aeolus) }}
    />
  );
}
