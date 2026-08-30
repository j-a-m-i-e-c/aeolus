// Water Management — UI composition entry point.
// State selection and operator intent stay visible; rendering detail lives in Files.

import WaterManagementDashboard from "./WaterManagementDashboard";

export default function WaterManagement(aeolus: CustomComponentProps) {
  const model = {
    damPct: aeolus.read("damPct"),
    headerPct: aeolus.read("headerPct"),
    shedPct: aeolus.read("shedPct"),
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
    lastAction: aeolus.read("lastAction"),
  };

  const actions = {
    transfer500: () => aeolus.fire("transfer-500"),
    transfer1000: () => aeolus.fire("transfer-1000"),
    pumpStop: () => aeolus.fire("pump-stop"),
    simulateHeaderLow: () => aeolus.fire("simulate-header-low"),
    simulatePropertyDemand: () => aeolus.fire("simulate-property-demand"),
    resetWater: () => aeolus.fire("reset-water"),
  };

  return <WaterManagementDashboard model={model} actions={actions} />;
}
