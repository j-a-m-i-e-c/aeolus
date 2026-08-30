// ROV telemetry, verified vehicle commands and tether protection.
function byTopic(wanted: string) {
    return devices.list().find((device) => device.topic === wanted);
}
function setAction(label: string) {
    state.set("lastAction", { label, at: Date.now() });
}
export function projectRovState() {
    const telemetry = byTopic("sensor/rov/telemetry");
    const vehicle = byTopic("switch/rov/vehicle/state");
    const depth = Number(telemetry && telemetry.state && telemetry.state.depth);
    const heading = Number(telemetry && telemetry.state && telemetry.state.heading);
    const battery = Number(telemetry && telemetry.state && telemetry.state.battery);
    const tether = Number(telemetry && telemetry.state && telemetry.state.tetherTension);
    const altitude = Number(telemetry && telemetry.state && telemetry.state.altitude);
    const visibility = Number(telemetry && telemetry.state && telemetry.state.visibility);
    const mode = String(telemetry && telemetry.state && telemetry.state.mode
        || vehicle && vehicle.state && vehicle.state.mode
        || "holding");
    if (!isNaN(depth))
        state.set("depth", depth);
    if (!isNaN(heading))
        state.set("heading", heading);
    if (!isNaN(battery))
        state.set("battery", battery);
    if (!isNaN(tether))
        state.set("tetherTension", tether);
    if (!isNaN(altitude))
        state.set("altitude", altitude);
    if (!isNaN(visibility))
        state.set("visibility", visibility);
    state.set("mode", mode);
    state.set("lightsOn", Boolean(vehicle && vehicle.state && vehicle.state.lights));
    state.set("thrusterPct", Number(vehicle && vehicle.state && vehicle.state.thrusterPct || 0));
    events.emit("vessel/summary/rov", {
        rovDepth: isNaN(depth) ? 0 : depth,
        rovMode: mode,
        rovBattery: isNaN(battery) ? 0 : battery,
        rovTether: isNaN(tether) ? 0 : tether,
        rovHeading: isNaN(heading) ? 0 : heading,
        rovAltitude: isNaN(altitude) ? 0 : altitude,
    });
    return { tether };
}
export async function commandRov(mode: string, targetDepth: number) {
    const vehicle = byTopic("switch/rov/vehicle/state");
    const telemetry = byTopic("sensor/rov/telemetry");
    if (!vehicle || !telemetry) {
        setAction("ROV hardware unavailable");
        return;
    }
    if (Boolean(state.get("commandPending")))
        return;
    const liveMode = String(telemetry.state && telemetry.state.mode || "holding");
    if ((liveMode === "diving" || liveMode === "recovering") && mode !== "hold") {
        setAction("ROV already changing depth · hold before new command");
        return;
    }
    state.set("commandPending", true);
    const options = mode === "dive"
        ? { tier: "observed", deviceId: telemetry.id, condition: { field: "depth", op: "gte", value: targetDepth - 5 }, timeoutMs: 8000 }
        : mode === "recover"
            ? { tier: "observed", deviceId: telemetry.id, condition: { field: "depth", op: "lte", value: targetDepth + 8 }, timeoutMs: 8000 }
            : { tier: "observed", deviceId: telemetry.id, condition: { field: "mode", op: "eq", value: mode === "survey" ? "surveying" : "holding" }, timeoutMs: 5000 };
    setAction(mode === "dive"
        ? "ROV descending to survey altitude"
        : mode === "recover"
            ? "Recovering ROV to launch depth"
            : mode === "survey"
                ? "Starting seabed transect"
                : "Holding ROV position");
    const result = await devices.action(vehicle.id, "command", { payload: { mode, targetDepth } }, options);
    state.set("commandPending", false);
    if (result.success) {
        setAction(mode === "survey"
            ? "Transect underway · telemetry verified"
            : mode === "dive"
                ? "Survey depth reached"
                : mode === "recover"
                    ? "ROV recovered to launch depth"
                    : "ROV hold verified");
        events.emit("vessel/rov/command-verified", { mode, lifecycleState: result.lifecycleState });
    }
    else {
        setAction("ROV command not verified: " + String(result.error || result.lifecycleState || "unknown"));
    }
    projectRovState();
}
export async function protectRovTether() {
    if (Boolean(state.get("tetherProtectionActive")))
        return;
    const vehicle = byTopic("switch/rov/vehicle/state");
    const telemetry = byTopic("sensor/rov/telemetry");
    if (!vehicle || !telemetry)
        return;
    state.set("tetherProtectionActive", true);
    setAction("Tether load high · commanding ROV station hold");
    const result = await devices.action(vehicle.id, "command", { payload: { mode: "hold", targetDepth: Number(state.get("depth") || 0) } }, {
        tier: "observed",
        deviceId: telemetry.id,
        condition: { field: "mode", op: "eq", value: "holding" },
        timeoutMs: 5000,
    });
    state.set("tetherProtectionActive", false);
    if (result.success) {
        setAction("ROV hold verified · tether protected");
        events.emit("vessel/rov/tether-protection", { lifecycleState: result.lifecycleState });
    }
    else {
        setAction("ROV safety hold not verified");
    }
    projectRovState();
}
export async function handleRovOperatorEvent(event: string | undefined) {
    if (event === "rov-dive")
        await commandRov("dive", 360);
    else if (event === "rov-survey")
        await commandRov("survey", Number(state.get("depth") || 360));
    else if (event === "rov-hold")
        await commandRov("hold", Number(state.get("depth") || 310));
    else if (event === "rov-recover")
        await commandRov("recover", 25);
    else if (event === "simulate-rov-current") {
        events.emit("vessel/sim/rov-cross-current", {});
        setAction("Injecting cross-current at ROV depth");
    }
    else if (event === "reset-rov") {
        events.emit("vessel/sim/rov-reset", {});
        state.set("tetherProtectionActive", false);
        setAction("Resetting ROV mission state");
    }
}
