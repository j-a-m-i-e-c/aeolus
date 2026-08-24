// farm-livestock — Automation Project logic
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
      if (state.get("demoScenarioPending") === undefined) state.set("demoScenarioPending", "");

      if (topic.indexOf("ui/") === 0) {
        if (evt === "simulate-strays") {
          if (String(state.get("demoScenarioPending") || "")) return;
          state.set("demoScenarioPending", "breach");
          events.emit("farm/sim/livestock-boundary-breach", {});
          setAction("DEMO · injecting east-boundary crossing");
        } else if (evt === "move-herd") {
          if (String(state.get("demoScenarioPending") || "")) return;
          state.set("demoScenarioPending", "move");
          events.emit("farm/sim/livestock-move-herd", {});
          setAction("DEMO · injecting paddock movement");
        } else if (evt === "simulate-fence-fault") {
          if (String(state.get("demoScenarioPending") || "")) return;
          state.set("demoScenarioPending", "fault");
          events.emit("farm/sim/livestock-fence-fault", {});
          setAction("DEMO · injecting perimeter energiser fault");
        } else if (evt === "restore-fence") {
          if (String(state.get("demoScenarioPending") || "")) return;
          state.set("demoScenarioPending", "restore");
          events.emit("farm/sim/livestock-fence-restore", {});
          setAction("DEMO · restoring perimeter energiser");
        } else if (evt === "reset-livestock") {
          events.emit("farm/sim/livestock-reset", {});
          state.set("recallInProgress", false);
          state.set("demoScenarioPending", "");
          setAction("DEMO · livestock system reset to nominal");
        } else if (evt === "recall-strays") {
          var recall = byTopic("switch/fence/recall/state");
          var collars = byTopic("sensor/fence/collars");
          if (!recall || !collars) {
            setAction("Recall blocked: collar or recall hardware unavailable");
            return;
          }
          state.set("recallInProgress", true);
          setAction("Recall dispatched · waiting for collars to return inside boundary");
          var result = await devices.action(
            recall.id,
            "command",
            { payload: { active: true } },
            {
              tier: "observed",
              deviceId: collars.id,
              condition: { field: "strays", op: "eq", value: 0 },
              timeoutMs: 5000,
            }
          );
          state.set("recallInProgress", false);
          if (result.success) {
            setAction("Recall verified · herd contained");
            events.emit("farm/livestock/recall-verified", { lifecycleState: result.lifecycleState });
          } else {
            setAction("Recall not verified: " + String(result.error || result.lifecycleState || "unknown"));
            events.emit("farm/livestock/recall-failed", { reason: result.error || "not observed", lifecycleState: result.lifecycleState });
          }
        }
        return;
      }

      if (topic !== "sensor/fence/collars" && topic !== "sensor/fence/energiser") return;

      if (topic === "sensor/fence/collars") {
        var strays = Math.max(0, Number(context.state && context.state.strays) || 0);
        var herd = Math.max(0, Number(context.state && context.state.herd) || 0);
        var tracked = Math.max(0, Number(context.state && context.state.tracked) || 0);
        var avgBattery = Math.max(0, Math.min(100, Number(context.state && context.state.avgBattery) || 0));
        var paddock = String(context.state && context.state.paddock || "A");
        var breachSector = String(context.state && context.state.breachSector || "");
        var movement = String(context.state && context.state.movement || "grazing");
        state.set("strays", strays);
        state.set("herd", herd);
        state.set("tracked", tracked);
        state.set("avgBattery", avgBattery);
        state.set("paddock", paddock);
        state.set("breachSector", breachSector);
        state.set("movement", movement);
        if (state.get("recallInProgress") === undefined) state.set("recallInProgress", false);
        var pending = String(state.get("demoScenarioPending") || "");
        if ((pending === "breach" && strays > 0) || (pending === "move" && movement === "rotating")) state.set("demoScenarioPending", "");

        var previous = Number(state.get("lastStrays"));
        state.set("lastStrays", strays);
        if (strays > 0 && previous !== strays) {
          setAction(strays + " collars outside the virtual boundary · " + (breachSector || "sector unknown"));
          events.emit("farm/livestock/breach", { strays: strays, herd: herd, tracked: tracked, sector: breachSector });
        } else if (strays === 0 && previous > 0) {
          setAction("Herd contained · all tracked collars inside boundary");
          events.emit("farm/livestock/contained", { herd: herd, tracked: tracked, paddock: paddock });
        }
      } else {
        var voltage = Number(context.state && context.state.voltage);
        var current = Number(context.state && context.state.current);
        var fault = Boolean(context.state && context.state.fault === true);
        if (!isNaN(voltage)) state.set("voltage", voltage);
        if (!isNaN(current)) state.set("fenceCurrent", current);
        state.set("fenceFault", fault);
        var pendingFence = String(state.get("demoScenarioPending") || "");
        if ((pendingFence === "fault" && fault) || (pendingFence === "restore" && !fault)) state.set("demoScenarioPending", "");
        var previousFault = Boolean(state.get("lastFenceFault"));
        state.set("lastFenceFault", fault);
        if (fault && !previousFault) {
          setAction("Perimeter energiser fault · physical boundary protection degraded");
          events.emit("farm/livestock/fence-fault", { voltage: voltage });
        } else if (!fault && previousFault) {
          setAction("Perimeter energiser restored");
          events.emit("farm/livestock/fence-restored", { voltage: voltage });
        }
      }
}
