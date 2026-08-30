// ROV Operations — UI composition entry point.
// State selection and operator intent stay visible; rendering detail lives in Files.

import RovOperationsDashboard from "./RovOperationsDashboard";

export default function RovOperations(aeolus: CustomComponentProps) {
  const model = {
    depth: aeolus.read("depth"),
    heading: aeolus.read("heading"),
    battery: aeolus.read("battery"),
    tetherTension: aeolus.read("tetherTension"),
    altitude: aeolus.read("altitude"),
    visibility: aeolus.read("visibility"),
    thrusterPct: aeolus.read("thrusterPct"),
    mode: aeolus.read("mode"),
    lightsOn: aeolus.read("lightsOn"),
    commandPending: aeolus.read("commandPending"),
    tetherProtectionActive: aeolus.read("tetherProtectionActive"),
    lastAction: aeolus.read("lastAction"),
  };

  const actions = {
    rovDive: () => aeolus.fire("rov-dive"),
    rovSurvey: () => aeolus.fire("rov-survey"),
    rovHold: () => aeolus.fire("rov-hold"),
    rovRecover: () => aeolus.fire("rov-recover"),
    simulateRovCurrent: () => aeolus.fire("simulate-rov-current"),
    resetRov: () => aeolus.fire("reset-rov"),
  };

  return <RovOperationsDashboard model={model} actions={actions} />;
}
