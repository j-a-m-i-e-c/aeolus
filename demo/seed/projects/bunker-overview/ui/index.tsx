// Continuity Overview — UI composition entry point.
// State selection and operator intent stay visible; rendering detail lives in Files.

import ContinuityOverviewDashboard from "./ContinuityOverview";

export default function ContinuityOverview(aeolus: CustomComponentProps) {
  const model = {
    contacts: aeolus.read("contacts"),
    lightsOn: aeolus.read("lightsOn"),
    sealed: aeolus.read("sealed"),
    overpressure: aeolus.read("overpressure"),
    battery: aeolus.read("battery"),
    solar: aeolus.read("solar"),
    load: aeolus.read("load"),
    generatorOn: aeolus.read("generatorOn"),
    signal: aeolus.read("signal"),
    waterDays: aeolus.read("waterDays"),
    foodDays: aeolus.read("foodDays"),
    filterLife: aeolus.read("filterLife"),
  };
  return <ContinuityOverviewDashboard model={model} />;
}
