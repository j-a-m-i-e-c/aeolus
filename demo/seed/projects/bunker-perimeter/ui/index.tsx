// Perimeter Security — UI composition entry point.
// At a glance: classified perimeter contacts drive verified floodlights, with a deliberate operator override.

import PerimeterSecurityPanel from "./PerimeterSecurityPanel";

import { createDemoActions } from "./demo-actions";

export default function PerimeterSecurity(aeolus: CustomComponentProps) {
  const model = {
    contacts: aeolus.read("contacts"),
    sector: aeolus.read("sector"),
    lightsOn: aeolus.read("lightsOn"),
    autoLights: aeolus.read("autoLights"),
    pending: aeolus.read("pending"),
    lightsAvailable: aeolus.read("lightsAvailable"),
    lastAction: aeolus.read("lastAction"),
  };

  const actions = {
    toggleLights: () => aeolus.fire("toggle-lights"),
    returnAuto: () => aeolus.fire("return-auto"),
    ...createDemoActions(aeolus),
  };

  return <PerimeterSecurityPanel model={model} actions={actions} />;
}
