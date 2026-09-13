// Shared runtime helpers for the farm water automation.
export function byTopic(wanted: string) {
    return devices.list().find((device) => device.topic === wanted);
}
export function setAction(label: string) {
    state.set("lastAction", { label, at: Date.now() });
}
function init(key: string, value: unknown) {
    if (state.get(key) === undefined)
        state.set(key, value);
}
export function initialiseWaterState() {
    init("distributionActive", false);
    init("houseRefillActive", false);
    init("officeRefillActive", false);
    init("officeValveOn", false);
    init("houseValveOn", false);
    init("transferActive", false);
    init("transferStopping", false);
    init("transferMode", "idle");
    init("transferTargetLitres", 0);
    init("transferProgressLitres", 0);
    init("flowTotalLitres", 0);
    init("demoScenarioPending", "");
    init("energyAllowed", true);
    dropRenamedKeys();
}

/**
 * Remove the keys §4.3 renamed, on an install that still has them.
 *
 * `damPct`, `shedPct` and `shedRefillActive` became `sourcePct`, `officePct` and
 * `officeRefillActive`. An upgraded install keeps the old three in persisted state, where
 * nothing reads them.
 *
 * Deliberately dropped rather than copied forward. The two percentages are tank readings,
 * so carrying an old value into the new key would put a stale level on the pane and label
 * it current — a smaller version of exactly what this pass spent its time removing. They
 * need no migration: `projectWaterTelemetry` rewrites both from the next sensor publish,
 * which arrives within a second, and the pane's `??` defaults cover the gap until it does.
 * The refill flag is already initialised above.
 */
function dropRenamedKeys() {
    for (const orphan of ["damPct", "shedPct", "shedRefillActive"]) {
        if (state.get(orphan) !== undefined)
            state.delete(orphan);
    }
}
