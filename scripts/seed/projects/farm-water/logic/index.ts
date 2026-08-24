// farm-water — Automation Project logic
// The compiler wraps this module in Aeolus' execution/completion machinery.

export default async function run(context: EventContext) {
      var topic = String(context.topic || "");
      var evt = topic.split("/").pop();

      function byTopic(wanted) {
        return devices.list().find(function(d) { return d.topic === wanted; });
      }
      function setAction(label) {
        state.set("lastAction", { label: label, at: Date.now() });
      }
      function init(key, value) {
        if (state.get(key) === undefined) state.set(key, value);
      }

      init("distributionActive", false);
      init("houseRefillActive", false);
      init("shedRefillActive", false);
      init("transferActive", false);
      init("transferStopping", false);
      init("transferMode", "idle");
      init("transferTargetLitres", 0);
      init("transferProgressLitres", 0);
      init("flowTotalLitres", 0);
      init("demoScenarioPending", "");
      init("energyAllowed", true);

      async function stopPump(reason) {
        if (Boolean(state.get("transferStopping"))) return;
        var pump = byTopic("switch/farm/dam-pump/state");
        var flow = byTopic("sensor/farm/transfer-flow");
        if (!pump || !flow) {
          setAction("Pump stop blocked: pump or flow sensor unavailable");
          return;
        }
        state.set("transferStopping", true);
        var result = await devices.action(
          pump.id,
          "command",
          { payload: { on: false } },
          {
            tier: "observed",
            deviceId: flow.id,
            condition: { field: "litresPerMinute", op: "eq", value: 0 },
            timeoutMs: 5000,
          }
        );
        state.set("transferStopping", false);
        if (result.success) {
          var delivered = Math.max(0, Number(state.get("transferProgressLitres")) || 0);
          state.set("lastTransferLitres", delivered);
          state.set("transferActive", false);
          state.set("transferMode", "idle");
          state.set("transferTargetLitres", 0);
          setAction("Transfer stopped · zero flow observed");
          events.emit("farm/water/transfer-stopped", { reason: reason, deliveredLitres: delivered, lifecycleState: result.lifecycleState });
        } else {
          setAction("Pump stop not verified: " + String(result.error || result.lifecycleState || "unknown"));
          events.emit("farm/water/transfer-failed", { stage: "stop", reason: result.error || "not verified", lifecycleState: result.lifecycleState });
        }
      }

      async function startTransfer(requestedLitres, source) {
        var pump = byTopic("switch/farm/dam-pump/state");
        var flow = byTopic("sensor/farm/transfer-flow");
        var header = byTopic("sensor/farm/header-tank");
        var dam = byTopic("sensor/farm/dam");
        var battery = byTopic("sensor/farm/energy/battery");
        if (!pump || !flow || !header || !dam) {
          setAction("Transfer blocked: water hardware unavailable");
          return;
        }

        var damPct = Number(dam.state && dam.state.value);
        var headerPct = Number(header.state && header.state.value);
        var soc = Number(battery && battery.state && battery.state.soc);
        var energyAllowed = !battery || battery.state.available !== false;

        if (!isNaN(damPct) && damPct <= 10) {
          setAction("Transfer blocked: source reserve low");
          events.emit("farm/water/transfer-blocked", { reason: "source reserve low", damPct: damPct });
          return;
        }
        if (!energyAllowed || (!isNaN(soc) && soc < 30)) {
          setAction("Transfer blocked: site energy reserve low");
          events.emit("farm/water/transfer-blocked", { reason: "site energy reserve low", soc: soc });
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

        var requested = Math.max(100, Math.min(3000, Number(requestedLitres) || 500));
        var headerLitres = Math.max(0, Number(header.state && header.state.litres) || (isNaN(headerPct) ? 0 : headerPct * 50));
        var damLitres = Math.max(0, Number(dam.state && dam.state.litres) || (isNaN(damPct) ? 0 : damPct * 600));
        var headerHeadroom = Math.max(0, 5000 - headerLitres);
        var sourceAboveReserve = Math.max(0, damLitres - 6000);
        var litres = Math.floor(Math.min(requested, headerHeadroom, sourceAboveReserve));
        if (litres < 100) {
          setAction("Transfer blocked: insufficient safe source/headroom for a batch");
          return;
        }
        var startTotal = Math.max(0, Number(flow.state && flow.state.totalLitres) || 0);
        state.set("transferActive", true);
        state.set("transferMode", source === "automatic-header-recovery" ? "automatic" : "manual");
        state.set("transferTargetLitres", litres);
        state.set("transferStartTotalLitres", startTotal);
        state.set("transferProgressLitres", 0);
        setAction((source === "automatic-header-recovery" ? "Automatic recovery" : "Operator batch") + " · requesting " + litres + " L from lower dam");

        var result = await devices.action(
          pump.id,
          "command",
          { payload: { on: true, litres: litres } },
          {
            tier: "observed",
            deviceId: flow.id,
            condition: { field: "litresPerMinute", op: "gt", value: 0 },
            timeoutMs: 5000,
          }
        );
        if (result.success) {
          setAction((source === "automatic-header-recovery" ? "Automatic recovery" : litres + " L batch") + " running · flow verified");
          events.emit("farm/water/transfer-started", { litres: litres, source: source || "automation", lifecycleState: result.lifecycleState });
        } else {
          state.set("transferActive", false);
          state.set("transferMode", "idle");
          state.set("transferTargetLitres", 0);
          setAction("Transfer not verified: " + String(result.error || result.lifecycleState || "unknown"));
          events.emit("farm/water/transfer-failed", { stage: "start", reason: result.error || "not verified", lifecycleState: result.lifecycleState });
        }
      }

      async function refillZone(zone, tankTopic, valveTopic, targetPct) {
        var tank = byTopic(tankTopic);
        var valve = byTopic(valveTopic);
        if (!tank || !valve) return false;
        var current = Number(tank.state && tank.state.value);
        if (!isNaN(current) && current >= targetPct) return true;

        var key = zone === "house" ? "houseRefillActive" : "shedRefillActive";
        state.set(key, true);
        setAction((zone === "house" ? "House" : "Shed") + " tank low · opening header feed");
        var result = await devices.action(
          valve.id,
          "command",
          { payload: { on: true, targetPct: targetPct } },
          {
            tier: "observed",
            deviceId: tank.id,
            condition: { field: "value", op: "gte", value: targetPct - 0.5 },
            timeoutMs: 5000,
          }
        );
        state.set(key, false);
        if (result.success) {
          setAction((zone === "house" ? "House" : "Shed") + " tank recovered from header storage");
          events.emit("farm/water/downstream-refill-verified", { zone: zone, targetPct: targetPct, lifecycleState: result.lifecycleState });
          return true;
        }
        setAction((zone === "house" ? "House" : "Shed") + " refill not verified: " + String(result.error || result.lifecycleState || "unknown"));
        events.emit("farm/water/downstream-refill-failed", { zone: zone, lifecycleState: result.lifecycleState });
        return false;
      }

      async function reconcileDownstream() {
        if (Boolean(state.get("distributionActive"))) return;
        var header = byTopic("sensor/farm/header-tank");
        var house = byTopic("sensor/farm/house-tank");
        var shed = byTopic("sensor/farm/shed-tank");
        var headerPct = Number(header && header.state && header.state.value);
        var housePct = Number(house && house.state && house.state.value);
        var shedPct = Number(shed && shed.state && shed.state.value);
        var needHouse = !isNaN(housePct) && housePct < 55;
        var needShed = !isNaN(shedPct) && shedPct < 65;
        if ((!needHouse && !needShed) || (!isNaN(headerPct) && headerPct <= 20)) return;

        state.set("distributionActive", true);
        try {
          if (needHouse) await refillZone("house", "sensor/farm/house-tank", "switch/farm/house-fill/state", 75);
          if (needShed) await refillZone("shed", "sensor/farm/shed-tank", "switch/farm/shed-fill/state", 75);
        } finally {
          state.set("distributionActive", false);
        }
      }

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

      if (topic !== "sensor/farm/dam" &&
          topic !== "sensor/farm/header-tank" &&
          topic !== "sensor/farm/transfer-flow" &&
          topic !== "sensor/farm/shed-tank" &&
          topic !== "sensor/farm/house-tank" &&
          topic !== "sensor/farm/energy/battery") return;

      var pump = byTopic("switch/farm/dam-pump/state");
      var flow = byTopic("sensor/farm/transfer-flow");
      var header = byTopic("sensor/farm/header-tank");
      var dam = byTopic("sensor/farm/dam");
      var battery = byTopic("sensor/farm/energy/battery");
      var shed = byTopic("sensor/farm/shed-tank");
      var house = byTopic("sensor/farm/house-tank");

      var damPct = Number(dam && dam.state && dam.state.value);
      var headerPct = Number(header && header.state && header.state.value);
      var soc = Number(battery && battery.state && battery.state.soc);
      var pumpOn = Boolean(pump && pump.state && pump.state.on);
      var shedPct = Number(shed && shed.state && shed.state.value);
      var housePct = Number(house && house.state && house.state.value);
      var flowLpm = Number(flow && flow.state && flow.state.litresPerMinute);
      var flowTotal = Number(flow && flow.state && flow.state.totalLitres);
      var physicalBatchActive = Boolean(flow && flow.state && flow.state.batchActive);

      if (!isNaN(damPct)) state.set("damPct", damPct);
      if (!isNaN(headerPct)) state.set("headerPct", headerPct);
      if (!isNaN(shedPct)) state.set("shedPct", shedPct);
      if (!isNaN(housePct)) state.set("housePct", housePct);
      if (!isNaN(flowLpm)) state.set("flowLpm", flowLpm);
      if (!isNaN(flowTotal)) state.set("flowTotalLitres", flowTotal);
      state.set("pumpOn", pumpOn);
      if (!isNaN(soc)) state.set("batterySoc", soc);
      state.set("energyAllowed", !battery || (battery.state && battery.state.available !== false && (isNaN(soc) || soc >= 30)));

      var pendingScenario = String(state.get("demoScenarioPending") || "");
      if (pendingScenario === "header-drawdown" && topic === "sensor/farm/header-tank" && !isNaN(headerPct) && headerPct <= 30) {
        state.set("demoScenarioPending", "");
      } else if (pendingScenario === "morning-demand" &&
                 ((topic === "sensor/farm/house-tank" && !isNaN(housePct) && housePct <= 50) ||
                  (topic === "sensor/farm/shed-tank" && !isNaN(shedPct) && shedPct <= 60))) {
        state.set("demoScenarioPending", "");
      }

      var transferActive = Boolean(state.get("transferActive"));
      var transferTarget = Math.max(0, Number(state.get("transferTargetLitres")) || 0);
      var transferStart = Math.max(0, Number(state.get("transferStartTotalLitres")) || 0);
      if (transferActive && !isNaN(flowTotal)) {
        var progress = Math.max(0, flowTotal - transferStart);
        state.set("transferProgressLitres", progress);
        if (progress >= transferTarget - 1 && pumpOn && !Boolean(state.get("transferStopping"))) {
          state.set("transferActive", false);
          setAction("Batch target reached · stopping transfer at " + Math.round(progress) + " L");
          await stopPump("batch volume reached");
          pumpOn = false;
        } else if (!physicalBatchActive && !pumpOn && !isNaN(flowLpm) && flowLpm === 0 && progress > 0) {
          // Reconcile a device-side failsafe stop rather than leaving the UI in
          // an impossible forever-running batch state.
          state.set("lastTransferLitres", progress);
          state.set("transferActive", false);
          state.set("transferMode", "idle");
          state.set("transferTargetLitres", 0);
          setAction("Transfer ended at device · " + Math.round(progress) + " L observed");
        }
      }

      var sourceLowActive = Boolean(state.get("sourceLowActive"));
      if (!isNaN(damPct) && damPct <= 10 && !sourceLowActive) {
        state.set("sourceLowActive", true);
        setAction("Source water reserve low");
        events.emit("farm/water/source-low", { damPct: damPct });
      } else if (!isNaN(damPct) && damPct > 12 && sourceLowActive) {
        state.set("sourceLowActive", false);
      }

      await reconcileDownstream();
      header = byTopic("sensor/farm/header-tank");
      headerPct = Number(header && header.state && header.state.value);
      if (!isNaN(headerPct)) state.set("headerPct", headerPct);

      var recoveryHeld = Date.now() < (Number(state.get("recoveryHoldUntil")) || 0);
      var headerLowActive = Boolean(state.get("headerLowActive"));
      if (!isNaN(headerPct) && headerPct <= 30 && !headerLowActive && !recoveryHeld && !Boolean(state.get("distributionActive")) && !Boolean(state.get("transferActive")) && !pumpOn) {
        state.set("headerLowActive", true);
        var targetLitres = Math.max(500, Math.round((72 - headerPct) * 50));
        setAction("Header reserve low · automatic recovery requested");
        events.emit("farm/water/header-low", { headerPct: headerPct, damPct: damPct });
        await startTransfer(targetLitres, "automatic-header-recovery");
      } else if (!isNaN(headerPct) && headerPct > 35 && headerLowActive) {
        state.set("headerLowActive", false);
      }

      var mode = String(state.get("transferMode") || "idle");
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

      var energyAllowed = !battery || battery.state.available !== false;
      if (pumpOn && (!energyAllowed || (!isNaN(soc) && soc < 30)) && !Boolean(state.get("transferStopping"))) {
        state.set("transferActive", false);
        setAction("Energy reserve low · stopping discretionary pump load");
        await stopPump("energy reserve protection");
      }
}
