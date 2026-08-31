// Underway Science — UI composition entry point.
// At a glance: continuous seawater telemetry exposes fronts and controls the sampling pump.

import UnderwayScienceDashboard from "./UnderwayScienceDashboard";

import { createDemoActions } from "./demo-actions";

export default function UnderwayScience(aeolus: CustomComponentProps) {
  const model = {
    sst: aeolus.read("sst"),
    salinity: aeolus.read("salinity"),
    flow: aeolus.read("flow"),
    chlorophyll: aeolus.read("chlorophyll"),
    turbidity: aeolus.read("turbidity"),
    pumpOn: aeolus.read("pumpOn"),
    frontDetected: aeolus.read("frontDetected"),
    commandPending: aeolus.read("commandPending"),
    profile: aeolus.read("profile"),
    lastAction: aeolus.read("lastAction"),
  };

  const actions = {
    samplingStart: () => aeolus.fire("sampling-start"),
    samplingStop: () => aeolus.fire("sampling-stop"),
    ...createDemoActions(aeolus),
  };

  return <UnderwayScienceDashboard model={model} actions={actions} />;
}
