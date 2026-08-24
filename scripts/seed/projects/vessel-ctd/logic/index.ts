// vessel-ctd — Automation Project logic
// The compiler wraps this module in Aeolus' execution/completion machinery.

export default async function run(context: EventContext) {
      var topic = String(context.topic || "");
      var evt = topic.split("/").pop();
      function byTopic(wanted) { return devices.list().find(function(d) { return d.topic === wanted; }); }
      function setAction(label) { state.set("lastAction", { label: label, at: Date.now() }); }
      function project() {
        var sonde = byTopic("sensor/ctd/sonde");
        var winch = byTopic("switch/vessel/ctd-winch/state");
        var depth = Number(sonde && sonde.state && sonde.state.depth);
        var temp = Number(sonde && sonde.state && sonde.state.temperature);
        var sal = Number(sonde && sonde.state && sonde.state.salinity);
        var oxy = Number(sonde && sonde.state && sonde.state.oxygen);
        var speed = Number(sonde && sonde.state && sonde.state.verticalSpeed);
        var tension = Number(winch && winch.state && winch.state.tension);
        var target = Number(winch && winch.state && winch.state.targetDepth);
        var mode = String(winch && winch.state && winch.state.mode || "holding");
        if (!isNaN(depth)) state.set("depth", depth); if (!isNaN(temp)) state.set("temperature", temp);
        if (!isNaN(sal)) state.set("salinity", sal); if (!isNaN(oxy)) state.set("oxygen", oxy);
        if (!isNaN(speed)) state.set("verticalSpeed", speed); if (!isNaN(tension)) state.set("tension", tension);
        if (!isNaN(target)) state.set("targetDepth", target); state.set("status", mode);
        state.set("winchOn", Boolean(winch && winch.state && winch.state.on));
        events.emit("vessel/summary/ctd", { ctdDepth: isNaN(depth) ? 0 : depth, ctdStatus: mode, ctdTemperature: isNaN(temp) ? 0 : temp, ctdSalinity: isNaN(sal) ? 0 : sal, ctdOxygen: isNaN(oxy) ? 0 : oxy, ctdTension: isNaN(tension) ? 0 : tension });
      }

      async function commandWinch(mode, targetDepth) {
        var winch = byTopic("switch/vessel/ctd-winch/state"); var sonde = byTopic("sensor/ctd/sonde");
        if (!winch || !sonde) { setAction("CTD hardware unavailable"); return; }
        if (Boolean(state.get("commandPending"))) return;
        var currentMode = String(winch.state && winch.state.mode || "holding");
        if ((currentMode === "deploying" || currentMode === "recovering") && mode !== "hold") { setAction("Winch already moving · hold before changing direction"); return; }
        state.set("commandPending", true);
        var options;
        if (mode === "deploy") options = { tier: "observed", deviceId: sonde.id, condition: { field: "depth", op: "gte", value: targetDepth - 5 }, timeoutMs: 8000 };
        else if (mode === "recover") options = { tier: "observed", deviceId: sonde.id, condition: { field: "depth", op: "lte", value: targetDepth + 5 }, timeoutMs: 8000 };
        else options = { tier: "observed", deviceId: winch.id, condition: { field: "mode", op: "eq", value: "holding" }, timeoutMs: 5000 };
        setAction(mode === "deploy" ? "Deploying CTD to " + targetDepth + " m" : mode === "recover" ? "Recovering CTD to deck" : "Holding CTD at current depth");
        var result = await devices.action(winch.id, "command", { payload: { mode: mode, targetDepth: targetDepth } }, options);
        state.set("commandPending", false);
        if (result.success) {
          setAction(mode === "deploy" ? "Cast on station at " + targetDepth + " m" : mode === "recover" ? "CTD recovered to surface" : "Winch hold verified");
          events.emit("vessel/ctd/command-verified", { mode: mode, targetDepth: targetDepth, lifecycleState: result.lifecycleState });
        } else setAction("CTD command not verified: " + String(result.error || result.lifecycleState || "unknown"));
        project();
      }

      async function tensionProtection() {
        if (Boolean(state.get("tensionProtectionActive"))) return;
        var winch = byTopic("switch/vessel/ctd-winch/state");
        if (!winch || !Boolean(winch.state && winch.state.on)) return;
        state.set("tensionProtectionActive", true);
        setAction("Cable tension high · arresting winch motion");
        var result = await devices.action(winch.id, "command", { payload: { mode: "hold", targetDepth: Number(state.get("depth") || 0) } }, { tier: "observed", deviceId: winch.id, condition: { field: "mode", op: "eq", value: "holding" }, timeoutMs: 5000 });
        state.set("tensionProtectionActive", false);
        if (result.success) { setAction("Winch stopped on high-tension interlock"); events.emit("vessel/ctd/tension-protection", { lifecycleState: result.lifecycleState }); }
        else setAction("High-tension stop not verified");
        project();
      }

      if (topic.indexOf("ui/") === 0) {
        if (evt === "deploy-420") await commandWinch("deploy", 420);
        else if (evt === "hold-ctd") await commandWinch("hold", Number(state.get("depth") || 120));
        else if (evt === "recover-ctd") await commandWinch("recover", 5);
        else if (evt === "simulate-snag") { events.emit("vessel/sim/ctd-snag", {}); setAction("Injecting cable snag into simulator"); }
        else if (evt === "reset-ctd") { events.emit("vessel/sim/ctd-reset", {}); state.set("tensionProtectionActive", false); setAction("Resetting CTD cast to nominal hold"); }
        return;
      }
      project();
      var tension = Number(state.get("tension") || 0); var winchOn = Boolean(state.get("winchOn"));
      if (tension >= 650 && winchOn) await tensionProtection();
}
