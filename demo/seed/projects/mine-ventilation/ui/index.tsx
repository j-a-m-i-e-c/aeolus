// Ventilation Control — UI composition entry point.
// State selection and operator intent stay visible; rendering detail lives in Files.

import VentilationControlPanel from "./VentilationControlPanel";

export default function VentilationControl(aeolus: CustomComponentProps) {
  const model = {
    mode: aeolus.read("mode"),
    demand: aeolus.read("demand"),
    requestedDemand: aeolus.read("requestedDemand"),
    primaryRpm: aeolus.read("primaryRpm"),
    boosterRpm: aeolus.read("boosterRpm"),
    airflow: aeolus.read("airflow"),
    manualOverride: aeolus.read("manualOverride"),
    commandPending: aeolus.read("commandPending"),
    atmosphereSeverity: aeolus.read("atmosphereSeverity"),
    lastAction: aeolus.read("lastAction"),
  };

  const actions = {
    forceBoost: () => aeolus.fire("force-boost"),
    returnAuto: () => aeolus.fire("return-auto"),
  };

  return <VentilationControlPanel model={model} actions={actions} />;
}
