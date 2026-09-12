// Ventilation telemetry and verified fan-mode control.
function byTopic(wanted: string) {
    return devices.list().find((device) => device.topic === wanted);
}
function setAction(label: string) {
    state.set("lastAction", { label, at: Date.now() });
}
/**
 * Report the fan's state to whoever is aggregating it.
 *
 * Emitted from this automation's own state rather than from a device read, so a caller
 * that has just changed the fan mode reports the mode it asked for. See
 * commandVentilation for why reading the device there would report the previous one.
 */
export function publishVentilationSummary() {
    events.emit("mine/summary/ventilation", {
        mode: String(state.get("mode") || "auto"),
        demand: Number(state.get("demand") || 0),
        primaryRpm: Number(state.get("primaryRpm") || 0),
        boosterRpm: Number(state.get("boosterRpm") || 0),
        airflow: Number(state.get("airflow") || 0),
        manualOverride: Boolean(state.get("manualOverride")),
        requestedDemand: Number(state.get("requestedDemand") || 48),
    });
}
/**
 * Project the fan controller's observed state.
 *
 * Correct wherever this path runs because the controller published — the snapshot is
 * then the state that woke the automation. Not correct straight after issuing a command.
 */
export function projectVentilationState() {
    const fan = byTopic("switch/mine/ventilation/state");
    const observed = fan && fan.state ? fan.state : {};
    state.set("mode", String(observed.mode || "auto"));
    state.set("demand", Number(observed.demand || 0));
    state.set("primaryRpm", Number(observed.primaryRpm || 0));
    state.set("boosterRpm", Number(observed.boosterRpm || 0));
    state.set("airflow", Number(observed.airflow || 0));
    state.set("fanOn", Boolean(observed.on));
    publishVentilationSummary();
}
export async function commandVentilation(mode: string, reason: string) {
    const fan = byTopic("switch/mine/ventilation/state");
    if (!fan) {
        setAction("Ventilation controller unavailable");
        return;
    }
    if (String(fan.state && fan.state.mode || "") === mode) {
        setAction(reason);
        projectVentilationState();
        return;
    }
    state.set("commandPending", true);
    setAction(reason);
    // Acknowledgement is the highest tier this command can honestly reach, and that
    // is the correct answer rather than a weaker one.
    //
    // The fan republishes `mode`, `demand`, `primaryRpm` and `airflow` in the same
    // breath as accepting the command, so every one of them is the command read back
    // rather than a measurement — observing any of them would dress a dispatch up as
    // physical proof. The genuine downstream effect is methane falling on the Drift 7
    // gas sensor, but that only moves when gas was already elevated and boost was the
    // mode asked for, so it cannot be this command's observation contract. Aeolus
    // therefore reports what it really knows: the controller confirmed receipt.
    const result = await devices.action(fan.id, "command", { payload: { mode } }, {
        tier: "acknowledged",
        timeoutMs: 5000,
        evidence: {
            intent: "Set ventilation to " + mode,
        },
    });
    state.set("commandPending", false);
    // Keep the proof, not just the verdict: every rung this command reached, with
    // the evidence the runtime recorded for it.
    state.set("lastCommand", devices.commandEvidence(result.commandId));
    if (result.success) {
        // Record the mode the controller accepted. This used to call
        // projectVentilationState(), which re-reads devices.list() — and that list is a
        // snapshot taken once at the start of the execution, so it still described the fan
        // as it was BEFORE the command. A confirmed boost therefore projected the old mode
        // and emitted it to the mine overview, racing the correct summary produced a
        // moment later by the controller's own publish.
        //
        // Only the mode, because the mode is all this command asserted. The rpm and
        // airflow figures keep their last measured values until the controller publishes
        // again; inventing a spun-up fan here is the overstatement the acknowledged tier
        // above exists to avoid.
        state.set("mode", mode);
    }
    else {
        setAction("Ventilation command not verified: " + String(result.error || result.lifecycleState || "unknown"));
    }
    // Reported either way, and from state. On failure that republishes the unchanged
    // mode, so the overview cannot be left showing a boost that never took.
    publishVentilationSummary();
}
export async function handleVentilationOperatorEvent(event: string | undefined) {
    if (event === "force-boost") {
        state.set("manualOverride", true);
        await commandVentilation("boost", "Manual ventilation boost enabled");
    }
    else if (event === "return-auto") {
        state.set("manualOverride", false);
        const demand = Number(state.get("requestedDemand") || 48);
        await commandVentilation(demand >= 80 ? "boost" : "auto", "Ventilation returned to atmospheric demand");
    }
}
