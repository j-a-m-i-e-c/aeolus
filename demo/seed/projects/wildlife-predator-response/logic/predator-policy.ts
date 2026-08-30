// Predator classification policy and verified deterrent control.
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
    const result = await devices.action(deterrent.id, "command", { payload: { active: false, target: "none", pulseMs: 0 } }, {
        tier: "observed",
        deviceId: deterrent.id,
        condition: { field: "active", op: "eq", value: false },
        timeoutMs: 5000,
    });
    if (result.success) {
        state.set("activeUntil", 0);
        state.set("lastOutcome", "Deterrent physically stopped");
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
    const result = await devices.action(deterrent.id, "command", { payload: { active: true, target: classification.label, pulseMs } }, {
        tier: "observed",
        deviceId: deterrent.id,
        condition: { field: "active", op: "eq", value: true },
        timeoutMs: 5000,
    });
    state.set("commandPending", false);
    if (result.success) {
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
