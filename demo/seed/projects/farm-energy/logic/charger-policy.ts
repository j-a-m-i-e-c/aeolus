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
    // Acknowledgement is the honest ceiling.
    //
    // `watts` looks like a measurement but the charger publishes it as `on ? 450 : 0`
    // in the same breath as accepting the command — the command scaled to a number,
    // not a meter reading. A real installation would prove this from the site's own
    // energy metering, independent of what the charger claims about itself.
    const result = await devices.action(charger.id, "command", { payload: { on } }, {
        tier: "acknowledged",
        timeoutMs: 5000,
        evidence: {
            intent: on ? "Enable shed charger bank" : "Shed charger bank",
        },
    });
    state.set("chargerCommandPending", false);
    // Keep the proof, not just the verdict. Acknowledged is the honest ceiling here, and
    // the receipt is where that shows: the card reports what the controller confirmed and
    // marks the observation stage as unavailable rather than leaving it looking unproven.
    state.set("lastCommand", devices.commandEvidence(result.commandId));
    if (result.success) {
        setAction((on ? "Opportunity charging online" : "Opportunity charging shed") + " · physical state verified");
        events.emit("farm/energy/opportunity-load", { on, reason, lifecycleState: result.lifecycleState });
    }
    else {
        setAction("Charger-bank command not verified: " + String(result.error || result.lifecycleState || "unknown"));
    }
}
