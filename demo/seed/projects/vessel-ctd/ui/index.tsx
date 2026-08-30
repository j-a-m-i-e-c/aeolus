// CTD Operations — UI composition entry point.
// State selection and operator intent stay visible; rendering detail lives in Files.

import CtdOperationsDashboard from "./CtdOperationsDashboard";

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
    lastAction: aeolus.read("lastAction"),
  };

  const actions = {
    deploy420: () => aeolus.fire("deploy-420"),
    holdCtd: () => aeolus.fire("hold-ctd"),
    recoverCtd: () => aeolus.fire("recover-ctd"),
    simulateSnag: () => aeolus.fire("simulate-snag"),
    resetCtd: () => aeolus.fire("reset-ctd"),
  };

  return <CtdOperationsDashboard model={model} actions={actions} />;
}
