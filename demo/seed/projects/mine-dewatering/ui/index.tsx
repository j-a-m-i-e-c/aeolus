// Dewatering — UI composition entry point.
// At a glance: sump level drives an obvious AUTO start/stop policy around a verified physical pump.

import DewateringPanel from "./DewateringPanel";

import { createDemoActions } from "./demo-actions";

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
    ...createDemoActions(aeolus),
  };

  return <DewateringPanel model={model} actions={actions} />;
}
