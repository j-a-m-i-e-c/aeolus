// Read-only continuity aggregation for the bunker overview.
function copyDefined(source: Record<string, unknown>, key: string) {
    if (source[key] !== undefined)
        state.set(key, source[key]);
}
export function projectPerimeterSummary(source: Record<string, unknown>) {
    ["contacts", "sector", "classification", "lightsOn"].forEach((key) => copyDefined(source, key));
}
export function projectAirSummary(source: Record<string, unknown>) {
    ["sealed", "overpressure", "filterLife"].forEach((key) => copyDefined(source, key));
}
export function projectPowerSummary(source: Record<string, unknown>) {
    ["battery", "solar", "load", "net", "generatorOn", "foodDays", "waterDays"]
        .forEach((key) => copyDefined(source, key));
}
export function projectCommsSummary(source: Record<string, unknown>) {
    ["frequency", "signal", "contactsToday"].forEach((key) => copyDefined(source, key));
}
