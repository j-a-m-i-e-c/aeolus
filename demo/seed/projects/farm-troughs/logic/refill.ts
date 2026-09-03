export function setAction(label: string) {
    state.set("lastAction", { label, at: Date.now() });
}
function byTopic(wanted: string) {
    return devices.list().find((device) => device.topic === wanted);
}
export async function refill(source: string) {
    // Wait for the herd to clear, not merely to stop drinking: cattle walking in or
    // still moving off are physically at the troughs, and the manifold must not
    // open around them.
    if (Boolean(state.get("refillCommandActive")) || Boolean(state.get("herdPresent")))
        return;
    const troughs = byTopic("sensor/farm/troughs");
    const actuator = byTopic("switch/farm/trough-refill/state");
    if (!actuator || !troughs) {
        setAction("Refill blocked: trough hardware unavailable");
        return;
    }
    const lowIds = Array.isArray(troughs.state && troughs.state.lowIds)
        ? troughs.state.lowIds.filter((id: unknown) => typeof id === "string")
        : [];
    if (lowIds.length === 0) {
        setAction("No low troughs require refill");
        return;
    }
    state.set("refillCommandActive", true);
    setAction((source === "automatic" ? "AUTO · " : "") + "opening refill manifold for " + lowIds.length + " low troughs");
    const result = await devices.action(actuator.id, "command", { payload: { active: true, targets: lowIds } }, {
        tier: "observed",
        deviceId: troughs.id,
        condition: { all: [{ field: "low", op: "eq", value: 0 }, { field: "refilling", op: "eq", value: 0 }] },
        timeoutMs: 5000,
    });
    state.set("refillCommandActive", false);
    if (result.success) {
        setAction((source === "automatic" ? "Automatic" : "Operator") + " refill verified · targeted troughs recovered");
        events.emit("farm/troughs/refill-verified", { source: source || "operator", targets: lowIds, lifecycleState: result.lifecycleState });
    }
    else {
        setAction("Refill not verified: " + String(result.error || result.lifecycleState || "unknown"));
        events.emit("farm/troughs/refill-failed", { reason: result.error || "not observed", lifecycleState: result.lifecycleState });
    }
}
