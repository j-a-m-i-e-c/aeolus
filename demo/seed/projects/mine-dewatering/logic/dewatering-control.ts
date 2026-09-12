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
/**
 * Report the sump's state to whoever is aggregating it.
 *
 * Emitted from this automation's own state rather than from a device read, so a caller
 * that has just commanded the pump reports the pump it commanded. See
 * commandSumpPump for why reading the device there would report the opposite.
 */
export function publishDewateringSummary() {
    events.emit("mine/summary/dewatering", {
        levelM: Number(state.get("levelM") || 0),
        inflowLps: Number(state.get("inflowLps") || 0),
        dischargeLps: Number(state.get("dischargeLps") || 0),
        pumpOn: Boolean(state.get("pumpOn")),
        pumpFlowLps: Number(state.get("pumpFlowLps") || 0),
        autoEnabled: state.get("autoEnabled") !== false,
    });
}
/**
 * Project the sump and pump readings.
 *
 * Correct wherever this path runs because a device published — the snapshot is then the
 * state that woke the automation. Not correct straight after issuing a command.
 */
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
    publishDewateringSummary();
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
    // Proven by water actually moving, read off the sump's own instrumentation.
    //
    // The pump republishes `on` and `flowLps` the moment it accepts, so observing
    // either only repeats the command back. `dischargeLps` on the deep-sump level
    // sensor is a separate device measuring the effect, which is what makes this an
    // observation rather than an echo.
    const sump = byTopic("sensor/mine/sump/deep");
    if (!sump) {
        setAction("Sump level sensor unavailable · cannot verify a pump command");
        // Cleared on the way out, or the pane keeps a spinner running for a command that
        // was never issued.
        state.set("commandPending", false);
        return;
    }
    const result = await devices.action(pump.id, "command", { payload: { on } }, {
        tier: "observed",
        deviceId: sump.id,
        condition: on
            ? { field: "dischargeLps", op: "gt", value: 0 }
            : { field: "dischargeLps", op: "eq", value: 0 },
        timeoutMs: 5000,
        evidence: {
            intent: on ? "Start sump pump" : "Stop sump pump",
            observedLabel: on ? "sump discharging" : "discharge stopped",
        },
    });
    state.set("commandPending", false);
    // Keep the proof, not just the verdict: every rung this command reached, with
    // the evidence the runtime recorded for it.
    state.set("lastCommand", devices.commandEvidence(result.commandId));
    if (result.success) {
        // Record the pump we commanded. This used to call projectDewateringState(), which
        // re-reads devices.list() — and that list is a snapshot taken once at the start of
        // the execution, so it still described the sump as it was BEFORE the command. A
        // verified start therefore projected `pumpOn: false` with zero discharge and
        // emitted that to the mine overview, contradicting the receipt sitting beside it.
        // The level and the flows keep their last measured values; the sump's own publish
        // re-runs this automation and corrects them.
        state.set("pumpOn", on);
    }
    else {
        setAction("Pump command not verified: " + String(result.error || result.lifecycleState || "unknown"));
    }
    // Reported either way, and from state. On failure that republishes the unchanged
    // pump, so the overview cannot be left showing a start that never happened.
    publishDewateringSummary();
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
