// farm-troughs — Automation Project logic
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
      function init(key, value) {
        if (state.get(key) === undefined) state.set(key, value);
      }

      init("autoRefill", true);
      init("refillCommandActive", false);
      init("drinkScenarioRequested", false);
      init("drinkingActive", false);
      init("drinkingProgress", 0);

      async function refill(source) {
        if (Boolean(state.get("refillCommandActive")) || Boolean(state.get("drinkingActive"))) return;
        var troughs = byTopic("sensor/farm/troughs");
        var actuator = byTopic("switch/farm/trough-refill/state");
        if (!actuator || !troughs) {
          setAction("Refill blocked: trough hardware unavailable");
          return;
        }
        var lowIds = Array.isArray(troughs.state && troughs.state.lowIds)
          ? troughs.state.lowIds.filter(function(id) { return typeof id === "string"; })
          : [];
        if (lowIds.length === 0) {
          setAction("No low troughs require refill");
          return;
        }
        state.set("refillCommandActive", true);
        setAction((source === "automatic" ? "AUTO · " : "") + "opening refill manifold for " + lowIds.length + " low troughs");
        var result = await devices.action(
          actuator.id,
          "command",
          { payload: { active: true, targets: lowIds } },
          {
            tier: "observed",
            deviceId: troughs.id,
            condition: { all: [{ field: "low", op: "eq", value: 0 }, { field: "refilling", op: "eq", value: 0 }] },
            timeoutMs: 5000,
          }
        );
        state.set("refillCommandActive", false);
        if (result.success) {
          setAction((source === "automatic" ? "Automatic" : "Operator") + " refill verified · targeted troughs recovered");
          events.emit("farm/troughs/refill-verified", { source: source || "operator", targets: lowIds, lifecycleState: result.lifecycleState });
        } else {
          setAction("Refill not verified: " + String(result.error || result.lifecycleState || "unknown"));
          events.emit("farm/troughs/refill-failed", { reason: result.error || "not observed", lifecycleState: result.lifecycleState });
        }
      }

      if (topic.indexOf("ui/") === 0) {
        if (evt === "refill-troughs") {
          await refill("operator");
        } else if (evt === "simulate-drinking") {
          if (Boolean(state.get("drinkScenarioRequested")) || Boolean(state.get("drinkingActive")) || Boolean(state.get("refillCommandActive"))) return;
          state.set("drinkScenarioRequested", true);
          events.emit("farm/sim/troughs-drink", {});
          setAction("DEMO · herd arriving at T4, T5, T12 and T17");
        } else if (evt === "toggle-auto") {
          var current = state.get("autoRefill");
          var enabled = current === undefined ? true : Boolean(current);
          var next = !enabled;
          state.set("autoRefill", next);
          setAction(next ? "Automatic refill enabled · acts after cattle leave" : "Automatic refill disabled · low troughs require operator action");
          if (next && !Boolean(state.get("drinkingActive"))) await refill("automatic");
        } else if (evt === "reset-troughs") {
          events.emit("farm/sim/troughs-reset", {});
          state.set("lowActive", false);
          state.set("refillCommandActive", false);
          state.set("drinkScenarioRequested", false);
          state.set("drinkingActive", false);
          state.set("drinkingProgress", 0);
          state.set("autoRefill", true);
          setAction("DEMO · trough network reset to nominal");
        }
        return;
      }

      if (topic !== "sensor/farm/troughs") return;
      var average = Math.max(0, Math.min(100, Number(context.state && context.state.average) || 0));
      var low = Math.max(0, Number(context.state && context.state.low) || 0);
      var refilling = Math.max(0, Number(context.state && context.state.refilling) || 0);
      var levels = Array.isArray(context.state && context.state.levels) ? context.state.levels : [];
      var lowIds = Array.isArray(context.state && context.state.lowIds) ? context.state.lowIds : [];
      var refillTargets = Array.isArray(context.state && context.state.refillTargets) ? context.state.refillTargets : [];
      var drinkingIds = Array.isArray(context.state && context.state.drinkingIds) ? context.state.drinkingIds : [];
      var drinkingHead = Math.max(0, Number(context.state && context.state.drinkingHead) || 0);
      var drinkingActive = Boolean(context.state && context.state.drinkingActive);
      var drinkingProgress = Math.max(0, Math.min(100, Number(context.state && context.state.drinkingProgress) || 0));
      var consumptionToday = Math.max(0, Number(context.state && context.state.consumptionTodayLitres) || 0);
      var lastDrink = Math.max(0, Number(context.state && context.state.lastDrinkLitres) || 0);
      var refillFlow = Math.max(0, Number(context.state && context.state.refillFlowLpm) || 0);

      state.set("troughAverage", average);
      state.set("troughLow", low);
      state.set("troughRefilling", refilling);
      state.set("troughLevels", levels);
      state.set("lowIds", lowIds);
      state.set("refillTargets", refillTargets);
      state.set("drinkingIds", drinkingIds);
      state.set("drinkingHead", drinkingHead);
      state.set("drinkingActive", drinkingActive);
      state.set("drinkingProgress", drinkingProgress);
      state.set("consumptionTodayLitres", consumptionToday);
      state.set("lastDrinkLitres", lastDrink);
      state.set("refillFlowLpm", refillFlow);
      if (drinkingActive) state.set("drinkScenarioRequested", false);

      var lowActive = Boolean(state.get("lowActive"));
      if (low > 0 && !lowActive) {
        state.set("lowActive", true);
        setAction(low + " troughs below refill threshold · average " + Math.round(average) + "%");
        events.emit("farm/troughs/low", { average: average, low: low, lowIds: lowIds });
      } else if (low === 0 && lowActive) {
        state.set("lowActive", false);
        setAction("Trough network recovered · all low points cleared");
        events.emit("farm/troughs/recovered", { average: average });
      }

      if (low > 0 && Boolean(state.get("autoRefill")) && !drinkingActive && refilling === 0 && !Boolean(state.get("refillCommandActive"))) {
        await refill("automatic");
      }
}
