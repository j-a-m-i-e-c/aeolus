const monitorLogic = `automation({
  actions: [
    function troughMonitor(context) {
      if (String(context.topic || "") !== "sensor/farm/troughs") return;
      var average = Math.max(0, Math.min(100, Number(context.state && context.state.average) || 0));
      var low = Math.max(0, Number(context.state && context.state.low) || 0);
      var refilling = Math.max(0, Number(context.state && context.state.refilling) || 0);
      if (low > 0 || average < 50) {
        events.emit("farm/troughs/low", { average: average, low: low, refilling: refilling });
      } else if (low === 0 && average >= 80) {
        events.emit("farm/troughs/refill-complete", { average: average, low: low });
      }
    },
  ],
});`;

const controllerLogic = `automation({
  actions: [
    async function troughController(context) {
      var topic = String(context.topic || "");
      if (topic.indexOf("/farm/troughs/refill-request") < 0) return;

      function byTopic(wanted) {
        return devices.list().find(function(d) { return d.topic === wanted; });
      }
      var actuator = byTopic("switch/farm/trough-refill/state");
      var troughs = byTopic("sensor/farm/troughs");
      if (!actuator || !troughs) {
        events.emit("farm/troughs/refill-failed", { reason: "trough hardware unavailable" });
        return;
      }

      var result = await devices.action(
        actuator.id,
        "refill",
        { active: true },
        {
          tier: "observed",
          deviceId: troughs.id,
          condition: function(s) { return Number(s.low) === 0 && Number(s.average) >= 80; },
          timeoutMs: 5000,
        }
      );
      if (result.success) {
        events.emit("farm/troughs/refill-verified", { lifecycleState: result.lifecycleState });
      } else {
        events.emit("farm/troughs/refill-failed", { reason: result.error || "refill not observed", lifecycleState: result.lifecycleState });
      }
    },
  ],
});`;

export const troughAutomations = [
  {
    key: "farm-trough-monitor",
    name: "Farm Trough Watering · Monitor",
    triggerTopic: "sensor/farm/troughs",
    scriptSource: monitorLogic,
  },
  {
    key: "farm-trough-controller",
    name: "Farm Trough Watering · Control",
    triggerTopic: "aeolus/events/+/farm/troughs/#",
    scriptSource: controllerLogic,
  },
];
