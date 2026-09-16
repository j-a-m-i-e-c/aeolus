// Personnel & Muster — UI composition entry point.
// At a glance: underground tag telemetry becomes accountable-personnel state and an operator muster workflow.

import PersonnelMusterPanel from "./PersonnelMusterPanel";

import { createDemoActions } from "./demo-actions";

export default function PersonnelMuster(aeolus: CustomComponentProps) {
  const model = {
    underground: aeolus.read("underground"),
    l1: aeolus.read("l1"),
    l2: aeolus.read("l2"),
    l3: aeolus.read("l3"),
    refuge: aeolus.read("refuge"),
    unaccounted: aeolus.read("unaccounted"),
    musterState: aeolus.read("musterState"),
    musterActive: aeolus.read("musterActive"),
    commandPending: aeolus.read("commandPending"),
    lastAction: aeolus.read("lastAction"),
  };

  const actions = {
    initiateMuster: () => aeolus.fire("initiate-muster"),
    clearMuster: () => aeolus.fire("clear-muster"),
    ...createDemoActions(aeolus),
  };

  return <PersonnelMusterPanel model={model} actions={actions} />;
}
