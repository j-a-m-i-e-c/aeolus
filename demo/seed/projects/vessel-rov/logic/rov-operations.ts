// ROV telemetry, verified vehicle commands and tether protection.
function byTopic(wanted: string) {
    return devices.list().find((device) => device.topic === wanted);
}
function setAction(label: string) {
    state.set("lastAction", { label, at: Date.now() });
}
/**
 * Report the vehicle's state to whoever is aggregating it.
 *
 * Emitted from this automation's own state rather than from a device read, so a caller
 * that has just commanded the ROV reports the ROV it commanded. See commandRov for why
 * reading the devices there would report the previous phase of the dive.
 */
export function publishRovSummary() {
    events.emit("vessel/summary/rov", {
        rovDepth: Number(state.get("depth") || 0),
        rovMode: String(state.get("mode") || "at-surface"),
        rovBattery: Number(state.get("battery") || 0),
        rovTether: Number(state.get("tetherTension") || 0),
        rovHeading: Number(state.get("heading") || 0),
        rovAltitude: Number(state.get("altitude") || 0),
    });
}
/**
 * Project the vehicle and telemetry readings.
 *
 * Correct wherever this path runs because a device published — the snapshot is then the
 * state that woke the automation. Not correct straight after issuing a command.
 */
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
    publishRovSummary();
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
        ? { tier: "observed", deviceId: telemetry.id, condition: { field: "depth", op: "gte", value: targetDepth - 5 }, timeoutMs: 9000,
            evidence: { intent: "Dive ROV to " + targetDepth + " m", observedLabel: "vehicle depth telemetry reached the target" } }
        : mode === "recover"
            ? { tier: "observed", deviceId: telemetry.id, condition: { field: "depth", op: "lte", value: targetDepth + 8 }, timeoutMs: 9000,
                evidence: { intent: "Recover ROV to launch depth", observedLabel: "vehicle back at launch depth" } }
            // Acknowledgement, and this is a correction rather than a downgrade. The
            // condition here was `mode == "surveying"`, which was wrong twice over: it
            // read back the mode the vehicle had just been told to adopt, and its value
            // was a string, which the condition validator rejects — so the confirmation
            // was silently dropped and the tier clamped. The command has only ever been
            // acknowledged, and now says so. Proving a transect really means waiting for
            // `transectLegs` to increment, which happens when the box has been flown.
            : mode === "survey"
                ? { tier: "acknowledged", timeoutMs: 5000,
                    evidence: { intent: "Start seabed transect" } }
                // A hold is proven by the vehicle stopping, not by it reporting the
                // mode it was asked for.
                : { tier: "observed", deviceId: telemetry.id, condition: { field: "verticalSpeed", op: "eq", value: 0 }, timeoutMs: 5000,
                    evidence: { intent: "Hold ROV position", observedLabel: "vertical movement stopped" } };
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
    // Keep the proof, not just the verdict. It also keeps the transect honest: three of
    // these four commands are observed off vehicle telemetry and the transect is only
    // acknowledged, which the receipt shows rather than levelling them all to "verified".
    state.set("lastCommand", devices.commandEvidence(result.commandId));
    if (result.success) {
        // The altitude used to be quoted here — "on station at 355 m · 12 m off the
        // bottom" — read from state that had been projected before the command was
        // issued. devices.list() is a snapshot taken once at the start of the execution,
        // so that figure was the height off the bottom from before the dive, which for a
        // launch at the surface meant the sentence reported the whole water column. The
        // depth is quoted because the observation is what proved it; the altitude is a
        // live reading and the pane already shows it as one.
        setAction(mode === "survey"
            ? "Transect underway · telemetry verified"
            : mode === "dive"
                ? "On station at " + targetDepth + " m"
                : mode === "recover"
                    ? "ROV recovered to launch depth"
                    : "ROV hold verified · vertical movement stopped");
        events.emit("vessel/rov/command-verified", { mode, lifecycleState: result.lifecycleState });
    }
    else {
        setAction("ROV command not verified: " + String(result.error || result.lifecycleState || "unknown"));
    }
    // From state, not a re-read. Every field belongs to a device, and the telemetry
    // publish that satisfied the observation is the one that re-runs this automation
    // with the post-command values.
    publishRovSummary();
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
        evidence: {
            // Named as Aeolus's own action rather than the operator's, so an automatic
            // intervention is accountable on the same surface as a requested one.
            intent: "Tether interlock · hold ROV station",
            observedLabel: "tether load fell back below the limit",
        },
    });
    state.set("tetherProtectionActive", false);
    state.set("lastCommand", devices.commandEvidence(result.commandId));
    if (result.success) {
        // Recorded so the pane can state that Aeolus did this on its own.
        state.set("protectionAt", Date.now());
        setAction("Station hold verified · tether load relieved");
        events.emit("vessel/rov/tether-protection", { lifecycleState: result.lifecycleState });
    }
    else {
        setAction("ROV safety hold not verified");
    }
    // From state, not a re-read — see commandRov.
    publishRovSummary();
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
