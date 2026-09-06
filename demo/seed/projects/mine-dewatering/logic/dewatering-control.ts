// Deep-sump telemetry and verified pump control.
function byTopic(wanted: string) {
    return devices.list().find((device) => device.topic === wanted);
}
function setAction(label: string) {
    state.set("lastAction", { label, at: Date.now() });
}
export function initialiseDewatering() {
    if (state.get("autoEnabled") === undefined)
        state.set("autoEnabled", true);
}
export function projectDewateringState() {
    const sump = byTopic("sensor/mine/sump/deep");
    const pump = byTopic("switch/mine/sump-pump/state");
    const sumpState = sump && sump.state ? sump.state : {};
    const pumpState = pump && pump.state ? pump.state : {};
    const levelM = Number(sumpState.levelM || 0);
    const pumpOn = Boolean(pumpState.on);
    state.set("levelM", levelM);
    state.set("inflowLps", Number(sumpState.inflowLps || 0));
    state.set("dischargeLps", Number(sumpState.dischargeLps || 0));
    state.set("sumpStatus", String(sumpState.status || "normal"));
    state.set("pumpOn", pumpOn);
    state.set("pumpFlowLps", Number(pumpState.flowLps || 0));
    // The sump record is written by the separate scheduled Dewatering History
    // automation, so the sampling interval is no longer tied to how often the sump
    // publishes.
    events.emit("mine/summary/dewatering", {
        levelM,
        inflowLps: Number(sumpState.inflowLps || 0),
        dischargeLps: Number(sumpState.dischargeLps || 0),
        pumpOn,
        pumpFlowLps: Number(pumpState.flowLps || 0),
        autoEnabled: state.get("autoEnabled") !== false,
    });
    return { levelM, pumpOn };
}
export async function commandSumpPump(on: boolean, reason: string) {
    const pump = byTopic("switch/mine/sump-pump/state");
    if (!pump) {
        setAction("Sump pump unavailable");
        return;
    }
    if (Boolean(pump.state && pump.state.on) === on) {
        setAction(reason);
        projectDewateringState();
        return;
    }
    state.set("commandPending", true);
    setAction(reason);
    const result = await devices.action(pump.id, "command", { payload: { on } }, {
        tier: "observed",
        deviceId: pump.id,
        condition: { field: "on", op: "eq", value: on },
        timeoutMs: 5000,
    });
    state.set("commandPending", false);
    // Keep the proof, not just the verdict: every rung this command reached, with
    // the evidence the runtime recorded for it.
    state.set("lastCommand", devices.commandEvidence(result.commandId));
    if (!result.success) {
        setAction("Pump command not verified: " + String(result.error || result.lifecycleState || "unknown"));
    }
    projectDewateringState();
}
export async function handleDewateringOperatorEvent(event: string | undefined) {
    if (event === "pump-on")
        await commandSumpPump(true, "Manual sump pump start");
    else if (event === "pump-off")
        await commandSumpPump(false, "Manual sump pump stop");
    else if (event === "toggle-auto") {
        const next = state.get("autoEnabled") === false;
        state.set("autoEnabled", next);
        setAction(next ? "Automatic dewatering enabled" : "Automatic dewatering disabled");
        projectDewateringState();
    }
    else if (event === "simulate-heavy-inflow") {
        events.emit("mine/sim/heavy-inflow", {});
        setAction("Injecting heavy groundwater inflow into deep sump");
    }
    else if (event === "reset-sump") {
        events.emit("mine/sim/sump-reset", {});
        state.set("autoEnabled", true);
        setAction("Resetting sump to nominal level");
    }
}
