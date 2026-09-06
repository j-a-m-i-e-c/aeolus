// Off-grid power implementation. logic/index.ts owns policy flow.
function byTopic(wanted: string) {
    return devices.list().find((device) => device.topic === wanted);
}
function setAction(label: string) {
    state.set("lastAction", { label, at: Date.now() });
}
export async function setGenerator(on: boolean, reason: string) {
    const generator = byTopic("switch/bunker/generator/state");
    if (!generator)
        return;
    state.set("pending", true);
    const result = await devices.action(generator.id, "command", { payload: { on } }, {
        tier: "observed",
        deviceId: generator.id,
        condition: { field: "on", op: "eq", value: on },
        timeoutMs: 5000,
    });
    state.set("pending", false);
    if (result.success) {
        state.set("generatorOn", on);
        setAction(reason);
    }
    else {
        setAction("Generator command not verified");
    }
}
export function handlePowerDemoEvent(event: string | undefined) {
    if (event === "simulate-low-power") {
        events.emit("bunker/sim/low-power", {});
        setAction("Injecting cloud cover + low battery reserve");
    }
    else if (event === "reset-power") {
        events.emit("bunker/sim/power-reset", {});
        setAction("Resetting power system to nominal");
    }
}
export function projectPowerAndSupplies() {
    const power = byTopic("sensor/bunker/power");
    const supplies = byTopic("sensor/bunker/supplies");
    const generator = byTopic("switch/bunker/generator/state");
    const powerState = power && power.state ? power.state : {};
    const supplyState = supplies && supplies.state ? supplies.state : {};
    const battery = Number(powerState.battery ?? 74);
    const solar = Number(powerState.solarW ?? 1800);
    const load = Number(powerState.loadW ?? 1200);
    const net = Number(powerState.netW ?? (solar - load));
    const generatorOn = Boolean(generator && generator.state && generator.state.on);
    state.set("battery", battery);
    state.set("solar", solar);
    state.set("load", load);
    state.set("net", net);
    state.set("generatorOn", generatorOn);
    state.set("fuel", Number((generator && generator.state && generator.state.fuel) ?? 62));
    state.set("foodDays", Number(supplyState.foodDays ?? 64));
    state.set("waterDays", Number(supplyState.waterDays ?? 80));
    state.set("meds", Number(supplyState.meds ?? 45));
    state.set("beans", Number(supplyState.beans ?? 312));
    state.set("occupants", Number(supplyState.occupants ?? 4));
    state.set("bunks", Number(supplyState.bunks ?? 6));
    events.emit("bunker/summary/power", {
        battery,
        solar,
        load,
        net,
        generatorOn: Boolean(state.get("generatorOn")),
        foodDays: Number(supplyState.foodDays ?? 64),
        waterDays: Number(supplyState.waterDays ?? 80),
        // Who the days of food are actually for. The overview draws the habitat, so
        // it needs the count rather than a hard-coded pair of figures.
        occupants: Number(supplyState.occupants ?? 4),
        bunks: Number(supplyState.bunks ?? 6),
    });
    return { battery, generatorOn };
}
