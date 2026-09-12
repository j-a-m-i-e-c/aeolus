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
// One receipt per execution, not per command.
//
// A cue drives the lighting desk and THEN the effects rack: two physical commands,
// one thing the operator did. Keeping a single `lastCommand` meant the second command
// overwrote the first, so the pane reported the lighting transition and silently
// dropped the effect — while still looking like a complete receipt.
//
// Grouping also lets the two commands keep their different tiers side by side, which
// is the more instructive reading: the desk can prove its transition completed, the
// effects rack can only prove acknowledgement, and the contrast within one cue is
// exactly what the showcase is for.
//
// Called once per entry point, after the commands have resolved, since the evidence
// is read from durable records rather than accumulated by this script.
function publishExecutionProof() {
    const group = devices.executionEvidence();
    if (group)
        state.set("lastExecution", group);
}
/**
 * Project the desk, rack and safety-loop readings.
 *
 * Correct wherever this path runs because a device published — the snapshot is then the
 * state that woke the automation. Not correct straight after issuing a command; see
 * runLightingCue.
 */
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
        evidence: {
            intent: "Lighting cue · " + scene,
            observedLabel: "desk finished the transition",
        },
    });
    state.set("pending", false);
    if (!result.success) {
        setAction("Lighting cue not verified: " + String(result.error || result.lifecycleState || "unknown"));
        return false;
    }
    // Record what the cue established. This used to call projectStageState(), which
    // re-reads devices.list() — and that list is a snapshot taken once at the start of the
    // execution, so it still described the rig as it was BEFORE the cue. A verified
    // transition therefore left the pane showing the previous scene and, worse, still
    // mid-transition, so the desk looked stuck for as long as it took the next publish to
    // arrive. The fixture count and cue number are the desk's own and are left to it.
    state.set("scene", scene);
    state.set("master", master);
    state.set("transitioning", false);
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
    // Acknowledgement is the honest ceiling for a transient effect.
    //
    // The rack sets `active` as it accepts and clears it on a timer once the pulse
    // finishes, so observing `active` is the command read back rather than evidence a
    // confetti burst happened. Nothing in this rig measures the effect itself — which
    // is realistic, and worth showing: the lighting desk on the same tab CAN prove
    // its transition completed, and the contrast is the point.
    const result = await devices.action(rack.id, "command", { payload: { active: true, effect, pulseMs, haze } }, {
        tier: "acknowledged",
        timeoutMs: 5000,
        evidence: {
            intent: "Fire stage effect · " + effect,
        },
    });
    state.set("pendingFx", false);
    if (result.success) {
        // What the rack accepted, not a re-read of the pre-command snapshot. Only the
        // commanded fields, which is all an acknowledged tier entitles this to say.
        state.set("fxActive", true);
        state.set("effect", effect);
        state.set("haze", haze);
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
        tier: "acknowledged",
        timeoutMs: 5000,
        evidence: {
            intent: "Stop stage effects",
        },
    });
    if (result.success) {
        // What the rack accepted, not a re-read. Without this the pane kept showing the
        // effect running immediately after a stop it had just acknowledged.
        state.set("fxActive", false);
        state.set("effect", "none");
    }
    setAction(result.success
        ? "Physical effects stopped · acknowledged by the rack"
        : "Physical effects stop not verified: " + String(result.error || result.lifecycleState || "unknown"));
    publishExecutionProof();
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
    // Published regardless of the outcome: a cue whose lighting failed still issued a
    // command, and where it stopped is the most useful thing the pane can show.
    publishExecutionProof();
}
export async function fireOperatorEffect(payload: Record<string, unknown>) {
    const effect = String(payload.effect || "haze");
    if (!EFFECTS.includes(effect) || effect === "none")
        return;
    await runPhysicalEffect(effect, EFFECT_DURATIONS[effect] || 1200, effect.toUpperCase());
    publishExecutionProof();
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
