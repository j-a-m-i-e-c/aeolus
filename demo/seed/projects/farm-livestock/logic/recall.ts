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
    });
    state.set("recallInProgress", false);
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
