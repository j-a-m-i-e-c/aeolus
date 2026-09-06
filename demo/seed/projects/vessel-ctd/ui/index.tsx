// CTD Operations — UI composition entry point.
// At a glance: CTD depth/chemistry and cable tension surround verified deploy, hold and recover commands.

import CtdOperationsDashboard from "./CtdOperationsDashboard";

import { createDemoActions } from "./demo-actions";

export default function CtdOperations(aeolus: CustomComponentProps) {
  const model = {
    depth: aeolus.read("depth"),
    targetDepth: aeolus.read("targetDepth"),
    status: aeolus.read("status"),
    temperature: aeolus.read("temperature"),
    salinity: aeolus.read("salinity"),
    oxygen: aeolus.read("oxygen"),
    tension: aeolus.read("tension"),
    verticalSpeed: aeolus.read("verticalSpeed"),
    commandPending: aeolus.read("commandPending"),
    interlockAt: aeolus.read("interlockAt"),
    lastCommand: aeolus.read("lastCommand"),
    lastAction: aeolus.read("lastAction"),
  };

  const actions = {
    deploy420: () => aeolus.fire("deploy-420"),
    holdCtd: () => aeolus.fire("hold-ctd"),
    recoverCtd: () => aeolus.fire("recover-ctd"),
    ...createDemoActions(aeolus),
  };

  return <CtdOperationsDashboard model={model} actions={actions} />;
}
