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
    const seabedDepth = Number(telemetry && telemetry.state && telemetry.state.seabedDepth);
    const crossCurrentKt = Number(telemetry && telemetry.state && telemetry.state.crossCurrentKt);
    const verticalSpeed = Number(telemetry && telemetry.state && telemetry.state.verticalSpeed);
    const mode = String(telemetry && telemetry.state && telemetry.state.mode
        || vehicle && vehicle.state && vehicle.state.mode
        || "at-surface");
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
    // The seabed depth is projected so the pane can draw the whole water column
    // instead of positioning the vehicle from its altitude alone, which put it a
    // few pixels off the bottom no matter how shallow it really was.
    if (!isNaN(seabedDepth))
        state.set("seabedDepth", seabedDepth);
    if (!isNaN(crossCurrentKt))
        state.set("crossCurrentKt", crossCurrentKt);
    if (!isNaN(verticalSpeed))
        state.set("verticalSpeed", verticalSpeed);
    state.set("mode", mode);
    state.set("lightsOn", Boolean(vehicle && vehicle.state && vehicle.state.lights));
    state.set("thrusterPct", Number(vehicle && vehicle.state && vehicle.state.thrusterPct || 0));
    state.set("transectLegs", Number(vehicle && vehicle.state && vehicle.state.transectLegs || 0));
    if (state.get("protectionAt") === undefined)
        state.set("protectionAt", 0);
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
    // Changing depth is not a reason to refuse a valid command. Aborting a descent
    // straight into a recovery is a normal — sometimes urgent — operator action, and
    // demanding a Hold first is what made Hold look like a mandatory step.
    const options = mode === "dive"
        ? { tier: "observed", deviceId: telemetry.id, condition: { field: "depth", op: "gte", value: targetDepth - 5 }, timeoutMs: 9000 }
        : mode === "recover"
            ? { tier: "observed", deviceId: telemetry.id, condition: { field: "depth", op: "lte", value: targetDepth + 8 }, timeoutMs: 9000 }
            : mode === "survey"
                ? { tier: "observed", deviceId: telemetry.id, condition: { field: "mode", op: "eq", value: "surveying" }, timeoutMs: 5000 }
                // A hold is proven by the vehicle stopping, not by it reporting the
                // mode it was asked for.
                : { tier: "observed", deviceId: telemetry.id, condition: { field: "verticalSpeed", op: "eq", value: 0 }, timeoutMs: 5000 };
    state.set("commandPending", true);
    const liveMode = String(telemetry.state && telemetry.state.mode || "at-surface");
    setAction(mode === "dive"
        ? "ROV descending to " + targetDepth + " m"
        : mode === "recover"
            ? (liveMode === "diving" || liveMode === "approaching-seabed"
                ? "Aborting descent · recovering ROV to launch depth"
                : "Recovering ROV to launch depth")
            : mode === "survey"
                ? "Starting seabed transect"
                : "Holding ROV position");
    const result = await devices.action(vehicle.id, "command", { payload: { mode, targetDepth } }, options);
    state.set("commandPending", false);
    if (result.success) {
        setAction(mode === "survey"
            ? "Transect underway · telemetry verified"
            : mode === "dive"
                ? "On station at " + targetDepth + " m · " + Math.round(Number(state.get("altitude") || 0)) + " m off the bottom"
                : mode === "recover"
                    ? "ROV recovered to launch depth"
                    : "ROV hold verified · vertical movement stopped");
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
    // Verified by the load actually coming off the tether. A vehicle reporting
    // "holding" only proves it accepted the command; a falling tension proves it
    // stopped dragging the tether across the current.
    const result = await devices.action(vehicle.id, "command", { payload: { mode: "hold", targetDepth: Number(state.get("depth") || 0) } }, {
        tier: "observed",
        deviceId: telemetry.id,
        condition: { field: "tetherTension", op: "lt", value: 650 },
        timeoutMs: 5000,
    });
    state.set("tetherProtectionActive", false);
    if (result.success) {
        // Recorded so the pane can state that Aeolus did this on its own.
        state.set("protectionAt", Date.now());
        setAction("Station hold verified · tether load relieved");
        events.emit("vessel/rov/tether-protection", { lifecycleState: result.lifecycleState });
    }
    else {
        setAction("ROV safety hold not verified");
    }
    projectRovState();
}
export async function handleRovOperatorEvent(event: string | undefined) {
    if (event === "rov-dive")
        await commandRov("dive", 355);
    else if (event === "rov-survey")
        await commandRov("survey", Number(state.get("depth") || 355));
    else if (event === "rov-hold")
        await commandRov("hold", Number(state.get("depth") || 60));
    else if (event === "rov-recover")
        await commandRov("recover", 60);
    else if (event === "simulate-rov-current") {
        events.emit("vessel/sim/rov-cross-current", {});
        setAction("Injecting cross-current at ROV depth");
    }
    else if (event === "reset-rov") {
        events.emit("vessel/sim/rov-reset", {});
        state.set("tetherProtectionActive", false);
        state.set("protectionAt", 0);
        setAction("Resetting ROV to launch depth");
    }
}
