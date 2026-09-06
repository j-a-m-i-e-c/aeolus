// Off-grid Bunker overview — UI composition entry point.
// At a glance: one surface property and the six shelter areas underneath it.

import BunkerOverviewDashboard from "./BunkerOverviewDashboard";

export default function BunkerOverview(aeolus: CustomComponentProps) {
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
    sealed: aeolus.read("sealed"),
    overpressure: aeolus.read("overpressure"),
    tempC: aeolus.read("tempC"),
    battery: aeolus.read("battery"),
    solar: aeolus.read("solar"),
    load: aeolus.read("load"),
    net: aeolus.read("net"),
    generatorOn: aeolus.read("generatorOn"),
    signal: aeolus.read("signal"),
    frequency: aeolus.read("frequency"),
    transmitting: aeolus.read("transmitting"),
    contactsToday: aeolus.read("contactsToday"),
    waterDays: aeolus.read("waterDays"),
    foodDays: aeolus.read("foodDays"),
    occupants: aeolus.read("occupants"),
    bunks: aeolus.read("bunks"),
    filterLife: aeolus.read("filterLife"),
  };
  return <BunkerOverviewDashboard model={model} />;
}
