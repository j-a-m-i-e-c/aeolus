// Sugar Glider Den — UI composition entry point.
// At a glance: den temperature and occupancy become a quiet monitoring/thermal-alert workflow.

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
    thermalAlert: aeolus.read("thermalAlert"),
    acknowledged: aeolus.read("acknowledged"),
    lastAction: aeolus.read("lastAction"),
  };

  const actions = {
    acknowledgeAlert: () => aeolus.fire("acknowledge-alert"),
    ...createDemoActions(aeolus),
  };

  return <SugarGliderDenPanel model={model} actions={actions} />;
}
