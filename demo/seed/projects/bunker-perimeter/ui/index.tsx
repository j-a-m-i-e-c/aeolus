// Perimeter Security — UI composition entry point.
// At a glance: classified perimeter contacts drive verified floodlights, with a deliberate operator override.

import PerimeterSecurityPanel from "./PerimeterSecurityPanel";

import { createDemoActions } from "./demo-actions";

export default function PerimeterSecurity(aeolus: CustomComponentProps) {
  const model = {
    contacts: aeolus.read("contacts"),
    sector: aeolus.read("sector"),
    rangeM: aeolus.read("rangeM"),
    movement: aeolus.read("movement"),
    ambientContacts: aeolus.read("ambientContacts"),
    trackRangeM: aeolus.read("trackRangeM"),
    detectRangeM: aeolus.read("detectRangeM"),
    fenceRangeM: aeolus.read("fenceRangeM"),
    floodlightPct: aeolus.read("floodlightPct"),
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
