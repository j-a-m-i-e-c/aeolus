// Predator classification policy and verified deterrent control.
/** Speed the deterrent fan is asked to hold during a pulse, in rpm. */
const DETERRENT_TARGET_RPM = 2400;
/** Tachometer reading that proves the fan is genuinely turning, in rpm. */
const DETERRENT_VERIFIED_RPM = 2000;
function byTopic(wanted: string) {
    return devices.list().find((device) => device.topic === wanted);
}
function setAction(label: string) {
    state.set("lastAction", { label, at: Date.now() });
}
export function initialisePredatorPolicy() {
    if (state.get("armed") === undefined)
        state.set("armed", true);
    if (state.get("responsesToday") === undefined)
        state.set("responsesToday", 3);
    if (state.get("lastOutcome") === undefined)
        state.set("lastOutcome", "Waiting for classified wildlife event");
    if (state.get("predatorMovement") === undefined) {
        state.set("predatorMovement", "clear");
        state.set("predatorDistanceM", 0);
        state.set("predatorSpeedMps", 0);
    }
}
/**
 * Project the station's physical readings into this automation's own state.
 *
 * The pane cannot read devices, so the readings only reach the operator through here.
 *
 * Correct wherever this path runs because a device published — the snapshot is then the
 * state that woke the automation. Not correct straight after issuing a command: this used
 * to be called there too, on the stated reasoning that it would pick up "the tachometer
 * value the verification waited on". It cannot. devices.list() is a snapshot taken once
 * at the start of the execution, so calling it after a command projected the station as
 * it was BEFORE the pulse — a measured 0 rpm beside an outcome reading VERIFIED.
 */
export function projectStationReadings() {
    const deterrent = byTopic("switch/wildlife/deterrent/state");
    const power = byTopic("sensor/wildlife/site-power");
    const animal = byTopic("sensor/wildlife/detection");
    const deterrentState = deterrent && deterrent.state ? deterrent.state : {};
    const powerState = power && power.state ? power.state : {};
    const animalState = animal && animal.state ? animal.state : {};
    state.set("commandRpm", Number(deterrentState.commandRpm || 0));
    state.set("measuredRpm", Number(deterrentState.measuredRpm || 0));
    state.set("deterrentActive", Boolean(deterrentState.active));
    state.set("solarW", Number(powerState.solarW || 0));
    state.set("batteryPct", Number(powerState.battery || 0));
    // The camera ranges the animal; this pane reports that reading rather than
    // inferring a position from how long ago the detection fired.
    state.set("predatorDistanceM", Number(animalState.distanceM || 0));
    state.set("predatorSpeedMps", Number(animalState.speedMps || 0));
    state.set("predatorMovement", String(animalState.movement || "clear"));
}
export function publishResponseStatus() {
    events.emit("wildlife/response/status", {
        armed: Boolean(state.get("armed")),
        activeUntil: Number(state.get("activeUntil") || 0),
        lastSpecies: String(state.get("lastSpecies") || "none"),
        responsesToday: Number(state.get("responsesToday") || 3),
        lastOutcome: String(state.get("lastOutcome") || "idle"),
        lastVerifiedAt: Number(state.get("lastVerifiedAt") || 0),
    });
}
export async function stopDeterrent() {
    const deterrent = byTopic("switch/wildlife/deterrent/state");
    if (!deterrent)
        return;
    // A stop is proven by the fan slowing to a standstill, so the observation is the
    // tachometer falling rather than the actuator clearing its own flag.
    const result = await devices.action(deterrent.id, "command", { payload: { active: false, target: "none", pulseMs: 0 } }, {
        tier: "observed",
        deviceId: deterrent.id,
        condition: { field: "measuredRpm", op: "lte", value: 100 },
        timeoutMs: 5000,
        evidence: {
            intent: "Stop predator deterrent",
            observedLabel: "tachometer wound down",
        },
    });
    // Projected like the activation's receipt is. Without this a verified stop left the
    // previous activation's proof on screen, so the card described a command that was no
    // longer the last one issued — and the stop, which is evidenced just as well, showed
    // nothing at all.
    state.set("lastCommand", devices.commandEvidence(result.commandId));
    if (result.success) {
        state.set("activeUntil", 0);
        state.set("lastOutcome", "Deterrent physically stopped");
        // What the command established, not a re-read. The tachometer figure is the
        // station's to report and its next publish brings it.
        state.set("deterrentActive", false);
        state.set("commandRpm", 0);
    }
    else {
        state.set("lastOutcome", "Deterrent stop not verified");
        setAction("Deterrent stop not verified: " + String(result.error || result.lifecycleState || "unknown"));
    }
    publishResponseStatus();
}
export async function handlePredatorOperatorEvent(event: string | undefined) {
    if (event === "toggle-armed") {
        const next = !Boolean(state.get("armed"));
        state.set("armed", next);
        if (!next)
            await stopDeterrent();
        setAction(next ? "Predator response armed" : "Predator response disarmed");
        publishResponseStatus();
    }
    else if (event === "stop-deterrent") {
        await stopDeterrent();
        setAction("Deterrent stopped by operator");
    }
}
export function acceptClassification(payload: Record<string, unknown>) {
    const eventId = String(payload.eventId || "");
    if (eventId && eventId === String(state.get("lastHandledEventId") || ""))
        return null;
    if (eventId)
        state.set("lastHandledEventId", eventId);
    const category = String(payload.category || "unknown");
    const label = String(payload.label || "Unknown");
    state.set("lastSpecies", label);
    state.set("lastConfidence", Number(payload.confidence || 0));
    state.set("lastCategory", category);
    return { category, label };
}
export async function applyPredatorPolicy(classification: {
    category: string;
    label: string;
}) {
    if (classification.category !== "predator") {
        state.set("lastOutcome", classification.label + " classified native · no actuation");
        setAction(classification.label + " ignored by predator policy · native fauna");
        publishResponseStatus();
        return;
    }
    if (!Boolean(state.get("armed"))) {
        state.set("lastOutcome", classification.label + " detected while response disarmed");
        setAction(classification.label + " detected · response disarmed");
        publishResponseStatus();
        return;
    }
    const deterrent = byTopic("switch/wildlife/deterrent/state");
    if (!deterrent) {
        state.set("lastOutcome", "Predator detected · deterrent unavailable");
        setAction("Predator detected · deterrent unavailable");
        publishResponseStatus();
        return;
    }
    const pulseMs = 6200;
    state.set("commandPending", true);
    state.set("lastOutcome", "Issuing verified deterrent command");
    setAction(classification.label + " detected · issuing humane light/sound pulse");
    // Verified against the tachometer, not the actuator's own `active` flag. A
    // controller reporting "yes, I'm on" only proves it accepted the command; a measured
    // speed near the requested one proves the fan is actually turning.
    const result = await devices.action(deterrent.id, "command", { payload: { active: true, target: classification.label, pulseMs, rpm: DETERRENT_TARGET_RPM } }, {
        tier: "observed",
        deviceId: deterrent.id,
        condition: { field: "measuredRpm", op: "gte", value: DETERRENT_VERIFIED_RPM },
        timeoutMs: 5000,
        evidence: {
            intent: "Activate deterrent · " + classification.label,
            observedLabel: "tachometer reached the requested speed",
        },
    });
    state.set("commandPending", false);
    // Keep the proof, not just the verdict: every rung this command reached, with
    // the evidence the runtime recorded for it.
    state.set("lastCommand", devices.commandEvidence(result.commandId));
    if (result.success) {
        // What the command established. The measured rpm the verification waited on is not
        // available here — the receipt names the condition it satisfied, and the station's
        // own next publish brings the reading itself.
        state.set("deterrentActive", true);
        state.set("commandRpm", DETERRENT_TARGET_RPM);
        const at = Date.now();
        state.set("activeUntil", at + pulseMs);
        state.set("responsesToday", Number(state.get("responsesToday") || 3) + 1);
        state.set("lastVerifiedAt", at);
        state.set("lastVerifiedTarget", classification.label);
        state.set("lastOutcome", classification.label + " response VERIFIED");
        setAction(classification.label + " response verified · bounded " + (pulseMs / 1000).toFixed(1) + "s pulse");
    }
    else {
        state.set("lastOutcome", "Command failed verification");
        setAction("Deterrent command not verified: " + String(result.error || result.lifecycleState || "unknown"));
    }
    publishResponseStatus();
}
