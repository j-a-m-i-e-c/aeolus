// Mine-atmosphere projection and alarm policy.
function byTopic(wanted: string) {
    return devices.list().find((device) => device.topic === wanted);
}
function setAction(label: string) {
    state.set("lastAction", { label, at: Date.now() });
}
function numberAt(device: any, field: string, fallback: number) {
    const value = Number(device && device.state && device.state[field]);
    return isNaN(value) ? fallback : value;
}
export function handleAtmosphereOperatorEvent(event: string | undefined) {
    if (event === "acknowledge-alarm") {
        state.set("acknowledged", true);
        setAction("Atmospheric alarm acknowledged by operator");
        projectAtmosphere(false);
    }
    else if (event === "simulate-gas-rise") {
        events.emit("mine/sim/gas-rise", {});
        setAction("Injecting a transient methane pocket at Drift 7");
    }
    else if (event === "reset-atmosphere") {
        events.emit("mine/sim/atmosphere-reset", {});
        state.set("acknowledged", false);
        state.set("lastDemandBand", "");
        setAction("Resetting mine atmosphere to nominal conditions");
    }
}
export function projectAtmosphere(publishDemand: boolean) {
    const level3 = byTopic("sensor/mine/gas/l3");
    const drift7 = byTopic("sensor/mine/gas/drift-7");
    const l3Ch4 = numberAt(level3, "ch4", 0.30);
    const d7Ch4 = numberAt(drift7, "ch4", 0.42);
    const co = numberAt(drift7, "co", 16);
    const o2 = numberAt(drift7, "o2", 20.7);
    const no2 = numberAt(drift7, "no2", 1.6);
    const severity = d7Ch4 >= 1 ? "alarm" : d7Ch4 >= 0.5 ? "warning" : "safe";
    const demand = severity === "alarm" ? 100 : severity === "warning" ? 78 : 48;
    const wasAlarm = Boolean(state.get("alarm"));
    state.set("l3Ch4", l3Ch4);
    state.set("d7Ch4", d7Ch4);
    state.set("co", co);
    state.set("o2", o2);
    state.set("no2", no2);
    state.set("severity", severity);
    state.set("alarm", severity === "alarm");
    state.set("ventDemand", demand);
    if (!wasAlarm && severity === "alarm") {
        state.set("acknowledged", false);
        setAction("Drift 7 methane alarm · requesting maximum ventilation");
    }
    else if (wasAlarm && severity !== "alarm") {
        setAction("Drift 7 atmosphere returned below alarm threshold");
    }
    if (publishDemand) {
        const band = severity + ":" + demand;
        if (String(state.get("lastDemandBand") || "") !== band) {
            state.set("lastDemandBand", band);
            events.emit("mine/atmosphere/vent-demand", { demand, severity, ch4: d7Ch4 });
        }
    }
    const now = Date.now();
    const lastSample = Number(state.get("lastDataSampleAt") || 0);
    if (now - lastSample >= 5 * 60_000) {
        db.write("gas-readings", { location: "Drift 7", ch4: d7Ch4, co, o2, no2 });
        state.set("lastDataSampleAt", now);
    }
    events.emit("mine/summary/atmosphere", {
        l3Ch4,
        d7Ch4,
        co,
        o2,
        no2,
        severity,
        alarm: severity === "alarm",
        acknowledged: Boolean(state.get("acknowledged")),
        ventDemand: demand,
    });
}
