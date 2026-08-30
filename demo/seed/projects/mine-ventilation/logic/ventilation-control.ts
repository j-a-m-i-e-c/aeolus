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
    const result = await devices.action(fan.id, "command", { payload: { mode } }, {
        tier: "observed",
        deviceId: fan.id,
        condition: { field: "mode", op: "eq", value: mode },
        timeoutMs: 5000,
    });
    state.set("commandPending", false);
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
