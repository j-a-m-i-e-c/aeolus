// Atmospheric Safety — UI composition entry point.
// At a glance: multi-gas telemetry becomes a safety band, alarm state and ventilation demand.

import AtmosphericSafetyPanel from "./AtmosphericSafetyPanel";

import { createDemoActions } from "./demo-actions";

export default function AtmosphericSafety(aeolus: CustomComponentProps) {
  const model = {
    l3Ch4: aeolus.read("l3Ch4"),
    d7Ch4: aeolus.read("d7Ch4"),
    co: aeolus.read("co"),
    o2: aeolus.read("o2"),
    no2: aeolus.read("no2"),
    severity: aeolus.read("severity"),
    alarm: aeolus.read("alarm"),
    acknowledged: aeolus.read("acknowledged"),
    ventDemand: aeolus.read("ventDemand"),
    lastAction: aeolus.read("lastAction"),
  };

  const actions = {
    acknowledgeAlarm: () => aeolus.fire("acknowledge-alarm"),
    ...createDemoActions(aeolus),
  };

  return <AtmosphericSafetyPanel model={model} actions={actions} />;
}
