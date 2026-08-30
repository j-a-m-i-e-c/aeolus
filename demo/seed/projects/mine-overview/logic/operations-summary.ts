// Read-only mine operations aggregation.
function init(key: string, value: unknown) {
    if (state.get(key) === undefined)
        state.set(key, value);
}
function copy(source: Record<string, unknown>, key: string, destination = key) {
    if (source[key] !== undefined)
        state.set(destination, source[key]);
}
export function initialiseMineOverview() {
    init("d7Ch4", 0.42);
    init("severity", "safe");
    init("ventMode", "auto");
    init("airflow", 258);
    init("refuge", 0);
    init("underground", 14);
    init("unaccounted", 0);
    init("musterState", "normal");
    init("sumpLevel", 1.8);
    init("sumpPumpOn", false);
    init("lastMineEvent", { label: "Mine operating normally", at: Date.now() });
}
export function projectAtmosphereSummary(source: Record<string, unknown>) {
    ["d7Ch4", "severity", "alarm", "ventDemand"].forEach((key) => copy(source, key));
    state.set("lastMineEvent", {
        label: String(source.severity || "safe") === "alarm" ? "Atmospheric alarm at Drift 7" : "Atmosphere updated",
        at: Date.now(),
    });
}
export function projectVentilationSummary(source: Record<string, unknown>) {
    copy(source, "mode", "ventMode");
    copy(source, "airflow");
    copy(source, "primaryRpm");
    copy(source, "boosterRpm");
    state.set("lastMineEvent", { label: "Ventilation · " + String(source.mode || "auto"), at: Date.now() });
}
export function projectPersonnelSummary(source: Record<string, unknown>) {
    ["refuge", "underground", "unaccounted", "musterState", "alarmActive"].forEach((key) => copy(source, key));
    state.set("lastMineEvent", {
        label: Number(source.unaccounted || 0) > 0
            ? "Personnel tag exception"
            : String(source.musterState || "") === "complete"
                ? "Muster complete"
                : "Personnel tracking updated",
        at: Date.now(),
    });
}
export function projectDewateringSummary(source: Record<string, unknown>) {
    copy(source, "levelM", "sumpLevel");
    copy(source, "pumpOn", "sumpPumpOn");
    copy(source, "dischargeLps");
    state.set("lastMineEvent", {
        label: Boolean(source.pumpOn) ? "Deep sump pumping" : "Dewatering updated",
        at: Date.now(),
    });
}
