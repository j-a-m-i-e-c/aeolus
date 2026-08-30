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
    init("shedRefillActive", false);
    init("transferActive", false);
    init("transferStopping", false);
    init("transferMode", "idle");
    init("transferTargetLitres", 0);
    init("transferProgressLitres", 0);
    init("flowTotalLitres", 0);
    init("demoScenarioPending", "");
    init("energyAllowed", true);
}
