// Dewatering — UI composition entry point.
// State selection and operator intent stay visible; rendering detail lives in Files.

import DewateringPanel from "./DewateringPanel";

export default function Dewatering(aeolus: CustomComponentProps) {
  const model = {
    levelM: aeolus.read("levelM"),
    inflowLps: aeolus.read("inflowLps"),
    dischargeLps: aeolus.read("dischargeLps"),
    pumpOn: aeolus.read("pumpOn"),
    pumpFlowLps: aeolus.read("pumpFlowLps"),
    autoEnabled: aeolus.read("autoEnabled"),
    commandPending: aeolus.read("commandPending"),
    lastAction: aeolus.read("lastAction"),
  };

  const actions = {
    toggleAuto: () => aeolus.fire("toggle-auto"),
    pumpOn: () => aeolus.fire("pump-on"),
    pumpOff: () => aeolus.fire("pump-off"),
    simulateHeavyInflow: () => aeolus.fire("simulate-heavy-inflow"),
    resetSump: () => aeolus.fire("reset-sump"),
  };

  return <DewateringPanel model={model} actions={actions} />;
}
