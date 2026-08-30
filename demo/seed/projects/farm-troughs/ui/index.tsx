// Trough Watering — UI composition entry point.
// State selection and operator intent stay visible; rendering detail lives in Files.

import TroughWateringDashboard from "./TroughWateringDashboard";

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
    simulateDrinking: () => aeolus.fire("simulate-drinking"),
    resetTroughs: () => aeolus.fire("reset-troughs"),
  };

  return <TroughWateringDashboard model={model} actions={actions} />;
}
