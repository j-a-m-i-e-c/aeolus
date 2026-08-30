// mine-atmosphere — Automation Project logic
// The compiler wraps this module in Aeolus' execution/completion machinery.

export default async function run(context: EventContext) {
      var topic = String(context.topic || "");
      var evt = topic.split("/").pop();
      function byTopic(wanted) { return devices.list().find(function(d) { return d.topic === wanted; }); }
      function setAction(label) { state.set("lastAction", { label: label, at: Date.now() }); }
      function numberAt(device, field, fallback) { var n = Number(device && device.state && device.state[field]); return isNaN(n) ? fallback : n; }

      function project(allowDemandEvent) {
        var l3 = byTopic("sensor/mine/gas/l3");
        var d7 = byTopic("sensor/mine/gas/drift-7");
        var l3ch4 = numberAt(l3, "ch4", 0.30);
        var d7ch4 = numberAt(d7, "ch4", 0.42);
        var co = numberAt(d7, "co", 16);
        var o2 = numberAt(d7, "o2", 20.7);
        var no2 = numberAt(d7, "no2", 1.6);
        var severity = d7ch4 >= 1 ? "alarm" : d7ch4 >= 0.5 ? "warning" : "safe";
        var demand = severity === "alarm" ? 100 : severity === "warning" ? 78 : 48;
        var wasAlarm = Boolean(state.get("alarm"));
        state.set("l3Ch4", l3ch4); state.set("d7Ch4", d7ch4); state.set("co", co); state.set("o2", o2); state.set("no2", no2);
        state.set("severity", severity); state.set("alarm", severity === "alarm"); state.set("ventDemand", demand);
        if (!wasAlarm && severity === "alarm") { state.set("acknowledged", false); setAction("Drift 7 methane alarm · requesting maximum ventilation"); }
        if (wasAlarm && severity !== "alarm") setAction("Drift 7 atmosphere returned below alarm threshold");
        if (allowDemandEvent) {
          var band = severity + ":" + demand;
          if (String(state.get("lastDemandBand") || "") !== band) {
            state.set("lastDemandBand", band);
            events.emit("mine/atmosphere/vent-demand", { demand: demand, severity: severity, ch4: d7ch4 });
          }
        }
        events.emit("mine/summary/atmosphere", { l3Ch4: l3ch4, d7Ch4: d7ch4, co: co, o2: o2, no2: no2, severity: severity, alarm: severity === "alarm", acknowledged: Boolean(state.get("acknowledged")), ventDemand: demand });
      }

      if (topic.indexOf("ui/") === 0) {
        if (evt === "acknowledge-alarm") { state.set("acknowledged", true); setAction("Atmospheric alarm acknowledged by operator"); project(false); }
        else if (evt === "simulate-gas-rise") { events.emit("mine/sim/gas-rise", {}); setAction("Injecting a transient methane pocket at Drift 7"); }
        else if (evt === "reset-atmosphere") { events.emit("mine/sim/atmosphere-reset", {}); state.set("acknowledged", false); state.set("lastDemandBand", ""); setAction("Resetting mine atmosphere to nominal conditions"); }
        return;
      }

      if (topic.indexOf("sensor/mine/gas/") !== 0) return;
      project(true);
}
