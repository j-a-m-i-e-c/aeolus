// Ventilation telemetry and verified fan-mode control.
function byTopic(wanted: string) {
    return devices.list().find((device) => device.topic === wanted);
}
function setAction(label: string) {
    state.set("lastAction", { label, at: Date.now() });
}
export function projectVentilationState() {
    const fan = byTopic("switch/mine/ventilation/state");
    const observed = fan && fan.state ? fan.state : {};
    const mode = String(observed.mode || "auto");
    state.set("mode", mode);
    state.set("demand", Number(observed.demand || 0));
    state.set("primaryRpm", Number(observed.primaryRpm || 0));
    state.set("boosterRpm", Number(observed.boosterRpm || 0));
    state.set("airflow", Number(observed.airflow || 0));
    state.set("fanOn", Boolean(observed.on));
    events.emit("mine/summary/ventilation", {
        mode,
        demand: Number(observed.demand || 0),
        primaryRpm: Number(observed.primaryRpm || 0),
        boosterRpm: Number(observed.boosterRpm || 0),
        airflow: Number(observed.airflow || 0),
        manualOverride: Boolean(state.get("manualOverride")),
        requestedDemand: Number(state.get("requestedDemand") || 48),
    });
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
    if (!result.success) {
        setAction("Ventilation command not verified: " + String(result.error || result.lifecycleState || "unknown"));
    }
    projectVentilationState();
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
