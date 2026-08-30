// Personnel & Muster — UI composition entry point.
// State selection and operator intent stay visible; rendering detail lives in Files.

import PersonnelMusterPanel from "./PersonnelMusterPanel";

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
    simulateTagDropout: () => aeolus.fire("simulate-tag-dropout"),
    resetPersonnel: () => aeolus.fire("reset-personnel"),
  };

  return <PersonnelMusterPanel model={model} actions={actions} />;
}
