import { byTopic, setAction } from "./runtime";
async function refillZone(zone: "house" | "shed", tankTopic: string, valveTopic: string, targetPct: number) {
    const tank = byTopic(tankTopic);
    const valve = byTopic(valveTopic);
    if (!tank || !valve)
        return false;
    const current = Number(tank.state && tank.state.value);
    if (!isNaN(current) && current >= targetPct)
        return true;
    const key = zone === "house" ? "houseRefillActive" : "shedRefillActive";
    state.set(key, true);
    setAction((zone === "house" ? "House" : "Shed") + " tank low · opening header feed");
    const result = await devices.action(valve.id, "command", { payload: { on: true, targetPct } }, {
        tier: "observed",
        deviceId: tank.id,
        condition: { field: "value", op: "gte", value: targetPct - 0.5 },
        timeoutMs: 5000,
    });
    state.set(key, false);
    if (result.success) {
        setAction((zone === "house" ? "House" : "Shed") + " tank recovered from header storage");
        events.emit("farm/water/downstream-refill-verified", { zone, targetPct, lifecycleState: result.lifecycleState });
        return true;
    }
    setAction((zone === "house" ? "House" : "Shed") + " refill not verified: " + String(result.error || result.lifecycleState || "unknown"));
    events.emit("farm/water/downstream-refill-failed", { zone, lifecycleState: result.lifecycleState });
    return false;
}
export async function reconcileDownstream() {
    if (Boolean(state.get("distributionActive")))
        return;
    const header = byTopic("sensor/farm/header-tank");
    const house = byTopic("sensor/farm/house-tank");
    const shed = byTopic("sensor/farm/shed-tank");
    const headerPct = Number(header && header.state && header.state.value);
    const housePct = Number(house && house.state && house.state.value);
    const shedPct = Number(shed && shed.state && shed.state.value);
    const needHouse = !isNaN(housePct) && housePct < 55;
    const needShed = !isNaN(shedPct) && shedPct < 65;
    if ((!needHouse && !needShed) || (!isNaN(headerPct) && headerPct <= 20))
        return;
    state.set("distributionActive", true);
    try {
        if (needHouse)
            await refillZone("house", "sensor/farm/house-tank", "switch/farm/house-fill/state", 75);
        if (needShed)
            await refillZone("shed", "sensor/farm/shed-tank", "switch/farm/shed-fill/state", 75);
    }
    finally {
        state.set("distributionActive", false);
    }
}
