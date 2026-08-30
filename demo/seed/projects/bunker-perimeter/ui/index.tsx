// Perimeter Security — UI composition entry point.
// State selection and operator intent stay visible; rendering detail lives in Files.

import PerimeterSecurityPanel from "./PerimeterSecurityPanel";

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
    simulateContacts: () => aeolus.fire("simulate-contacts"),
    clearPerimeter: () => aeolus.fire("clear-perimeter"),
  };

  return <PerimeterSecurityPanel model={model} actions={actions} />;
}
