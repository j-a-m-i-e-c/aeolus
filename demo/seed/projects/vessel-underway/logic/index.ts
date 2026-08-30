// vessel-underway — Automation Project logic
// The compiler wraps this module in Aeolus' execution/completion machinery.

export default async function run(context: EventContext) {
      var topic = String(context.topic || ""); var evt = topic.split("/").pop();
      function byTopic(wanted) { return devices.list().find(function(d) { return d.topic === wanted; }); }
      function setAction(label) { state.set("lastAction", { label: label, at: Date.now() }); }
      function project() {
        var tsg = byTopic("sensor/underway/tsg"); var pump = byTopic("switch/vessel/tsg-pump/state");
        var sst = Number(tsg && tsg.state && tsg.state.sst); var sal = Number(tsg && tsg.state && tsg.state.salinity); var flow = Number(tsg && tsg.state && tsg.state.flow); var chl = Number(tsg && tsg.state && tsg.state.chlorophyll); var turb = Number(tsg && tsg.state && tsg.state.turbidity);
        if (!isNaN(sst)) state.set("sst", sst); if (!isNaN(sal)) state.set("salinity", sal); if (!isNaN(flow)) state.set("flow", flow); if (!isNaN(chl)) state.set("chlorophyll", chl); if (!isNaN(turb)) state.set("turbidity", turb);
        var pumpOn = Boolean(pump && pump.state && pump.state.on); state.set("pumpOn", pumpOn);
        var profile = state.get("profile"); if (!Array.isArray(profile)) profile = [];
        if (!isNaN(sst) && !isNaN(sal) && !isNaN(flow) && flow > .2) { profile = profile.concat([{ sst: sst, salinity: sal, chlorophyll: isNaN(chl) ? 0 : chl, at: Date.now() }]).slice(-18); state.set("profile", profile); }
        var front = Boolean(state.get("frontDetected"));
        events.emit("vessel/summary/underway", { tsgPumpOn: pumpOn, tsgFlow: isNaN(flow) ? 0 : flow, sst: isNaN(sst) ? 0 : sst, surfaceSalinity: isNaN(sal) ? 0 : sal, chlorophyll: isNaN(chl) ? 0 : chl, frontDetected: front });
      }

      async function setPump(on) {
        var pump = byTopic("switch/vessel/tsg-pump/state"); var tsg = byTopic("sensor/underway/tsg"); if (!pump || !tsg) { setAction("Flow-through system unavailable"); return; }
        state.set("commandPending", true); setAction(on ? "Starting flow-through seawater intake" : "Stopping flow-through seawater intake");
        var result = await devices.action(pump.id, "command", { payload: { on: on } }, { tier: "observed", deviceId: tsg.id, condition: { field: "flow", op: on ? "gt" : "eq", value: on ? .5 : 0 }, timeoutMs: 5000 });
        state.set("commandPending", false);
        if (result.success) setAction(on ? "Underway sampling verified · flow observed" : "Sampling stopped · zero flow observed"); else setAction("Sampling command not verified: " + String(result.error || result.lifecycleState || "unknown")); project();
      }

      if (topic.indexOf("ui/") === 0) {
        if (evt === "sampling-start") await setPump(true); else if (evt === "sampling-stop") await setPump(false);
        else if (evt === "simulate-front") { state.set("frontDetected", false); events.emit("vessel/sim/ocean-front", {}); setAction("Injecting hydrographic front ahead of vessel"); }
        else if (evt === "reset-underway") { events.emit("vessel/sim/underway-reset", {}); state.set("frontDetected", false); state.set("profile", []); setAction("Resetting surface-water transect"); }
        return;
      }

      var oldSst = Number(state.get("sst")); var oldSal = Number(state.get("salinity")); project();
      var flow = Number(state.get("flow") || 0); var newSst = Number(state.get("sst")); var newSal = Number(state.get("salinity"));
      if (flow > .5 && !isNaN(oldSst) && !isNaN(oldSal) && !isNaN(newSst) && !isNaN(newSal)) {
        var gradient = Math.abs(newSst - oldSst) + Math.abs(newSal - oldSal) * 3;
        if (gradient >= .7 && !Boolean(state.get("frontDetected"))) { state.set("frontDetected", true); setAction("Hydrographic front detected in flow-through stream"); events.emit("vessel/underway/front-detected", { sst: newSst, salinity: newSal, gradient: gradient }); project(); }
      }
}
