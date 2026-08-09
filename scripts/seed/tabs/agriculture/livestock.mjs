const monitorLogic = `automation({
  actions: [
    function livestockMonitor(context) {
      if (String(context.topic || "") !== "sensor/fence/collars") return;
      var strays = Math.max(0, Number(context.state && context.state.strays) || 0);
      var herd = Math.max(0, Number(context.state && context.state.herd) || 0);
      var tracked = Math.max(0, Number(context.state && context.state.tracked) || 0);
      if (strays > 0) {
        events.emit("farm/livestock/breach", { strays: strays, herd: herd, tracked: tracked });
      } else {
        events.emit("farm/livestock/contained", { herd: herd, tracked: tracked });
      }
    },
  ],
});`;

const controllerLogic = `automation({
  actions: [
    async function livestockController(context) {
      var topic = String(context.topic || "");
      if (topic.indexOf("/farm/livestock/recall-request") < 0) return;

      function byTopic(wanted) {
        return devices.list().find(function(d) { return d.topic === wanted; });
      }
      var recall = byTopic("switch/fence/recall/state");
      var collars = byTopic("sensor/fence/collars");
      if (!recall || !collars) {
        events.emit("farm/livestock/recall-failed", { reason: "recall hardware unavailable" });
        return;
      }

      var result = await devices.action(
        recall.id,
        "recall",
        { active: true },
        {
          tier: "observed",
          deviceId: collars.id,
          condition: function(s) { return Number(s.strays) === 0; },
          timeoutMs: 5000,
        }
      );

      if (result.success) {
        events.emit("farm/livestock/recall-verified", { lifecycleState: result.lifecycleState });
      } else {
        events.emit("farm/livestock/recall-failed", { reason: result.error || "recall not observed", lifecycleState: result.lifecycleState });
      }
    },
  ],
});`;

export const livestockAutomations = [
  {
    key: "farm-livestock-monitor",
    name: "Farm Livestock & Virtual Fence · Monitor",
    triggerTopic: "sensor/fence/#",
    scriptSource: monitorLogic,
  },
  {
    key: "farm-livestock-controller",
    name: "Farm Livestock & Virtual Fence · Control",
    triggerTopic: "aeolus/events/+/farm/livestock/#",
    scriptSource: controllerLogic,
  },
];
