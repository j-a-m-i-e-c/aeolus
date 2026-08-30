// Sugar Glider Den — UI composition entry point.
// State selection and operator intent stay visible; rendering detail lives in Files.

import SugarGliderDenPanel from "./SugarGliderDenPanel";

export default function SugarGliderDen(aeolus: CustomComponentProps) {
  const model = {
    temp: aeolus.read("temp"),
    humidity: aeolus.read("humidity"),
    adultPresent: aeolus.read("adultPresent"),
    adultGliders: aeolus.read("adultGliders"),
    joeys: aeolus.read("joeys"),
    visits: aeolus.read("visits"),
    thermalAlert: aeolus.read("thermalAlert"),
    acknowledged: aeolus.read("acknowledged"),
    lastAction: aeolus.read("lastAction"),
  };

  const actions = {
    acknowledgeAlert: () => aeolus.fire("acknowledge-alert"),
    simulateVisit: () => aeolus.fire("simulate-visit"),
    simulateHeat: () => aeolus.fire("simulate-heat"),
    resetNest: () => aeolus.fire("reset-nest"),
  };

  return <SugarGliderDenPanel model={model} actions={actions} />;
}
