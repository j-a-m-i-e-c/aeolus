export function setAction(label: string) {
    state.set("lastAction", { label, at: Date.now() });
}
function byTopic(wanted: string) {
    return devices.list().find((device) => device.topic === wanted);
}
export async function recallStrays() {
    const recall = byTopic("switch/fence/recall/state");
    const collars = byTopic("sensor/fence/collars");
    if (!recall || !collars) {
        setAction("Recall blocked: collar or recall hardware unavailable");
        return;
    }
    state.set("recallInProgress", true);
    setAction("Recall dispatched · waiting for collars to return inside boundary");
    const result = await devices.action(recall.id, "command", { payload: { active: true } }, {
        tier: "observed",
        deviceId: collars.id,
        condition: { field: "strays", op: "eq", value: 0 },
        timeoutMs: 5000,
        evidence: {
            intent: "Recall stray livestock",
            observedLabel: "collar network reports no animal outside the boundary",
        },
    });
    state.set("recallInProgress", false);
    // Keep the proof, not just the verdict: every rung this command reached, with the
    // evidence the runtime recorded for it. The observation source named on the card is
    // the collar network, which is the distinction worth showing — the dogs are the
    // mechanism and never the proof.
    state.set("lastCommand", devices.commandEvidence(result.commandId));
    if (result.success) {
        setAction("Recall verified · herd contained");
        events.emit("farm/livestock/recall-verified", { lifecycleState: result.lifecycleState });
    }
    else {
        setAction("Recall not verified: " + String(result.error || result.lifecycleState || "unknown"));
        events.emit("farm/livestock/recall-failed", {
            reason: result.error || "not observed",
            lifecycleState: result.lifecycleState,
        });
    }
}
