// vessel-rov — Automation Project logic
// The compiler wraps this module in Aeolus' execution/completion machinery.

export default async function run(context: EventContext) {
      var topic = String(context.topic || ""); var evt = topic.split("/").pop();
      function byTopic(wanted) { return devices.list().find(function(d) { return d.topic === wanted; }); }
      function setAction(label) { state.set("lastAction", { label: label, at: Date.now() }); }
      function project() {
        var telemetry = byTopic("sensor/rov/telemetry"); var vehicle = byTopic("switch/rov/vehicle/state");
        var depth = Number(telemetry && telemetry.state && telemetry.state.depth); var heading = Number(telemetry && telemetry.state && telemetry.state.heading);
        var battery = Number(telemetry && telemetry.state && telemetry.state.battery); var tether = Number(telemetry && telemetry.state && telemetry.state.tetherTension);
        var altitude = Number(telemetry && telemetry.state && telemetry.state.altitude); var visibility = Number(telemetry && telemetry.state && telemetry.state.visibility);
        var mode = String(telemetry && telemetry.state && telemetry.state.mode || vehicle && vehicle.state && vehicle.state.mode || "holding");
        if (!isNaN(depth)) state.set("depth", depth); if (!isNaN(heading)) state.set("heading", heading); if (!isNaN(battery)) state.set("battery", battery);
        if (!isNaN(tether)) state.set("tetherTension", tether); if (!isNaN(altitude)) state.set("altitude", altitude); if (!isNaN(visibility)) state.set("visibility", visibility); state.set("mode", mode);
        state.set("lightsOn", Boolean(vehicle && vehicle.state && vehicle.state.lights)); state.set("thrusterPct", Number(vehicle && vehicle.state && vehicle.state.thrusterPct || 0));
        events.emit("vessel/summary/rov", { rovDepth: isNaN(depth) ? 0 : depth, rovMode: mode, rovBattery: isNaN(battery) ? 0 : battery, rovTether: isNaN(tether) ? 0 : tether, rovHeading: isNaN(heading) ? 0 : heading, rovAltitude: isNaN(altitude) ? 0 : altitude });
      }

      async function commandRov(mode, targetDepth) {
        var vehicle = byTopic("switch/rov/vehicle/state"); var telemetry = byTopic("sensor/rov/telemetry"); if (!vehicle || !telemetry) { setAction("ROV hardware unavailable"); return; }
        if (Boolean(state.get("commandPending"))) return;
        var liveMode = String(telemetry.state && telemetry.state.mode || "holding");
        if ((liveMode === "diving" || liveMode === "recovering") && mode !== "hold") { setAction("ROV already changing depth · hold before new command"); return; }
        state.set("commandPending", true);
        var options;
        if (mode === "dive") options = { tier: "observed", deviceId: telemetry.id, condition: { field: "depth", op: "gte", value: targetDepth - 5 }, timeoutMs: 8000 };
        else if (mode === "recover") options = { tier: "observed", deviceId: telemetry.id, condition: { field: "depth", op: "lte", value: targetDepth + 8 }, timeoutMs: 8000 };
        else options = { tier: "observed", deviceId: telemetry.id, condition: { field: "mode", op: "eq", value: mode === "survey" ? "surveying" : "holding" }, timeoutMs: 5000 };
        setAction(mode === "dive" ? "ROV descending to survey altitude" : mode === "recover" ? "Recovering ROV to launch depth" : mode === "survey" ? "Starting seabed transect" : "Holding ROV position");
        var result = await devices.action(vehicle.id, "command", { payload: { mode: mode, targetDepth: targetDepth } }, options);
        state.set("commandPending", false);
        if (result.success) { setAction(mode === "survey" ? "Transect underway · telemetry verified" : mode === "dive" ? "Survey depth reached" : mode === "recover" ? "ROV recovered to launch depth" : "ROV hold verified"); events.emit("vessel/rov/command-verified", { mode: mode, lifecycleState: result.lifecycleState }); }
        else setAction("ROV command not verified: " + String(result.error || result.lifecycleState || "unknown"));
        project();
      }

      async function protectTether() {
        if (Boolean(state.get("tetherProtectionActive"))) return;
        var vehicle = byTopic("switch/rov/vehicle/state"); var telemetry = byTopic("sensor/rov/telemetry"); if (!vehicle || !telemetry) return;
        state.set("tetherProtectionActive", true); setAction("Tether load high · commanding ROV station hold");
        var result = await devices.action(vehicle.id, "command", { payload: { mode: "hold", targetDepth: Number(state.get("depth") || 0) } }, { tier: "observed", deviceId: telemetry.id, condition: { field: "mode", op: "eq", value: "holding" }, timeoutMs: 5000 });
        state.set("tetherProtectionActive", false);
        if (result.success) { setAction("ROV hold verified · tether protected"); events.emit("vessel/rov/tether-protection", { lifecycleState: result.lifecycleState }); } else setAction("ROV safety hold not verified");
        project();
      }

      if (topic.indexOf("ui/") === 0) {
        if (evt === "rov-dive") await commandRov("dive", 360);
        else if (evt === "rov-survey") await commandRov("survey", Number(state.get("depth") || 360));
        else if (evt === "rov-hold") await commandRov("hold", Number(state.get("depth") || 310));
        else if (evt === "rov-recover") await commandRov("recover", 25);
        else if (evt === "simulate-rov-current") { events.emit("vessel/sim/rov-cross-current", {}); setAction("Injecting cross-current at ROV depth"); }
        else if (evt === "reset-rov") { events.emit("vessel/sim/rov-reset", {}); state.set("tetherProtectionActive", false); setAction("Resetting ROV mission state"); }
        return;
      }
      project();
      var tether = Number(state.get("tetherTension") || 0); if (tether >= 650) await protectTether();
}
