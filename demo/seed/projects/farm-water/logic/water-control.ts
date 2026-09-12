// Farm water telemetry and policy implementation.
// logic/index.ts keeps the control flow visible; command mechanics live in Files.
import { reconcileDownstream } from "./distribution";
import { byTopic, initialiseWaterState, setAction } from "./runtime";
import { startTransfer, stopPump } from "./transfer";
export { initialiseWaterState } from "./runtime";
// Named after the physical system, which is not what the MQTT topics are named after.
// `sensor/farm/dam` is the shed catchment and `sensor/farm/shed-tank` is the office
// tank — historical addresses that stay put because a topic is a device's identity and
// renaming one orphans its registered device row. Everything above the wire uses the
// vocabulary the pane uses, so reading this file tells the same story as looking at it
// (showcase-cleanup §4.3).
type WaterSnapshot = {
    sourcePct: number;
    headerPct: number;
    soc: number;
    pumpOn: boolean;
    officePct: number;
    housePct: number;
    flowLpm: number;
    flowTotal: number;
    physicalBatchActive: boolean;
    officeValveOn: boolean;
    houseValveOn: boolean;
};
export async function handleWaterOperatorEvent(event: string | undefined) {
    if (event === "transfer-500")
        await startTransfer(500, "operator");
    else if (event === "transfer-1000")
        await startTransfer(1000, "operator");
    else if (event === "pump-stop")
        await stopPump("operator");
    else if (event === "simulate-header-low") {
        if (String(state.get("demoScenarioPending") || ""))
            return;
        state.set("demoScenarioPending", "header-drawdown");
        state.set("recoveryHoldUntil", Date.now() + 4000);
        events.emit("farm/sim/header-low", {});
        setAction("DEMO · injecting header-tank drawdown");
    }
    else if (event === "simulate-property-demand") {
        if (String(state.get("demoScenarioPending") || ""))
            return;
        state.set("demoScenarioPending", "morning-demand");
        events.emit("farm/sim/property-water-demand", {});
        setAction("DEMO · injecting morning house + office demand");
    }
    else if (event === "reset-water") {
        events.emit("farm/sim/water-reset", {});
        state.set("recoveryHoldUntil", 0);
        state.set("distributionActive", false);
        state.set("houseRefillActive", false);
        state.set("officeRefillActive", false);
        state.set("transferActive", false);
        state.set("transferStopping", false);
        state.set("transferMode", "idle");
        state.set("transferTargetLitres", 0);
        state.set("transferProgressLitres", 0);
        state.set("demoScenarioPending", "");
        setAction("DEMO · water system reset to nominal");
    }
}
export function isWaterTelemetry(topic: string) {
    return [
        "sensor/farm/dam",
        "sensor/farm/header-tank",
        "sensor/farm/transfer-flow",
        "sensor/farm/shed-tank",
        "sensor/farm/house-tank",
        "sensor/farm/energy/battery",
    ].includes(topic);
}
export function projectWaterTelemetry(topic: string): WaterSnapshot {
    const pump = byTopic("switch/farm/dam-pump/state");
    const flow = byTopic("sensor/farm/transfer-flow");
    const header = byTopic("sensor/farm/header-tank");
    const source = byTopic("sensor/farm/dam");
    const battery = byTopic("sensor/farm/energy/battery");
    const office = byTopic("sensor/farm/shed-tank");
    const house = byTopic("sensor/farm/house-tank");
    // The two header-feed valves report their own position. Read opportunistically:
    // byTopic() returns each device's last published state regardless of which topic
    // woke this automation, and the valve topics are not in isWaterTelemetry() — a
    // valve moving does not trigger a policy pass, it is only drawn.
    const officeValve = byTopic("switch/farm/shed-fill/state");
    const houseValve = byTopic("switch/farm/house-fill/state");
    const snapshot: WaterSnapshot = {
        sourcePct: Number(source && source.state && source.state.value),
        headerPct: Number(header && header.state && header.state.value),
        soc: Number(battery && battery.state && battery.state.soc),
        pumpOn: Boolean(pump && pump.state && pump.state.on),
        officePct: Number(office && office.state && office.state.value),
        housePct: Number(house && house.state && house.state.value),
        flowLpm: Number(flow && flow.state && flow.state.litresPerMinute),
        flowTotal: Number(flow && flow.state && flow.state.totalLitres),
        physicalBatchActive: Boolean(flow && flow.state && flow.state.batchActive),
        officeValveOn: Boolean(officeValve && officeValve.state && officeValve.state.on),
        houseValveOn: Boolean(houseValve && houseValve.state && houseValve.state.on),
    };
    if (!isNaN(snapshot.sourcePct))
        state.set("sourcePct", snapshot.sourcePct);
    if (!isNaN(snapshot.headerPct))
        state.set("headerPct", snapshot.headerPct);
    if (!isNaN(snapshot.officePct))
        state.set("officePct", snapshot.officePct);
    if (!isNaN(snapshot.housePct))
        state.set("housePct", snapshot.housePct);
    if (!isNaN(snapshot.flowLpm))
        state.set("flowLpm", snapshot.flowLpm);
    if (!isNaN(snapshot.flowTotal))
        state.set("flowTotalLitres", snapshot.flowTotal);
    state.set("pumpOn", snapshot.pumpOn);
    // The valve controller's own position. Corroboration, not proof: that a valve
    // says it is open is a different fact from water having arrived, and the refill
    // command already proves the second one against the receiving tank's level.
    state.set("officeValveOn", snapshot.officeValveOn);
    state.set("houseValveOn", snapshot.houseValveOn);
    if (!isNaN(snapshot.soc))
        state.set("batterySoc", snapshot.soc);
    state.set("energyAllowed", !battery || (battery.state && battery.state.available !== false && (isNaN(snapshot.soc) || snapshot.soc >= 30)));
    const pending = String(state.get("demoScenarioPending") || "");
    if (pending === "header-drawdown" && topic === "sensor/farm/header-tank" && !isNaN(snapshot.headerPct) && snapshot.headerPct <= 30) {
        state.set("demoScenarioPending", "");
    }
    else if (pending === "morning-demand"
        && ((topic === "sensor/farm/house-tank" && !isNaN(snapshot.housePct) && snapshot.housePct <= 50)
            || (topic === "sensor/farm/shed-tank" && !isNaN(snapshot.officePct) && snapshot.officePct <= 60))) {
        state.set("demoScenarioPending", "");
    }
    return snapshot;
}

// Tank history is recorded by the separate scheduled Water History automation.
// Sampling opportunistically from telemetry made history density a function of
// how often the tanks published, and tied the sampling interval to the publish
// interval; both are retention decisions that do not belong in this control loop.

export async function reconcileBatchTransfer(snapshot: WaterSnapshot) {
    const transferActive = Boolean(state.get("transferActive"));
    const target = Math.max(0, Number(state.get("transferTargetLitres")) || 0);
    const start = Math.max(0, Number(state.get("transferStartTotalLitres")) || 0);
    if (!transferActive || isNaN(snapshot.flowTotal))
        return snapshot.pumpOn;
    const progress = Math.max(0, snapshot.flowTotal - start);
    state.set("transferProgressLitres", progress);
    if (progress >= target - 1 && snapshot.pumpOn && !Boolean(state.get("transferStopping"))) {
        setAction("Batch target reached · stopping transfer at " + Math.round(progress) + " L");
        await stopPump("batch volume reached");
        return false;
    }
    if (!snapshot.physicalBatchActive && !snapshot.pumpOn && !isNaN(snapshot.flowLpm) && snapshot.flowLpm === 0 && progress > 0) {
        state.set("lastTransferLitres", progress);
        state.set("transferActive", false);
        state.set("transferMode", "idle");
        state.set("transferTargetLitres", 0);
        setAction("Transfer ended at device · " + Math.round(progress) + " L observed");
    }
    return snapshot.pumpOn;
}
export function publishSourceReserve(snapshot: WaterSnapshot) {
    const sourceLow = Boolean(state.get("sourceLowActive"));
    if (!isNaN(snapshot.sourcePct) && snapshot.sourcePct <= 10 && !sourceLow) {
        state.set("sourceLowActive", true);
        setAction("Source water reserve low");
        events.emit("farm/water/source-low", { sourcePct: snapshot.sourcePct });
    }
    else if (!isNaN(snapshot.sourcePct) && snapshot.sourcePct > 12 && sourceLow) {
        state.set("sourceLowActive", false);
    }
}
export async function reconcileWaterPolicy(snapshot: WaterSnapshot, pumpOn: boolean) {
    await reconcileDownstream();
    const header = byTopic("sensor/farm/header-tank");
    const headerPct = Number(header && header.state && header.state.value);
    if (!isNaN(headerPct))
        state.set("headerPct", headerPct);
    const recoveryHeld = Date.now() < (Number(state.get("recoveryHoldUntil")) || 0);
    const headerLow = Boolean(state.get("headerLowActive"));
    if (!isNaN(headerPct) && headerPct <= 30 && !headerLow && !recoveryHeld
        && !Boolean(state.get("distributionActive")) && !Boolean(state.get("transferActive")) && !pumpOn) {
        state.set("headerLowActive", true);
        const targetLitres = Math.max(500, Math.round((72 - headerPct) * 50));
        setAction("Header reserve low · automatic recovery requested");
        events.emit("farm/water/header-low", { headerPct, sourcePct: snapshot.sourcePct });
        await startTransfer(targetLitres, "automatic-header-recovery");
    }
    else if (!isNaN(headerPct) && headerPct > 35 && headerLow) {
        state.set("headerLowActive", false);
    }
    const mode = String(state.get("transferMode") || "idle");
    if (mode === "automatic" && !isNaN(headerPct) && headerPct >= 70 && pumpOn && !Boolean(state.get("transferStopping"))) {
        setAction("Header recovery target reached · stopping transfer");
        await stopPump("header recovery target reached");
        pumpOn = false;
    }
    else if (!isNaN(headerPct) && headerPct >= 95 && pumpOn && !Boolean(state.get("transferStopping"))) {
        setAction("Header high-level safety stop");
        await stopPump("header high-level safety");
        pumpOn = false;
    }
    const battery = byTopic("sensor/farm/energy/battery");
    const energyAllowed = !battery || battery.state.available !== false;
    if (pumpOn && (!energyAllowed || (!isNaN(snapshot.soc) && snapshot.soc < 30)) && !Boolean(state.get("transferStopping"))) {
        setAction("Energy reserve low · stopping discretionary pump load");
        await stopPump("energy reserve protection");
    }
}
