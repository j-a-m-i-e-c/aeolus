// Stage lighting, FX safety and verified cue execution.
type CuePayload = {
    scene: string;
    label: string;
    effect: string;
    master: number;
    transitionMs: number;
    pulseMs: number;
};
const LIGHTING_SCENES = ["wash", "verse", "chorus", "red", "blackout", "blue", "gold", "uv"];
const EFFECTS = ["none", "haze", "strobe", "confetti", "pyro", "rain"];
const EFFECT_DURATIONS: Record<string, number> = {
    haze: 2600,
    strobe: 850,
    confetti: 1100,
    pyro: 700,
    rain: 3600,
};
function byTopic(wanted: string) {
    return devices.list().find((device) => device.topic === wanted);
}
function setAction(label: string) {
    state.set("lastAction", { label, at: Date.now() });
}
export function projectStageState() {
    const dmx = byTopic("switch/stage/dmx/state");
    const fx = byTopic("switch/stage/fx/state");
    const safety = byTopic("sensor/stage/safety");
    const dmxState = dmx && dmx.state ? dmx.state : {};
    const fxState = fx && fx.state ? fx.state : {};
    const safetyState = safety && safety.state ? safety.state : {};
    state.set("scene", String(dmxState.scene || "wash"));
    state.set("master", Number(dmxState.master ?? 72));
    state.set("fixtures", Number(dmxState.fixturesOnline ?? 12));
    state.set("cueNumber", Number(dmxState.cueNumber ?? 1));
    state.set("transitioning", Boolean(dmxState.transitioning));
    state.set("fxActive", Boolean(fxState.active));
    state.set("effect", String(fxState.effect || "none"));
    state.set("lastEffect", String(fxState.lastEffect || "none"));
    state.set("haze", Number(fxState.haze ?? 28));
    state.set("safe", !Boolean(safetyState.estop) && safetyState.fxLoopHealthy !== false);
    state.set("estop", Boolean(safetyState.estop));
    state.set("loopHealthy", safetyState.fxLoopHealthy !== false);
    state.set("doorClosed", safetyState.doorClosed !== false);
    state.set("pyroArmed", safetyState.pyroArmed === true);
    state.set("exclusionClear", safetyState.exclusionZoneClear === true);
    state.set("waterReady", safetyState.waterFxReady === true);
}
function safetyBlockFor(effect: string) {
    const safety = byTopic("sensor/stage/safety");
    const observed = safety && safety.state ? safety.state : {};
    if (Boolean(observed.estop) || observed.fxLoopHealthy === false)
        return "FX safety loop open";
    if (effect === "pyro" && (observed.pyroArmed !== true || observed.exclusionZoneClear !== true)) {
        return "Pyro permissive unavailable";
    }
    if (effect === "rain" && observed.waterFxReady !== true)
        return "Water FX not ready";
    return "";
}
export async function runLightingCue(scene: string, master: number, transitionMs: number, label: string) {
    const controller = byTopic("switch/stage/dmx/state");
    if (!controller) {
        setAction("DMX controller unavailable");
        return false;
    }
    state.set("pending", true);
    state.set("requestedScene", scene);
    const result = await devices.action(controller.id, "command", { payload: { scene, master, transitionMs } }, {
        tier: "observed",
        deviceId: controller.id,
        condition: { field: "transitioning", op: "eq", value: false },
        timeoutMs: 7000,
    });
    state.set("pending", false);
    // Keep the proof, not just the verdict: every rung this command reached, with
    // the evidence the runtime recorded for it.
    state.set("lastCommand", devices.commandEvidence(result.commandId));
    if (!result.success) {
        setAction("Lighting cue not verified: " + String(result.error || result.lifecycleState || "unknown"));
        return false;
    }
    projectStageState();
    setAction(label + " · lighting transition verified");
    try {
        if (db)
            db.write("show-cues", { type: "cue", scene, label, master });
    }
    catch (error) {
        // Cue execution is not blocked by optional history persistence.
    }
    return true;
}
export async function runPhysicalEffect(effect: string, pulseMs: number, label: string) {
    const reason = safetyBlockFor(effect);
    if (reason) {
        setAction(label + " blocked · " + reason);
        return false;
    }
    const rack = byTopic("switch/stage/fx/state");
    if (!rack) {
        setAction("Stage FX rack unavailable");
        return false;
    }
    state.set("pendingFx", true);
    const haze = effect === "haze" ? 62 : Number(state.get("haze") || 28);
    const result = await devices.action(rack.id, "command", { payload: { active: true, effect, pulseMs, haze } }, {
        tier: "observed",
        deviceId: rack.id,
        condition: { field: "active", op: "eq", value: true },
        timeoutMs: 5000,
    });
    state.set("pendingFx", false);
    if (result.success) {
        projectStageState();
        state.set("lastFxVerifiedAt", Date.now());
        setAction(label + " · physical effect verified");
        return true;
    }
    setAction(label + " not verified: " + String(result.error || result.lifecycleState || "unknown"));
    return false;
}
export async function stopPhysicalEffects() {
    const rack = byTopic("switch/stage/fx/state");
    if (!rack)
        return;
    const result = await devices.action(rack.id, "command", { payload: { active: false } }, {
        tier: "observed",
        deviceId: rack.id,
        condition: { field: "active", op: "eq", value: false },
        timeoutMs: 5000,
    });
    projectStageState();
    setAction(result.success
        ? "Physical effects stopped · observed state verified"
        : "Physical effects stop not verified: " + String(result.error || result.lifecycleState || "unknown"));
}
function parseCue(payload: Record<string, unknown>): CuePayload | null {
    const scene = String(payload.scene || "wash");
    const effect = String(payload.effect || "none");
    const master = Number(payload.master ?? 72);
    if (!LIGHTING_SCENES.includes(scene) || !EFFECTS.includes(effect) || !isFinite(master))
        return null;
    return {
        scene,
        effect,
        label: String(payload.label || "Cue"),
        master: Math.max(0, Math.min(100, master)),
        transitionMs: Math.max(150, Math.min(4000, Number(payload.transitionMs ?? 900))),
        pulseMs: Math.max(300, Math.min(7000, Number(payload.pulseMs ?? 1200))),
    };
}
export async function executeCue(payload: Record<string, unknown>) {
    const cue = parseCue(payload);
    if (!cue) {
        setAction("Rejected invalid local cue payload");
        return;
    }
    const lightingVerified = await runLightingCue(cue.scene, cue.master, cue.transitionMs, cue.label);
    if (lightingVerified && cue.effect !== "none") {
        await runPhysicalEffect(cue.effect, cue.pulseMs, cue.label + " / " + cue.effect);
    }
}
export async function fireOperatorEffect(payload: Record<string, unknown>) {
    const effect = String(payload.effect || "haze");
    if (!EFFECTS.includes(effect) || effect === "none")
        return;
    await runPhysicalEffect(effect, EFFECT_DURATIONS[effect] || 1200, effect.toUpperCase());
}
export function handleStageDemoEvent(event: string | undefined) {
    if (event === "simulate-trip") {
        events.emit("stage/sim/safety-trip", {});
        setAction("Injecting physical stage safety trip");
    }
    else if (event === "reset-safety") {
        events.emit("stage/sim/safety-reset", {});
        setAction("Resetting physical stage safety loop");
    }
}
