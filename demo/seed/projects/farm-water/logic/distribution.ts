import { byTopic, setAction } from "./runtime";
async function refillZone(zone: "house" | "office", tankTopic: string, valveTopic: string, targetPct: number) {
    const tank = byTopic(tankTopic);
    const valve = byTopic(valveTopic);
    if (!tank || !valve)
        return false;
    const current = Number(tank.state && tank.state.value);
    if (!isNaN(current) && current >= targetPct)
        return true;
    const label = zone === "house" ? "House" : "Office";
    const key = zone === "house" ? "houseRefillActive" : "officeRefillActive";
    state.set(key, true);
    setAction(label + " tank low · opening header feed");
    // Opening the valve is not the point; the tank coming back up is. So the proof is
    // the receiving tank's own level sensor rather than the valve agreeing it opened —
    // the valve's `on` flag is an echo of the command, which proves nothing physical.
    const result = await devices.action(valve.id, "command", { payload: { on: true, targetPct } }, {
        tier: "observed",
        deviceId: tank.id,
        condition: { field: "value", op: "gte", value: targetPct - 0.5 },
        timeoutMs: 5000,
        evidence: {
            // Named for the operation, not the mechanism, so the receipt is legible
            // beside the other water commands in the same execution feed.
            intent: "Refill " + label.toLowerCase() + " tank to " + targetPct + "%",
            observedLabel: label + " tank level recovered",
        },
    });
    state.set(key, false);
    // Projected like the transfer commands are. Without this the third of the three
    // observed water commands left no receipt at all, so an automatic refill happened
    // invisibly even though it was the best-evidenced thing the automation did.
    state.set("lastCommand", devices.commandEvidence(result.commandId));
    if (result.success) {
        setAction(label + " tank recovered from header storage");
        events.emit("farm/water/downstream-refill-verified", { zone, targetPct, lifecycleState: result.lifecycleState });
        return true;
    }
    setAction(label + " refill not verified: " + String(result.error || result.lifecycleState || "unknown"));
    events.emit("farm/water/downstream-refill-failed", { zone, lifecycleState: result.lifecycleState });
    return false;
}
export async function reconcileDownstream() {
    if (Boolean(state.get("distributionActive")))
        return;
    const header = byTopic("sensor/farm/header-tank");
    const house = byTopic("sensor/farm/house-tank");
    // `sensor/farm/shed-tank` is the office tank. Legacy topic, current name.
    const office = byTopic("sensor/farm/shed-tank");
    const headerPct = Number(header && header.state && header.state.value);
    const housePct = Number(house && house.state && house.state.value);
    const officePct = Number(office && office.state && office.state.value);
    const needHouse = !isNaN(housePct) && housePct < 55;
    const needOffice = !isNaN(officePct) && officePct < 65;
    if ((!needHouse && !needOffice) || (!isNaN(headerPct) && headerPct <= 20))
        return;
    state.set("distributionActive", true);
    try {
        if (needHouse)
            await refillZone("house", "sensor/farm/house-tank", "switch/farm/house-fill/state", 75);
        if (needOffice)
            await refillZone("office", "sensor/farm/shed-tank", "switch/farm/shed-fill/state", 75);
    }
    finally {
        state.set("distributionActive", false);
    }
}
