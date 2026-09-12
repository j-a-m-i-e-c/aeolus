// Flow-through seawater projection, pump control and front detection.
function byTopic(wanted: string) {
    return devices.list().find((device) => device.topic === wanted);
}
function setAction(label: string) {
    state.set("lastAction", { label, at: Date.now() });
}
/**
 * Report the surface-water stream to whoever is aggregating it.
 *
 * Emitted from this automation's own state rather than from a device read, so a caller
 * that has just commanded the intake pump reports the pump it commanded. See
 * setSamplingPump for why reading the devices there would report the opposite.
 */
export function publishUnderwaySummary() {
    events.emit("vessel/summary/underway", {
        tsgPumpOn: Boolean(state.get("pumpOn")),
        tsgFlow: Number(state.get("flow") || 0),
        sst: Number(state.get("sst") || 0),
        surfaceSalinity: Number(state.get("salinity") || 0),
        chlorophyll: Number(state.get("chlorophyll") || 0),
        frontDetected: Boolean(state.get("frontDetected")),
    });
}
/**
 * Project the thermosalinograph and intake-pump readings.
 *
 * Correct wherever this path runs because a device published — the snapshot is then the
 * state that woke the automation. Not correct straight after issuing a command.
 */
export function projectUnderwayState() {
    const tsg = byTopic("sensor/underway/tsg");
    const pump = byTopic("switch/vessel/tsg-pump/state");
    const sst = Number(tsg && tsg.state && tsg.state.sst);
    const salinity = Number(tsg && tsg.state && tsg.state.salinity);
    const flow = Number(tsg && tsg.state && tsg.state.flow);
    const chlorophyll = Number(tsg && tsg.state && tsg.state.chlorophyll);
    const turbidity = Number(tsg && tsg.state && tsg.state.turbidity);
    const pumpOn = Boolean(pump && pump.state && pump.state.on);
    if (!isNaN(sst))
        state.set("sst", sst);
    if (!isNaN(salinity))
        state.set("salinity", salinity);
    if (!isNaN(flow))
        state.set("flow", flow);
    if (!isNaN(chlorophyll))
        state.set("chlorophyll", chlorophyll);
    if (!isNaN(turbidity))
        state.set("turbidity", turbidity);
    state.set("pumpOn", pumpOn);
    let profile = state.get("profile");
    if (!Array.isArray(profile))
        profile = [];
    if (!isNaN(sst) && !isNaN(salinity) && !isNaN(flow) && flow > 0.2) {
        profile = profile.concat([{
                sst,
                salinity,
                chlorophyll: isNaN(chlorophyll) ? 0 : chlorophyll,
                at: Date.now(),
            }]).slice(-18);
        state.set("profile", profile);
    }
    publishUnderwaySummary();
    return { sst, salinity, flow };
}
export async function setSamplingPump(on: boolean) {
    const pump = byTopic("switch/vessel/tsg-pump/state");
    const tsg = byTopic("sensor/underway/tsg");
    if (!pump || !tsg) {
        setAction("Flow-through system unavailable");
        return;
    }
    state.set("commandPending", true);
    setAction(on ? "Starting flow-through seawater intake" : "Stopping flow-through seawater intake");
    const result = await devices.action(pump.id, "command", { payload: { on } }, {
        tier: "observed",
        deviceId: tsg.id,
        condition: { field: "flow", op: on ? "gt" : "eq", value: on ? 0.5 : 0 },
        timeoutMs: 5000,
        evidence: {
            intent: on ? "Start flow-through sampling" : "Stop flow-through sampling",
            // The flow meter is a separate instrument from the pump, which is what makes
            // this an observation rather than the pump agreeing with itself.
            observedLabel: on ? "flow meter registered seawater moving" : "flow meter fell to zero",
        },
    });
    state.set("commandPending", false);
    // Keep the proof, not just the verdict. It also names the instrument: every number
    // on this pane comes from water the pump is drawing, so whether flow was measured
    // is the question behind all of them.
    state.set("lastCommand", devices.commandEvidence(result.commandId));
    if (result.success) {
        // Record the pump we commanded. This used to call projectUnderwayState(), which
        // re-reads devices.list() — and that list is a snapshot taken once at the start of
        // the execution, so it still described the intake as it was BEFORE the command. A
        // verified start therefore projected "NO SAMPLE FLOW" and emitted a stopped pump to
        // the mission overview, contradicting the receipt beside it.
        //
        // Only the pump. The flow figure and the chemistry belong to the
        // thermosalinograph, and the publish that satisfied the observation is the one
        // that re-runs this automation with them.
        state.set("pumpOn", on);
        setAction(on ? "Underway sampling verified · flow observed" : "Sampling stopped · zero flow observed");
    }
    else {
        setAction("Sampling command not verified: " + String(result.error || result.lifecycleState || "unknown"));
    }
    // Reported either way, and from state. On failure that republishes the unchanged
    // pump, so the overview cannot be left showing an intake that never started.
    publishUnderwaySummary();
}
export function handleUnderwayDemoEvent(event: string | undefined) {
    if (event === "simulate-front") {
        state.set("frontDetected", false);
        events.emit("vessel/sim/ocean-front", {});
        setAction("Injecting hydrographic front ahead of vessel");
    }
    else if (event === "reset-underway") {
        events.emit("vessel/sim/underway-reset", {});
        state.set("frontDetected", false);
        state.set("profile", []);
        setAction("Resetting surface-water transect");
    }
}
export function detectHydrographicFront(previousSst: number, previousSalinity: number, current: ReturnType<typeof projectUnderwayState>) {
    if (current.flow <= 0.5 || isNaN(previousSst) || isNaN(previousSalinity) || isNaN(current.sst) || isNaN(current.salinity))
        return;
    const gradient = Math.abs(current.sst - previousSst) + Math.abs(current.salinity - previousSalinity) * 3;
    if (gradient >= 0.7 && !Boolean(state.get("frontDetected"))) {
        state.set("frontDetected", true);
        setAction("Hydrographic front detected in flow-through stream");
        events.emit("vessel/underway/front-detected", {
            sst: current.sst,
            salinity: current.salinity,
            gradient,
        });
        // Republished so the overview learns about the front. A full re-projection here
        // would only re-read the same snapshot this call was derived from.
        publishUnderwaySummary();
    }
}
