// Flow-through seawater projection, pump control and front detection.
function byTopic(wanted: string) {
    return devices.list().find((device) => device.topic === wanted);
}
function setAction(label: string) {
    state.set("lastAction", { label, at: Date.now() });
}
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
    events.emit("vessel/summary/underway", {
        tsgPumpOn: pumpOn,
        tsgFlow: isNaN(flow) ? 0 : flow,
        sst: isNaN(sst) ? 0 : sst,
        surfaceSalinity: isNaN(salinity) ? 0 : salinity,
        chlorophyll: isNaN(chlorophyll) ? 0 : chlorophyll,
        frontDetected: Boolean(state.get("frontDetected")),
    });
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
    });
    state.set("commandPending", false);
    if (result.success) {
        setAction(on ? "Underway sampling verified · flow observed" : "Sampling stopped · zero flow observed");
    }
    else {
        setAction("Sampling command not verified: " + String(result.error || result.lifecycleState || "unknown"));
    }
    projectUnderwayState();
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
        projectUnderwayState();
    }
}
