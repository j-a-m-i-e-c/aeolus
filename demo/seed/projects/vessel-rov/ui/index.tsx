// ROV Operations — UI composition entry point.
// At a glance: depth, tether and vehicle state drive verified dive/survey/hold/recover commands.

import RovOperationsDashboard from "./RovOperationsDashboard";

import { createDemoActions } from "./demo-actions";

export default function RovOperations(aeolus: CustomComponentProps) {
  const model = {
    depth: aeolus.read("depth"),
    heading: aeolus.read("heading"),
    battery: aeolus.read("battery"),
    tetherTension: aeolus.read("tetherTension"),
    altitude: aeolus.read("altitude"),
    seabedDepth: aeolus.read("seabedDepth"),
    crossCurrentKt: aeolus.read("crossCurrentKt"),
    verticalSpeed: aeolus.read("verticalSpeed"),
    visibility: aeolus.read("visibility"),
    thrusterPct: aeolus.read("thrusterPct"),
    transectLegs: aeolus.read("transectLegs"),
    mode: aeolus.read("mode"),
    lightsOn: aeolus.read("lightsOn"),
    commandPending: aeolus.read("commandPending"),
    tetherProtectionActive: aeolus.read("tetherProtectionActive"),
    protectionAt: aeolus.read("protectionAt"),
    lastAction: aeolus.read("lastAction"),
  };

  const actions = {
    rovDive: () => aeolus.fire("rov-dive"),
    rovSurvey: () => aeolus.fire("rov-survey"),
    rovHold: () => aeolus.fire("rov-hold"),
    rovRecover: () => aeolus.fire("rov-recover"),
    ...createDemoActions(aeolus),
  };

  return <RovOperationsDashboard model={model} actions={actions} />;
}
