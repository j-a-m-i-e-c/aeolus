// Read-only aggregation for the off-grid bunker overview.
function copyDefined(source: Record<string, unknown>, key: string) {
    if (source[key] !== undefined)
        state.set(key, source[key]);
}
export function projectPerimeterSummary(source: Record<string, unknown>) {
    // Range and movement come across too: the overview draws the approach, and a
    // contact count on its own cannot say where anything is.
    ["contacts", "sector", "classification", "lightsOn", "autoLights",
        "rangeM", "movement", "approachGroupSize", "ambientContacts",
        "trackRangeM", "detectRangeM", "fenceRangeM", "floodlightPct"]
        .forEach((key) => copyDefined(source, key));
}
export function projectAirSummary(source: Record<string, unknown>) {
    ["sealed", "overpressure", "filterLife", "tempC"].forEach((key) => copyDefined(source, key));
}
export function projectPowerSummary(source: Record<string, unknown>) {
    // `generatorOutputW` and `charging` come across so the overview can say whether the
    // machine is making power and whether the bank is gaining, rather than inferring
    // either from the fact that a generator was switched on.
    ["battery", "solar", "load", "net", "generatorOn", "generatorOutputW", "charging",
        "foodDays", "waterDays", "occupants", "bunks"]
        .forEach((key) => copyDefined(source, key));
}
export function projectCommsSummary(source: Record<string, unknown>) {
    ["frequency", "signal", "contactsToday", "transmitting"].forEach((key) => copyDefined(source, key));
}
