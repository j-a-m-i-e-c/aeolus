export function setAction(label: string) {
    state.set("lastAction", { label, at: Date.now() });
}
function byTopic(wanted: string) {
    return devices.list().find((device) => device.topic === wanted);
}
function init(key: string, value: unknown) {
    if (state.get(key) === undefined)
        state.set(key, value);
}
export function initialiseEnergyState() {
    init("autoOpportunity", true);
    init("chargerCommandPending", false);
    init("demoScenarioPending", "");
    init("energyMode", "solar-surplus");
}
export async function setCharger(on: boolean, reason: string) {
    if (Boolean(state.get("chargerCommandPending")))
        return;
    const charger = byTopic("switch/farm/charger-bank/state");
    if (!charger) {
        setAction("Opportunity-load command blocked: charger bank unavailable");
        return;
    }
    const currentlyOn = Boolean(charger.state && charger.state.on);
    if (currentlyOn === on)
        return;
    state.set("chargerCommandPending", true);
    setAction((on ? "Enabling" : "Shedding") + " shed charger bank · " + reason);
    const result = await devices.action(charger.id, "command", { payload: { on } }, {
        tier: "observed",
        deviceId: charger.id,
        condition: on
            ? { field: "watts", op: "gt", value: 0 }
            : { field: "watts", op: "eq", value: 0 },
        timeoutMs: 5000,
    });
    state.set("chargerCommandPending", false);
    if (result.success) {
        setAction((on ? "Opportunity charging online" : "Opportunity charging shed") + " · physical state verified");
        events.emit("farm/energy/opportunity-load", { on, reason, lifecycleState: result.lifecycleState });
    }
    else {
        setAction("Charger-bank command not verified: " + String(result.error || result.lifecycleState || "unknown"));
    }
}
