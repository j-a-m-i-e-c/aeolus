// farm-water — Automation Project logic
// Larger behaviour is split by responsibility; the entry file stays readable.

import { reconcileDownstream } from "./distribution";
import { byTopic, initialiseWaterState, setAction } from "./runtime";
import { startTransfer, stopPump } from "./transfer";

export default async function run(context: EventContext) {
  const topic = String(context.topic || "");
  const evt = topic.split("/").pop();

  initialiseWaterState();

  if (topic.indexOf("ui/") === 0) {
    if (evt === "transfer-500") await startTransfer(500, "operator");
    else if (evt === "transfer-1000") await startTransfer(1000, "operator");
    else if (evt === "pump-stop") await stopPump("operator");
    else if (evt === "simulate-header-low") {
      if (String(state.get("demoScenarioPending") || "")) return;
      state.set("demoScenarioPending", "header-drawdown");
      state.set("recoveryHoldUntil", Date.now() + 4000);
      events.emit("farm/sim/header-low", {});
      setAction("DEMO · injecting header-tank drawdown");
    } else if (evt === "simulate-property-demand") {
      if (String(state.get("demoScenarioPending") || "")) return;
      state.set("demoScenarioPending", "morning-demand");
      events.emit("farm/sim/property-water-demand", {});
      setAction("DEMO · injecting morning house + shed demand");
    } else if (evt === "reset-water") {
      events.emit("farm/sim/water-reset", {});
      state.set("recoveryHoldUntil", 0);
      state.set("distributionActive", false);
      state.set("houseRefillActive", false);
      state.set("shedRefillActive", false);
      state.set("transferActive", false);
      state.set("transferStopping", false);
      state.set("transferMode", "idle");
      state.set("transferTargetLitres", 0);
      state.set("transferProgressLitres", 0);
      state.set("demoScenarioPending", "");
      setAction("DEMO · water system reset to nominal");
    }
    return;
  }

  if (
    topic !== "sensor/farm/dam" &&
    topic !== "sensor/farm/header-tank" &&
    topic !== "sensor/farm/transfer-flow" &&
    topic !== "sensor/farm/shed-tank" &&
    topic !== "sensor/farm/house-tank" &&
    topic !== "sensor/farm/energy/battery"
  ) return;

  let pump = byTopic("switch/farm/dam-pump/state");
  const flow = byTopic("sensor/farm/transfer-flow");
  let header = byTopic("sensor/farm/header-tank");
  const dam = byTopic("sensor/farm/dam");
  const battery = byTopic("sensor/farm/energy/battery");
  const shed = byTopic("sensor/farm/shed-tank");
  const house = byTopic("sensor/farm/house-tank");

  const damPct = Number(dam && dam.state && dam.state.value);
  let headerPct = Number(header && header.state && header.state.value);
  const soc = Number(battery && battery.state && battery.state.soc);
  let pumpOn = Boolean(pump && pump.state && pump.state.on);
  const shedPct = Number(shed && shed.state && shed.state.value);
  const housePct = Number(house && house.state && house.state.value);
  const flowLpm = Number(flow && flow.state && flow.state.litresPerMinute);
  const flowTotal = Number(flow && flow.state && flow.state.totalLitres);
  const physicalBatchActive = Boolean(flow && flow.state && flow.state.batchActive);

  if (!isNaN(damPct)) state.set("damPct", damPct);
  if (!isNaN(headerPct)) state.set("headerPct", headerPct);
  if (!isNaN(shedPct)) state.set("shedPct", shedPct);
  if (!isNaN(housePct)) state.set("housePct", housePct);
  if (!isNaN(flowLpm)) state.set("flowLpm", flowLpm);
  if (!isNaN(flowTotal)) state.set("flowTotalLitres", flowTotal);
  state.set("pumpOn", pumpOn);
  if (!isNaN(soc)) state.set("batterySoc", soc);
  state.set("energyAllowed", !battery || (battery.state && battery.state.available !== false && (isNaN(soc) || soc >= 30)));

  const pendingScenario = String(state.get("demoScenarioPending") || "");
  if (pendingScenario === "header-drawdown" && topic === "sensor/farm/header-tank" && !isNaN(headerPct) && headerPct <= 30) {
    state.set("demoScenarioPending", "");
  } else if (
    pendingScenario === "morning-demand" &&
    ((topic === "sensor/farm/house-tank" && !isNaN(housePct) && housePct <= 50) ||
      (topic === "sensor/farm/shed-tank" && !isNaN(shedPct) && shedPct <= 60))
  ) {
    state.set("demoScenarioPending", "");
  }

  const transferActive = Boolean(state.get("transferActive"));
  const transferTarget = Math.max(0, Number(state.get("transferTargetLitres")) || 0);
  const transferStart = Math.max(0, Number(state.get("transferStartTotalLitres")) || 0);
  if (transferActive && !isNaN(flowTotal)) {
    const progress = Math.max(0, flowTotal - transferStart);
    state.set("transferProgressLitres", progress);
    if (progress >= transferTarget - 1 && pumpOn && !Boolean(state.get("transferStopping"))) {
      state.set("transferActive", false);
      setAction("Batch target reached · stopping transfer at " + Math.round(progress) + " L");
      await stopPump("batch volume reached");
      pumpOn = false;
    } else if (!physicalBatchActive && !pumpOn && !isNaN(flowLpm) && flowLpm === 0 && progress > 0) {
      // Reconcile a device-side failsafe stop rather than leaving the UI in an
      // impossible forever-running batch state.
      state.set("lastTransferLitres", progress);
      state.set("transferActive", false);
      state.set("transferMode", "idle");
      state.set("transferTargetLitres", 0);
      setAction("Transfer ended at device · " + Math.round(progress) + " L observed");
    }
  }

  const sourceLowActive = Boolean(state.get("sourceLowActive"));
  if (!isNaN(damPct) && damPct <= 10 && !sourceLowActive) {
    state.set("sourceLowActive", true);
    setAction("Source water reserve low");
    events.emit("farm/water/source-low", { damPct });
  } else if (!isNaN(damPct) && damPct > 12 && sourceLowActive) {
    state.set("sourceLowActive", false);
  }

  await reconcileDownstream();
  header = byTopic("sensor/farm/header-tank");
  headerPct = Number(header && header.state && header.state.value);
  if (!isNaN(headerPct)) state.set("headerPct", headerPct);

  const recoveryHeld = Date.now() < (Number(state.get("recoveryHoldUntil")) || 0);
  const headerLowActive = Boolean(state.get("headerLowActive"));
  if (
    !isNaN(headerPct) && headerPct <= 30 && !headerLowActive && !recoveryHeld &&
    !Boolean(state.get("distributionActive")) && !Boolean(state.get("transferActive")) && !pumpOn
  ) {
    state.set("headerLowActive", true);
    const targetLitres = Math.max(500, Math.round((72 - headerPct) * 50));
    setAction("Header reserve low · automatic recovery requested");
    events.emit("farm/water/header-low", { headerPct, damPct });
    await startTransfer(targetLitres, "automatic-header-recovery");
  } else if (!isNaN(headerPct) && headerPct > 35 && headerLowActive) {
    state.set("headerLowActive", false);
  }

  const mode = String(state.get("transferMode") || "idle");
  if (mode === "automatic" && !isNaN(headerPct) && headerPct >= 70 && pumpOn && !Boolean(state.get("transferStopping"))) {
    state.set("transferActive", false);
    setAction("Header recovery target reached · stopping transfer");
    await stopPump("header recovery target reached");
    pumpOn = false;
  } else if (!isNaN(headerPct) && headerPct >= 95 && pumpOn && !Boolean(state.get("transferStopping"))) {
    state.set("transferActive", false);
    setAction("Header high-level safety stop");
    await stopPump("header high-level safety");
    pumpOn = false;
  }

  const energyAllowed = !battery || battery.state.available !== false;
  if (pumpOn && (!energyAllowed || (!isNaN(soc) && soc < 30)) && !Boolean(state.get("transferStopping"))) {
    state.set("transferActive", false);
    setAction("Energy reserve low · stopping discretionary pump load");
    await stopPump("energy reserve protection");
  }
}
