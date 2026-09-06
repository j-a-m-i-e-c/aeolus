// CTD telemetry, verified winch commands and tension protection.
function byTopic(wanted: string) {
    return devices.list().find((device) => device.topic === wanted);
}
function setAction(label: string) {
    state.set("lastAction", { label, at: Date.now() });
}
export function projectCtdState() {
    const sonde = byTopic("sensor/ctd/sonde");
    const winch = byTopic("switch/vessel/ctd-winch/state");
    const depth = Number(sonde && sonde.state && sonde.state.depth);
    const temperature = Number(sonde && sonde.state && sonde.state.temperature);
    const salinity = Number(sonde && sonde.state && sonde.state.salinity);
    const oxygen = Number(sonde && sonde.state && sonde.state.oxygen);
    const verticalSpeed = Number(sonde && sonde.state && sonde.state.verticalSpeed);
    const tension = Number(winch && winch.state && winch.state.tension);
    const targetDepth = Number(winch && winch.state && winch.state.targetDepth);
    const mode = String(winch && winch.state && winch.state.mode || "holding");
    const winchOn = Boolean(winch && winch.state && winch.state.on);
    if (!isNaN(depth))
        state.set("depth", depth);
    if (!isNaN(temperature))
        state.set("temperature", temperature);
    if (!isNaN(salinity))
        state.set("salinity", salinity);
    if (!isNaN(oxygen))
        state.set("oxygen", oxygen);
    if (!isNaN(verticalSpeed))
        state.set("verticalSpeed", verticalSpeed);
    if (!isNaN(tension))
        state.set("tension", tension);
    if (!isNaN(targetDepth))
        state.set("targetDepth", targetDepth);
    // `status` is the wire's phase, not a boolean dressed up as one: on-deck and
    // at-depth are both stationary but offer different next actions.
    state.set("status", mode);
    state.set("winchOn", winchOn);
    if (state.get("interlockAt") === undefined)
        state.set("interlockAt", 0);
    events.emit("vessel/summary/ctd", {
        ctdDepth: isNaN(depth) ? 0 : depth,
        ctdStatus: mode,
        ctdTemperature: isNaN(temperature) ? 0 : temperature,
        ctdSalinity: isNaN(salinity) ? 0 : salinity,
        ctdOxygen: isNaN(oxygen) ? 0 : oxygen,
        ctdTension: isNaN(tension) ? 0 : tension,
    });
    return { depth, tension, winchOn };
}

// The cast record is written by the separate scheduled CTD History automation.
// Sampling opportunistically from telemetry made the record's density a function
// of how often the sonde published, and tied the sampling interval to the publish
// interval; both are retention decisions that do not belong in this control loop.

export async function commandCtdWinch(mode: string, targetDepth: number) {
    const winch = byTopic("switch/vessel/ctd-winch/state");
    const sonde = byTopic("sensor/ctd/sonde");
    if (!winch || !sonde) {
        setAction("CTD hardware unavailable");
        return;
    }
    if (Boolean(state.get("commandPending")))
        return;
    // A moving winch is not a reason to refuse a valid command. Reversing direction
    // mid-cast is a normal — sometimes urgent — operator action, and requiring a
    // Hold first is what made Hold look like a mandatory intermediate step.
    const options = mode === "deploy"
        ? { tier: "observed", deviceId: sonde.id, condition: { field: "depth", op: "gte", value: targetDepth - 5 }, timeoutMs: 9000 }
        : mode === "recover"
            ? { tier: "observed", deviceId: sonde.id, condition: { field: "depth", op: "lte", value: targetDepth + 5 }, timeoutMs: 9000 }
            // A hold is proven by the package stopping, read off the sonde, not by
            // the winch reporting its own mode back.
            : { tier: "observed", deviceId: sonde.id, condition: { field: "verticalSpeed", op: "eq", value: 0 }, timeoutMs: 5000 };
    state.set("commandPending", true);
    const reversing = String(winch.state && winch.state.mode || "on-deck");
    setAction(mode === "deploy"
        ? (reversing === "recovering" ? "Reversing winch · deploying to " + targetDepth + " m" : "Deploying CTD to " + targetDepth + " m")
        : mode === "recover"
            ? (reversing === "deploying" ? "Reversing winch · recovering to deck" : "Recovering CTD to deck")
            : "Holding CTD at current depth");
    const result = await devices.action(winch.id, "command", { payload: { mode, targetDepth } }, options);
    state.set("commandPending", false);
    // Keep the proof, not just the verdict: every rung this command reached, with
    // the evidence the runtime recorded for it.
    state.set("lastCommand", devices.commandEvidence(result.commandId));
    if (result.success) {
        setAction(mode === "deploy"
            ? "Cast on station at " + targetDepth + " m"
            : mode === "recover"
                ? "CTD recovered to surface"
                : "Winch hold verified");
        events.emit("vessel/ctd/command-verified", { mode, targetDepth, lifecycleState: result.lifecycleState });
    }
    else {
        setAction("CTD command not verified: " + String(result.error || result.lifecycleState || "unknown"));
    }
    projectCtdState();
}
export async function protectCtdTension() {
    if (Boolean(state.get("tensionProtectionActive")))
        return;
    const winch = byTopic("switch/vessel/ctd-winch/state");
    if (!winch || !Boolean(winch.state && winch.state.on))
        return;
    const sonde = byTopic("sensor/ctd/sonde");
    if (!sonde)
        return;
    state.set("tensionProtectionActive", true);
    setAction("Cable tension high · arresting winch motion");
    const result = await devices.action(winch.id, "command", { payload: { mode: "hold", targetDepth: Number(state.get("depth") || 0) } }, {
        tier: "observed",
        deviceId: sonde.id,
        condition: { field: "verticalSpeed", op: "eq", value: 0 },
        timeoutMs: 5000,
    });
    state.set("tensionProtectionActive", false);
    if (result.success) {
        // Recorded so the pane can say plainly that Aeolus did this, not the
        // operator: an automatic action the operator cannot account for is worse
        // than no automation at all.
        state.set("interlockAt", Date.now());
        setAction("Winch stopped on high-tension interlock");
        events.emit("vessel/ctd/tension-protection", { lifecycleState: result.lifecycleState });
    }
    else {
        setAction("High-tension stop not verified");
    }
    projectCtdState();
}
export async function handleCtdOperatorEvent(event: string | undefined) {
    if (event === "deploy-420")
        await commandCtdWinch("deploy", 420);
    else if (event === "hold-ctd")
        await commandCtdWinch("hold", Number(state.get("depth") || 120));
    else if (event === "recover-ctd")
        await commandCtdWinch("recover", 3);
    else if (event === "simulate-snag") {
        events.emit("vessel/sim/ctd-snag", {});
        setAction("Injecting cable snag into simulator");
    }
    else if (event === "reset-ctd") {
        events.emit("vessel/sim/ctd-reset", {});
        state.set("tensionProtectionActive", false);
        state.set("interlockAt", 0);
        setAction("Resetting CTD to on deck");
    }
}
