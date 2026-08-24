// mine-ventilation — Automation Project logic
// The compiler wraps this module in Aeolus' execution/completion machinery.

export default async function run(context: EventContext) {
      var topic = String(context.topic || ""); var evt = topic.split("/").pop();
      function byTopic(wanted) { return devices.list().find(function(d) { return d.topic === wanted; }); }
      function setAction(label) { state.set("lastAction", { label: label, at: Date.now() }); }
      function project() {
        var fan = byTopic("switch/mine/ventilation/state");
        var fs = fan && fan.state ? fan.state : {};
        state.set("mode", String(fs.mode || "auto")); state.set("demand", Number(fs.demand || 0)); state.set("primaryRpm", Number(fs.primaryRpm || 0)); state.set("boosterRpm", Number(fs.boosterRpm || 0)); state.set("airflow", Number(fs.airflow || 0)); state.set("fanOn", Boolean(fs.on));
        events.emit("mine/summary/ventilation", { mode: String(fs.mode || "auto"), demand: Number(fs.demand || 0), primaryRpm: Number(fs.primaryRpm || 0), boosterRpm: Number(fs.boosterRpm || 0), airflow: Number(fs.airflow || 0), manualOverride: Boolean(state.get("manualOverride")), requestedDemand: Number(state.get("requestedDemand") || 48) });
      }
      async function command(mode, reason) {
        var fan = byTopic("switch/mine/ventilation/state"); if (!fan) { setAction("Ventilation controller unavailable"); return; }
        if (String(fan.state && fan.state.mode || "") === mode) { setAction(reason); project(); return; }
        state.set("commandPending", true); setAction(reason);
        var result = await devices.action(fan.id, "command", { payload: { mode: mode } }, { tier: "observed", deviceId: fan.id, condition: { field: "mode", op: "eq", value: mode }, timeoutMs: 5000 });
        state.set("commandPending", false);
        if (!result.success) setAction("Ventilation command not verified: " + String(result.error || result.lifecycleState || "unknown"));
        project();
      }

      if (topic.indexOf("ui/") === 0) {
        if (evt === "force-boost") { state.set("manualOverride", true); await command("boost", "Manual ventilation boost enabled"); }
        else if (evt === "return-auto") { state.set("manualOverride", false); var demand = Number(state.get("requestedDemand") || 48); await command(demand >= 80 ? "boost" : "auto", "Ventilation returned to atmospheric demand"); }
        return;
      }

      if (topic.indexOf("/mine/atmosphere/vent-demand") < 0) return;
      var payload = context.state && typeof context.state === "object" ? context.state : {};
      var demand = Number(payload.demand || 48); var severity = String(payload.severity || "safe");
      state.set("requestedDemand", demand); state.set("atmosphereSeverity", severity);
      if (!Boolean(state.get("manualOverride"))) {
        if (demand >= 80) await command("boost", "Atmospheric Safety requested maximum ventilation");
        else await command("auto", "Atmosphere safe · ventilation returned to demand control");
      } else project();
}
