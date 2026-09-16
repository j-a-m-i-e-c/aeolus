// Site Energy — UI composition entry point.
// At a glance: solar margin and battery reserve decide whether discretionary loads may run.

import SiteEnergyDashboard from "./SiteEnergyDashboard";

import { createDemoActions } from "./demo-actions";

export default function SiteEnergy(aeolus: CustomComponentProps) {
  const model = {
    batterySoc: aeolus.read("batterySoc"),
    solarKw: aeolus.read("solarKw"),
    loadKw: aeolus.read("loadKw"),
    baseLoadKw: aeolus.read("baseLoadKw"),
    pumpKw: aeolus.read("pumpKw"),
    chargerKw: aeolus.read("chargerKw"),
    chargerOn: aeolus.read("chargerOn"),
    batteryAvailable: aeolus.read("batteryAvailable"),
    allowed: aeolus.read("allowed"),
    solarMarginKw: aeolus.read("solarMarginKw"),
    netKw: aeolus.read("netKw"),
    energyMode: aeolus.read("energyMode"),
    autoOpportunity: aeolus.read("autoOpportunity"),
    chargerCommandPending: aeolus.read("chargerCommandPending"),
    demoScenarioPending: aeolus.read("demoScenarioPending"),
    lastAction: aeolus.read("lastAction"),
  };

  const actions = {
    toggleOpportunity: () => aeolus.fire("toggle-opportunity"),
    ...createDemoActions(aeolus),
  };

  return <SiteEnergyDashboard model={model} actions={actions} />;
}
