import { byTopic, setAction } from "./runtime";

export async function stopPump(reason: string) {
  if (Boolean(state.get("transferStopping"))) return;
  const pump = byTopic("switch/farm/dam-pump/state");
  const flow = byTopic("sensor/farm/transfer-flow");
  if (!pump || !flow) {
    setAction("Pump stop blocked: pump or flow sensor unavailable");
    return;
  }

  state.set("transferStopping", true);
  const result = await devices.action(
    pump.id,
    "command",
    { payload: { on: false } },
    {
      tier: "observed",
      deviceId: flow.id,
      condition: { field: "litresPerMinute", op: "eq", value: 0 },
      timeoutMs: 5000,
    },
  );
  state.set("transferStopping", false);

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
  } else {
    setAction("Pump stop not verified: " + String(result.error || result.lifecycleState || "unknown"));
    events.emit("farm/water/transfer-failed", {
      stage: "stop",
      reason: result.error || "not verified",
      lifecycleState: result.lifecycleState,
    });
  }
}

export async function startTransfer(requestedLitres: number, source: string) {
  const pump = byTopic("switch/farm/dam-pump/state");
  const flow = byTopic("sensor/farm/transfer-flow");
  const header = byTopic("sensor/farm/header-tank");
  const dam = byTopic("sensor/farm/dam");
  const battery = byTopic("sensor/farm/energy/battery");
  if (!pump || !flow || !header || !dam) {
    setAction("Transfer blocked: water hardware unavailable");
    return;
  }

  const damPct = Number(dam.state && dam.state.value);
  const headerPct = Number(header.state && header.state.value);
  const soc = Number(battery && battery.state && battery.state.soc);
  const energyAllowed = !battery || battery.state.available !== false;

  if (!isNaN(damPct) && damPct <= 10) {
    setAction("Transfer blocked: source reserve low");
    events.emit("farm/water/transfer-blocked", { reason: "source reserve low", damPct });
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
  const damLitres = Math.max(0, Number(dam.state && dam.state.litres) || (isNaN(damPct) ? 0 : damPct * 600));
  const headerHeadroom = Math.max(0, 5000 - headerLitres);
  const sourceAboveReserve = Math.max(0, damLitres - 6000);
  const litres = Math.floor(Math.min(requested, headerHeadroom, sourceAboveReserve));
  if (litres < 100) {
    setAction("Transfer blocked: insufficient safe source/headroom for a batch");
    return;
  }

  const startTotal = Math.max(0, Number(flow.state && flow.state.totalLitres) || 0);
  state.set("transferActive", true);
  state.set("transferMode", source === "automatic-header-recovery" ? "automatic" : "manual");
  state.set("transferTargetLitres", litres);
  state.set("transferStartTotalLitres", startTotal);
  state.set("transferProgressLitres", 0);
  setAction((source === "automatic-header-recovery" ? "Automatic recovery" : "Operator batch") + " · requesting " + litres + " L from lower dam");

  const result = await devices.action(
    pump.id,
    "command",
    { payload: { on: true, litres } },
    {
      tier: "observed",
      deviceId: flow.id,
      condition: { field: "litresPerMinute", op: "gt", value: 0 },
      timeoutMs: 5000,
    },
  );

  if (result.success) {
    setAction((source === "automatic-header-recovery" ? "Automatic recovery" : litres + " L batch") + " running · flow verified");
    events.emit("farm/water/transfer-started", { litres, source: source || "automation", lifecycleState: result.lifecycleState });
  } else {
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
