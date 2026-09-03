// Read-only vessel mission aggregation.
function init(name: string, value: unknown) {
    if (state.get(name) === undefined)
        state.set(name, value);
}
function copy(source: Record<string, unknown>, name: string) {
    if (source[name] !== undefined)
        state.set(name, source[name]);
}
export function initialiseMissionOverview() {
    // Matches the simulator's resting state: the package is on deck before a cast,
    // not parked indefinitely at 120 m.
    init("ctdDepth", 3);
    init("ctdStatus", "on-deck");
    init("ctdTemperature", 18.4);
    init("ctdSalinity", 35.0);
    init("ctdOxygen", 6.3);
    init("ctdTension", 220);
    init("rovDepth", 310);
    init("rovMode", "holding");
    init("rovBattery", 78);
    init("rovTether", 310);
    init("rovHeading", 88);
    init("rovAltitude", 8.2);
    init("tsgPumpOn", true);
    init("tsgFlow", 2.1);
    init("sst", 18.4);
    init("surfaceSalinity", 35.2);
    init("chlorophyll", 0.8);
    init("frontDetected", false);
    init("lastMissionEvent", { label: "Science systems online", at: Date.now() });
}
export function projectCtdSummary(source: Record<string, unknown>) {
    ["ctdDepth", "ctdStatus", "ctdTemperature", "ctdSalinity", "ctdOxygen", "ctdTension"]
        .forEach((key) => copy(source, key));
    state.set("lastMissionEvent", { label: "CTD · " + String(source.ctdStatus || "profile updated"), at: Date.now() });
}
export function projectRovSummary(source: Record<string, unknown>) {
    ["rovDepth", "rovMode", "rovBattery", "rovTether", "rovHeading", "rovAltitude"]
        .forEach((key) => copy(source, key));
    state.set("lastMissionEvent", { label: "ROV · " + String(source.rovMode || "telemetry updated"), at: Date.now() });
}
export function projectUnderwaySummary(source: Record<string, unknown>) {
    ["tsgPumpOn", "tsgFlow", "sst", "surfaceSalinity", "chlorophyll", "frontDetected"]
        .forEach((key) => copy(source, key));
    state.set("lastMissionEvent", {
        label: source.frontDetected
            ? "Underway science · hydrographic front detected"
            : "Underway science · surface stream updated",
        at: Date.now(),
    });
}
