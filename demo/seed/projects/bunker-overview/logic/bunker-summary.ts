// Read-only aggregation for the off-grid bunker overview.
function copyDefined(source: Record<string, unknown>, key: string) {
    if (source[key] !== undefined)
        state.set(key, source[key]);
}
export function projectPerimeterSummary(source: Record<string, unknown>) {
    // Range and movement come across too: the overview draws the approach, and a
    // contact count on its own cannot say where anything is.
    ["contacts", "sector", "classification", "lightsOn", "autoLights",
        "rangeM", "movement", "ambientContacts", "trackRangeM", "detectRangeM", "fenceRangeM", "floodlightPct"]
        .forEach((key) => copyDefined(source, key));
}
export function projectAirSummary(source: Record<string, unknown>) {
    ["sealed", "overpressure", "filterLife", "tempC"].forEach((key) => copyDefined(source, key));
}
export function projectPowerSummary(source: Record<string, unknown>) {
    ["battery", "solar", "load", "net", "generatorOn", "foodDays", "waterDays", "occupants", "bunks"]
        .forEach((key) => copyDefined(source, key));
}
export function projectCommsSummary(source: Record<string, unknown>) {
    ["frequency", "signal", "contactsToday", "transmitting"].forEach((key) => copyDefined(source, key));
}
