// Off-grid power implementation. logic/index.ts owns policy flow.

/**
 * Output, in watts, at which the generator counts as actually generating.
 *
 * Below this the engine has been asked to start and has not got there yet, which is a
 * different fact from the site having power.
 */
const GENERATOR_VERIFIED_W = 1500;

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
    // Proven by power on the bus, not by the contactor agreeing it closed.
    //
    // `on` is a command echo: the generator publishes it the instant it accepts. What an
    // operator actually needs to know is whether the machine is making power, and
    // `outputW` is that measurement — it ramps as the engine comes up, so a start that
    // never reaches output fails verification instead of reporting success. This was
    // acknowledged-only for an honest reason: the fixture used to assert `on` and a full
    // `outputW` in the same update, so observing output would have been the same echo
    // wearing a better name. Ramping the machine is what made the stronger claim true
    // (showcase-cleanup §9.5).
    const result = await devices.action(generator.id, "command", { payload: { on } }, {
        tier: "observed",
        deviceId: generator.id,
        condition: on
            ? { field: "outputW", op: "gte", value: GENERATOR_VERIFIED_W }
            : { field: "outputW", op: "lte", value: 50 },
        timeoutMs: 5000,
        evidence: {
            intent: on ? "Start backup generator" : "Stop backup generator",
            observedLabel: on
                ? "generator reached " + GENERATOR_VERIFIED_W + " W of output"
                : "generator output fell away",
        },
    });
    state.set("pending", false);
    // Keep the proof, not just the verdict: every rung this command reached, with the
    // evidence the runtime recorded for it.
    state.set("lastCommand", devices.commandEvidence(result.commandId));
    if (result.success) {
        state.set("generatorOn", on);
        setAction(reason);
    }
    else {
        setAction("Generator command not verified: " + String(result.error || result.lifecycleState || "unknown"));
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
    // What the machine is actually producing, and whether the bank is gaining on it.
    // Charging is a fact about the balance, so it is derived from the balance rather
    // than from whether the generator happens to be running.
    state.set("generatorOutputW", Number((generator && generator.state && generator.state.outputW) ?? 0));
    state.set("charging", net > 0);
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
        generatorOutputW: Number(state.get("generatorOutputW") || 0),
        charging: net > 0,
        foodDays: Number(supplyState.foodDays ?? 64),
        waterDays: Number(supplyState.waterDays ?? 80),
        // Who the days of food are actually for. The overview draws the habitat, so
        // it needs the count rather than a hard-coded pair of figures.
        occupants: Number(supplyState.occupants ?? 4),
        bunks: Number(supplyState.bunks ?? 6),
    });
    return { battery, generatorOn };
}
