// Communications — UI composition entry point.
// At a glance: VHF listening/transmit state and contact activity; demo stimuli imitate transmissions arriving from outside.

import CommunicationsPanel from "./CommunicationsPanel";

import { createDemoActions } from "./demo-actions";

export default function Communications(aeolus: CustomComponentProps) {
  const model = {
    frequency: aeolus.read("frequency"),
    signal: aeolus.read("signal"),
    message: aeolus.read("message"),
    contactsToday: aeolus.read("contactsToday"),
    txUntil: aeolus.read("txUntil"),
    pending: aeolus.read("pending"),
    lastAction: aeolus.read("lastAction"),
  };

  const actions = {
    transmitCheckin: () => aeolus.fire("transmit-checkin"),
    ...createDemoActions(aeolus),
  };

  return <CommunicationsPanel model={model} actions={actions} />;
}
