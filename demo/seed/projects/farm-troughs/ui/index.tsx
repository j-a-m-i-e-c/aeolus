// Trough Watering — UI composition entry point.
// At a glance: trough levels and herd demand drive automatic or operator-requested verified refills.

import TroughWateringDashboard from "./TroughWateringDashboard";

import { createDemoActions } from "./demo-actions";

export default function TroughWatering(aeolus: CustomComponentProps) {
  const model = {
    troughAverage: aeolus.read("troughAverage"),
    troughLow: aeolus.read("troughLow"),
    troughRefilling: aeolus.read("troughRefilling"),
    troughLevels: aeolus.read("troughLevels"),
    lowIds: aeolus.read("lowIds"),
    refillTargets: aeolus.read("refillTargets"),
    drinkingIds: aeolus.read("drinkingIds"),
    drinkingHead: aeolus.read("drinkingHead"),
    drinkingActive: aeolus.read("drinkingActive"),
    herdPresent: aeolus.read("herdPresent"),
    troughPhase: aeolus.read("troughPhase"),
    visitPaddock: aeolus.read("visitPaddock"),
    drinkingProgress: aeolus.read("drinkingProgress"),
    drinkScenarioRequested: aeolus.read("drinkScenarioRequested"),
    consumptionTodayLitres: aeolus.read("consumptionTodayLitres"),
    lastDrinkLitres: aeolus.read("lastDrinkLitres"),
    refillFlowLpm: aeolus.read("refillFlowLpm"),
    autoRefill: aeolus.read("autoRefill"),
    refillCommandActive: aeolus.read("refillCommandActive"),
    lastAction: aeolus.read("lastAction"),
  };

  const actions = {
    refillTroughs: () => aeolus.fire("refill-troughs"),
    toggleAuto: () => aeolus.fire("toggle-auto"),
    ...createDemoActions(aeolus),
  };

  return <TroughWateringDashboard model={model} actions={actions} />;
}
