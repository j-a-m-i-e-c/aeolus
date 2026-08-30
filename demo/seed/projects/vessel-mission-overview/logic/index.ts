// vessel-mission-overview — Automation Project logic
// The compiler wraps this module in Aeolus' execution/completion machinery.

export default async function run(context: EventContext) {
      function init(name, value) { if (state.get(name) === undefined) state.set(name, value); }
      init("ctdDepth", 120); init("ctdStatus", "holding"); init("ctdTemperature", 12.1); init("ctdSalinity", 35.1); init("ctdOxygen", 5.8); init("ctdTension", 220);
      init("rovDepth", 310); init("rovMode", "holding"); init("rovBattery", 78); init("rovTether", 310); init("rovHeading", 88); init("rovAltitude", 8.2);
      init("tsgPumpOn", true); init("tsgFlow", 2.1); init("sst", 18.4); init("surfaceSalinity", 35.2); init("chlorophyll", .8); init("frontDetected", false);
      init("lastMissionEvent", { label: "Science systems online", at: Date.now() });

      var topic = String(context.topic || "");
      var s = context.state && typeof context.state === "object" ? context.state : {};
      function copy(name) { if (s[name] !== undefined) state.set(name, s[name]); }

      if (topic.indexOf("/vessel/summary/ctd") >= 0) {
        ["ctdDepth","ctdStatus","ctdTemperature","ctdSalinity","ctdOxygen","ctdTension"].forEach(copy);
        state.set("lastMissionEvent", { label: "CTD · " + String(s.ctdStatus || "profile updated"), at: Date.now() });
      } else if (topic.indexOf("/vessel/summary/rov") >= 0) {
        ["rovDepth","rovMode","rovBattery","rovTether","rovHeading","rovAltitude"].forEach(copy);
        state.set("lastMissionEvent", { label: "ROV · " + String(s.rovMode || "telemetry updated"), at: Date.now() });
      } else if (topic.indexOf("/vessel/summary/underway") >= 0) {
        ["tsgPumpOn","tsgFlow","sst","surfaceSalinity","chlorophyll","frontDetected"].forEach(copy);
        state.set("lastMissionEvent", { label: s.frontDetected ? "Underway science · hydrographic front detected" : "Underway science · surface stream updated", at: Date.now() });
      }
}
