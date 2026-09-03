// Sugar Glider Den — UI composition entry point.
// At a glance: a hot den box triggers verified cooling and the box measurably recovers.

import SugarGliderDenPanel from "./SugarGliderDenPanel";

import { createDemoActions } from "./demo-actions";

export default function SugarGliderDen(aeolus: CustomComponentProps) {
  const model = {
    temp: aeolus.read("temp"),
    humidity: aeolus.read("humidity"),
    adultPresent: aeolus.read("adultPresent"),
    adultGliders: aeolus.read("adultGliders"),
    joeys: aeolus.read("joeys"),
    visits: aeolus.read("visits"),
    thermalState: aeolus.read("thermalState"),
    thermalAlert: aeolus.read("thermalAlert"),
    autoCooling: aeolus.read("autoCooling"),
    commandPending: aeolus.read("commandPending"),
    fanActive: aeolus.read("fanActive"),
    fanCommandRpm: aeolus.read("fanCommandRpm"),
    fanMeasuredRpm: aeolus.read("fanMeasuredRpm"),
    fanTargetRpm: aeolus.read("fanTargetRpm"),
    fanRunsToday: aeolus.read("fanRunsToday"),
    coolingVerifiedAt: aeolus.read("coolingVerifiedAt"),
    coolingOutcome: aeolus.read("coolingOutcome"),
    solarW: aeolus.read("solarW"),
    batteryPct: aeolus.read("batteryPct"),
    lastAction: aeolus.read("lastAction"),
  };

  const actions = {
    toggleAutoCooling: () => aeolus.fire("toggle-auto-cooling"),
    stopCooling: () => aeolus.fire("stop-cooling"),
    ...createDemoActions(aeolus),
  };

  return <SugarGliderDenPanel model={model} actions={actions} />;
}
