const monitorLogic = `automation({
  actions: [
    function waterMonitor(context) {
      var topic = String(context.topic || "");
      if (topic !== "sensor/farm/dam" &&
          topic !== "sensor/farm/header-tank" &&
          topic !== "sensor/farm/transfer-flow" &&
          topic !== "switch/farm/dam-pump/state") return;

      function byTopic(wanted) {
        return devices.list().find(function(d) { return d.topic === wanted; });
      }

      var dam = byTopic("sensor/farm/dam");
      var header = byTopic("sensor/farm/header-tank");
      var flow = byTopic("sensor/farm/transfer-flow");
      var pump = byTopic("switch/farm/dam-pump/state");

      var damPct = Number(dam && dam.state && dam.state.value);
      var headerPct = Number(header && header.state && header.state.value);
      var flowLpm = Number(flow && flow.state && flow.state.litresPerMinute);
      var pumpOn = Boolean(pump && pump.state && pump.state.on);

      var sourceLowActive = Boolean(state.get("sourceLowActive"));
      if (!isNaN(damPct) && damPct <= 10 && !sourceLowActive) {
        state.set("sourceLowActive", true);
        events.emit("farm/water/source-low", { damPct: damPct });
      } else if (!isNaN(damPct) && damPct > 12 && sourceLowActive) {
        state.set("sourceLowActive", false);
      }

      // Edge-trigger the low/satisfied events so a flow update while the header
      // is still low cannot accidentally queue a second pump command.
      var headerLowActive = Boolean(state.get("headerLowActive"));
      if (!isNaN(headerPct) && headerPct <= 30 && !headerLowActive) {
        state.set("headerLowActive", true);
        state.set("headerSatisfiedActive", false);
        events.emit("farm/water/header-low", { headerPct: headerPct, damPct: damPct });
      } else if (!isNaN(headerPct) && headerPct > 35 && headerLowActive) {
        state.set("headerLowActive", false);
      }

      var satisfiedActive = Boolean(state.get("headerSatisfiedActive"));
      if (!isNaN(headerPct) && headerPct >= 70 && pumpOn && !satisfiedActive) {
        state.set("headerSatisfiedActive", true);
        events.emit("farm/water/header-satisfied", { headerPct: headerPct, flowLpm: flowLpm });
      } else if ((!pumpOn || (!isNaN(headerPct) && headerPct < 65)) && satisfiedActive) {
        state.set("headerSatisfiedActive", false);
      }
    },
  ],
});`;

const controllerLogic = `automation({
  actions: [
    async function waterController(context) {
      var topic = String(context.topic || "");
      var payload = context.state || {};

      function byTopic(wanted) {
        return devices.list().find(function(d) { return d.topic === wanted; });
      }

      var pump = byTopic("switch/farm/dam-pump/state");
      var flow = byTopic("sensor/farm/transfer-flow");
      var header = byTopic("sensor/farm/header-tank");
      var dam = byTopic("sensor/farm/dam");
      var battery = byTopic("sensor/farm/energy/battery");

      async function stopPump(reason) {
        if (!pump || !flow) {
          events.emit("farm/water/transfer-blocked", { reason: "pump or flow sensor unavailable" });
          return;
        }
        var result = await devices.action(
          pump.id,
          "set",
          { on: false },
          {
            tier: "observed",
            deviceId: flow.id,
            condition: function(s) { return Number(s.litresPerMinute) === 0; },
            timeoutMs: 5000,
          }
        );
        if (result.success) {
          events.emit("farm/water/transfer-stopped", { reason: reason, lifecycleState: result.lifecycleState });
        } else {
          events.emit("farm/water/transfer-blocked", { reason: result.error || "pump stop could not be verified", lifecycleState: result.lifecycleState });
        }
      }

      async function startTransfer(requestedLitres, source) {
        if (!pump || !flow || !header || !dam) {
          events.emit("farm/water/transfer-blocked", { reason: "water hardware unavailable" });
          return;
        }

        var damPct = Number(dam.state && dam.state.value);
        var headerPct = Number(header.state && header.state.value);
        var soc = Number(battery && battery.state && battery.state.soc);
        var energyAllowed = !battery || battery.state.available !== false;

        if (!isNaN(damPct) && damPct <= 10) {
          events.emit("farm/water/transfer-blocked", { reason: "source reserve low", damPct: damPct });
          return;
        }
        if (!energyAllowed || (!isNaN(soc) && soc < 30)) {
          events.emit("farm/water/transfer-blocked", { reason: "site energy reserve low", soc: soc });
          return;
        }
        if (!isNaN(headerPct) && headerPct >= 95) {
          events.emit("farm/water/transfer-blocked", { reason: "header tank already full", headerPct: headerPct });
          return;
        }

        var litres = Math.max(100, Math.min(3000, Number(requestedLitres) || 500));
        var result = await devices.action(
          pump.id,
          "set",
          { on: true, litres: litres },
          {
            tier: "observed",
            deviceId: flow.id,
            condition: function(s) { return Number(s.litresPerMinute) > 0; },
            timeoutMs: 5000,
          }
        );
        if (result.success) {
          events.emit("farm/water/transfer-started", {
            litres: litres,
            source: source || "automation",
            flowLpm: Number(flow.state && flow.state.litresPerMinute) || 120,
            lifecycleState: result.lifecycleState,
          });
        } else {
          events.emit("farm/water/transfer-blocked", {
            reason: result.error || "pump command not verified",
            lifecycleState: result.lifecycleState,
          });
        }
      }

      if (topic.indexOf("/farm/water/transfer-request") >= 0) {
        await startTransfer(payload.litres, payload.source || "operator");
      } else if (topic.indexOf("/farm/water/header-low") >= 0) {
        var headerPct = Number(payload.headerPct);
        var targetLitres = isNaN(headerPct) ? 2000 : Math.max(500, Math.round((75 - headerPct) * 50));
        await startTransfer(targetLitres, "automatic-header-recovery");
      } else if (topic.indexOf("/farm/water/stop-request") >= 0) {
        await stopPump("operator");
      } else if (topic.indexOf("/farm/water/header-satisfied") >= 0) {
        await stopPump("header target reached");
      } else if (topic.indexOf("/farm/energy/permission") >= 0 && payload.allowed === false) {
        if (pump && pump.state && pump.state.on) await stopPump("energy reserve protection");
      }
    },
  ],
});`;

export const waterAutomations = [
  {
    key: "farm-water-monitor",
    name: "Farm Water Management · Monitor",
    triggerTopic: "sensor/farm/#",
    scriptSource: monitorLogic,
  },
  {
    key: "farm-water-controller",
    name: "Farm Water Management · Control",
    triggerTopic: "aeolus/events/+/farm/#",
    scriptSource: controllerLogic,
  },
];
