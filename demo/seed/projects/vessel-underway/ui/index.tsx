// Underway Science — UI composition entry point.
// State selection and operator intent stay visible; rendering detail lives in Files.

import UnderwayScienceDashboard from "./UnderwayScienceDashboard";

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
    simulateFront: () => aeolus.fire("simulate-front"),
    resetUnderway: () => aeolus.fire("reset-underway"),
  };

  return <UnderwayScienceDashboard model={model} actions={actions} />;
}
