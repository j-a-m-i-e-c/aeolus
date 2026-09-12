import { byTopic, setAction } from "./runtime";
export async function stopPump(reason: string) {
    if (Boolean(state.get("transferStopping")))
        return;
    const pump = byTopic("switch/farm/dam-pump/state");
    const flow = byTopic("sensor/farm/transfer-flow");
    if (!pump || !flow) {
        setAction("Pump stop blocked: pump or flow sensor unavailable");
        return;
    }
    state.set("transferStopping", true);
    // A stop is proven by an INDEPENDENT flow meter reading zero, never by the pump
    // agreeing it was switched off. A pump that has been told to stop and a pump that
    // has actually stopped moving water are different facts, and only the second one
    // is worth reporting.
    const result = await devices.action(pump.id, "command", { payload: { on: false } }, {
        tier: "observed",
        deviceId: flow.id,
        condition: { field: "litresPerMinute", op: "eq", value: 0 },
        timeoutMs: 5000,
        evidence: {
            intent: "Stop water transfer",
            observedLabel: "flow stopped",
        },
    });
    state.set("transferStopping", false);
    // Keep the proof, not just the verdict: every rung this command reached, with
    // the evidence recorded for it. The pane renders it; nothing is inferred.
    state.set("lastCommand", devices.commandEvidence(result.commandId));
    if (result.success) {
        const delivered = Math.max(0, Number(state.get("transferProgressLitres")) || 0);
        state.set("lastTransferLitres", delivered);
        state.set("transferActive", false);
        state.set("transferMode", "idle");
        state.set("transferTargetLitres", 0);
        setAction("Transfer stopped · zero flow observed");
        events.emit("farm/water/transfer-stopped", {
            reason,
            deliveredLitres: delivered,
            lifecycleState: result.lifecycleState,
        });
    }
    else {
        setAction("Pump stop not verified: " + String(result.error || result.lifecycleState || "unknown"));
        events.emit("farm/water/transfer-failed", {
            stage: "stop",
            reason: result.error || "not verified",
            lifecycleState: result.lifecycleState,
        });
    }
}
// `trigger` is what asked for the transfer — an operator button or the automatic
// header recovery. It used to be called `source`, which collided with the water source
// once that stopped being called the dam; the collision was the name admitting it was
// doing two jobs.
export async function startTransfer(requestedLitres: number, trigger: string) {
    const pump = byTopic("switch/farm/dam-pump/state");
    const flow = byTopic("sensor/farm/transfer-flow");
    const header = byTopic("sensor/farm/header-tank");
    // `sensor/farm/dam` is the shed catchment. The topic is a legacy address kept
    // because it is the device's identity; the name here is the physical thing.
    const source = byTopic("sensor/farm/dam");
    const battery = byTopic("sensor/farm/energy/battery");
    if (!pump || !flow || !header || !source) {
        setAction("Transfer blocked: water hardware unavailable");
        return;
    }
    const sourcePct = Number(source.state && source.state.value);
    const headerPct = Number(header.state && header.state.value);
    const soc = Number(battery && battery.state && battery.state.soc);
    const energyAllowed = !battery || battery.state.available !== false;
    if (!isNaN(sourcePct) && sourcePct <= 10) {
        setAction("Transfer blocked: source reserve low");
        events.emit("farm/water/transfer-blocked", { reason: "source reserve low", sourcePct });
        return;
    }
    if (!energyAllowed || (!isNaN(soc) && soc < 30)) {
        setAction("Transfer blocked: site energy reserve low");
        events.emit("farm/water/transfer-blocked", { reason: "site energy reserve low", soc });
        return;
    }
    if (!isNaN(headerPct) && headerPct >= 95) {
        setAction("Transfer blocked: header tank already full");
        return;
    }
    if ((pump.state && pump.state.on) || Boolean(state.get("transferActive"))) {
        setAction("Transfer pump already running");
        return;
    }
    const requested = Math.max(100, Math.min(3000, Number(requestedLitres) || 500));
    const headerLitres = Math.max(0, Number(header.state && header.state.litres) || (isNaN(headerPct) ? 0 : headerPct * 50));
    const sourceLitres = Math.max(0, Number(source.state && source.state.litres) || (isNaN(sourcePct) ? 0 : sourcePct * 600));
    const headerHeadroom = Math.max(0, 5000 - headerLitres);
    const sourceAboveReserve = Math.max(0, sourceLitres - 6000);
    const litres = Math.floor(Math.min(requested, headerHeadroom, sourceAboveReserve));
    if (litres < 100) {
        setAction("Transfer blocked: insufficient safe source/headroom for a batch");
        return;
    }
    const startTotal = Math.max(0, Number(flow.state && flow.state.totalLitres) || 0);
    state.set("transferActive", true);
    state.set("transferMode", trigger === "automatic-header-recovery" ? "automatic" : "manual");
    state.set("transferTargetLitres", litres);
    state.set("transferStartTotalLitres", startTotal);
    state.set("transferProgressLitres", 0);
    setAction((trigger === "automatic-header-recovery" ? "Automatic recovery" : "Operator batch") + " · requesting " + litres + " L from shed catchment");
    const result = await devices.action(pump.id, "command", { payload: { on: true, litres } }, {
        tier: "observed",
        deviceId: flow.id,
        condition: { field: "litresPerMinute", op: "gt", value: 0 },
        timeoutMs: 5000,
        evidence: {
            // Names the operation the operator actually asked for, so the receipt is
            // legible next to three buttons. "device_action" would not be.
            intent: "Transfer " + litres + " L",
            observedLabel: "flow detected",
        },
    });
    state.set("lastCommand", devices.commandEvidence(result.commandId));
    if (result.success) {
        setAction((trigger === "automatic-header-recovery" ? "Automatic recovery" : litres + " L batch") + " running · flow verified");
        events.emit("farm/water/transfer-started", { litres, source: trigger || "automation", lifecycleState: result.lifecycleState });
    }
    else {
        state.set("transferActive", false);
        state.set("transferMode", "idle");
        state.set("transferTargetLitres", 0);
        setAction("Transfer not verified: " + String(result.error || result.lifecycleState || "unknown"));
        events.emit("farm/water/transfer-failed", {
            stage: "start",
            reason: result.error || "not verified",
            lifecycleState: result.lifecycleState,
        });
    }
}
