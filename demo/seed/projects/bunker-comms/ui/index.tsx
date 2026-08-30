// Communications — UI composition entry point.
// State selection and operator intent stay visible; rendering detail lives in Files.

import CommunicationsPanel from "./CommunicationsPanel";

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
    simulateContact: () => aeolus.fire("simulate-contact"),
  };

  return <CommunicationsPanel model={model} actions={actions} />;
}
