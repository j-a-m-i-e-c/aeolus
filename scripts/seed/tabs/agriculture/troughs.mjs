const logic = `automation({
  actions: [
    async function troughWatering(context) {
      var topic = String(context.topic || "");
      var evt = topic.split("/").pop();

      function byTopic(wanted) {
        return devices.list().find(function(d) { return d.topic === wanted; });
      }
      function setAction(label) {
        state.set("lastAction", { label: label, at: Date.now() });
      }

      var troughs = byTopic("sensor/farm/troughs");
      var actuator = byTopic("switch/farm/trough-refill/state");

      async function refill(source) {
        if (!actuator || !troughs) {
          setAction("Refill blocked: trough hardware unavailable");
          return;
        }
        setAction("Refill command dispatched");
        var result = await devices.action(
          actuator.id,
          "command",
          { payload: { active: true } },
          {
            tier: "observed",
            deviceId: troughs.id,
            condition: function(s) { return Number(s.low) === 0 && Number(s.average) >= 80; },
            timeoutMs: 5000,
          }
        );
        if (result.success) {
          setAction("Refill verified · distributed troughs recovered");
          events.emit("farm/troughs/refill-verified", { source: source || "operator", lifecycleState: result.lifecycleState });
        } else {
          setAction("Refill not verified: " + String(result.error || result.lifecycleState || "unknown"));
          events.emit("farm/troughs/refill-failed", { reason: result.error || "not observed", lifecycleState: result.lifecycleState });
        }
      }

      if (topic.indexOf("ui/") === 0) {
        if (evt === "refill-troughs") await refill("operator");
        else if (evt === "simulate-low-troughs") {
          events.emit("farm/sim/troughs-low", {});
          setAction("Simulating low distributed trough levels");
        } else if (evt === "toggle-auto") {
          var next = !Boolean(state.get("autoRefill"));
          state.set("autoRefill", next);
          setAction(next ? "Automatic trough refill enabled" : "Automatic trough refill disabled");
        } else if (evt === "reset-troughs") {
          events.emit("farm/sim/troughs-reset", {});
          state.set("lowActive", false);
          setAction("Resetting trough network to nominal");
        }
        return;
      }

      if (topic !== "sensor/farm/troughs") return;
      var average = Math.max(0, Math.min(100, Number(context.state && context.state.average) || 0));
      var low = Math.max(0, Number(context.state && context.state.low) || 0);
      var refilling = Math.max(0, Number(context.state && context.state.refilling) || 0);
      // UI projection: mirror ONLY observed trough state into this automation's
      // own state (the non-admin demo user reads these via aeolus.read, not
      // aeolus.devices).
      state.set("troughAverage", average);
      state.set("troughLow", low);
      state.set("troughRefilling", refilling);
      var lowActive = Boolean(state.get("lowActive"));

      if ((low > 0 || average < 50) && !lowActive) {
        state.set("lowActive", true);
        setAction(low + " troughs low · average " + Math.round(average) + "%");
        events.emit("farm/troughs/low", { average: average, low: low });
        if (Boolean(state.get("autoRefill"))) await refill("automatic");
      } else if (low === 0 && average >= 80) {
        if (lowActive) {
          state.set("lowActive", false);
          setAction("Trough network recovered");
          events.emit("farm/troughs/recovered", { average: average });
        }
      }
    },
  ],
});`;

const ui = `import { useEffect, useState } from "react";
import type { CustomComponentProps } from "./types";

export default function TroughWatering(aeolus: CustomComponentProps) {
  // Non-admin demo users have no direct device visibility; read the automation's
  // projection state (mirrored from observed device state) rather than the raw
  // device inventory.
  const average = Math.max(0, Math.min(100, Number(aeolus.read("troughAverage") ?? 71)));
  const low = Math.max(0, Math.min(20, Number(aeolus.read("troughLow") ?? 3)));
  const refilling = Math.max(0, Math.min(20, Number(aeolus.read("troughRefilling") ?? 2)));
  const auto = Boolean(aeolus.read("autoRefill"));
  const lastAction = aeolus.read("lastAction") as any;
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setPhase((v) => (v + 1) % 100000), 120);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{ padding: 12, minHeight: "100%", background: "linear-gradient(180deg,#091116,#080D10)", color: "#E8EEF2" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 850 }}>TROUGH WATERING</div>
          <div style={{ color: "#687982", fontSize: 8, marginTop: 2 }}>20 distributed sensors · refill manifold · local recovery</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: low > 0 ? "#F6A84B" : "#70D7F2", fontSize: 11, fontWeight: 800 }}>{Math.round(average)}% AVG</div>
          <div style={{ color: "#62737B", fontSize: 7 }}>{low} low · {refilling} filling</div>
        </div>
      </div>

      <div style={{ border: "1px solid #263B43", borderRadius: 11, background: "#081116", padding: 10 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 8 }}>
          {Array.from({ length: 20 }).map((_, i) => {
            const isLow = i < low;
            const isFilling = !isLow && i < low + refilling;
            const local = isLow ? Math.max(18, average - 30 + (i % 4) * 3) : Math.min(100, average + ((i * 7) % 13) - 6);
            return <div key={i} style={{ position: "relative", height: 42, borderRadius: 7, border: "1px solid " + (isLow ? "#76502B" : isFilling ? "#2C7185" : "#284B59"), background: "#0C171B", overflow: "hidden" }}>
              <div style={{ position: "absolute", left: 3, right: 3, bottom: 3, height: Math.max(3, local * .32), borderRadius: 4, background: isLow ? "#80592A" : "linear-gradient(180deg,#48D4F5,#1C78A2)", opacity: .82 }} />
              {isFilling && <div style={{ position: "absolute", left: ((phase + i * 11) % 70) + "%", top: 3, width: 3, height: 8, borderRadius: 3, background: "#8CEBFF" }} />}
              <span style={{ position: "absolute", left: 5, top: 4, color: "#788A91", fontSize: 6 }}>T{i + 1}</span>
            </div>;
          })}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.15fr 1fr 1fr", gap: 6, marginTop: 8 }}>
        <button onClick={() => aeolus.fire(low > 0 ? "refill-troughs" : "simulate-low-troughs")} style={{ borderRadius: 8, padding: "8px", border: "1px solid #2A6170", background: "#102830", color: "#7ADCF4", fontSize: 9, fontWeight: 750, cursor: "pointer" }}>{low > 0 ? "Start refill" : "Simulate low"}</button>
        <button onClick={() => aeolus.fire("toggle-auto")} style={{ borderRadius: 8, padding: "8px", border: "1px solid " + (auto ? "#315B45" : "#303B40"), background: auto ? "#10251A" : "#151A1D", color: auto ? "#82E3A0" : "#87949A", fontSize: 9, cursor: "pointer" }}>Auto {auto ? "ON" : "OFF"}</button>
        <button onClick={() => aeolus.fire("reset-troughs")} style={{ borderRadius: 8, padding: "8px", border: "1px solid #303B40", background: "#151A1D", color: "#87949A", fontSize: 9, cursor: "pointer" }}>Reset</button>
      </div>
      <div style={{ color: "#63727A", fontSize: 8, marginTop: 7 }}>{lastAction?.label ? String(lastAction.label) : "Trough telemetry online"}</div>
    </div>
  );
}`;

export const troughAutomation = {
  key: "farm-troughs",
  name: "Trough Watering",
  triggerTopic: "sensor/farm/troughs",
  scriptSource: logic,
  uiSource: ui,
  demoAccess: {
    fireEvents: ["refill-troughs", "simulate-low-troughs", "toggle-auto", "reset-troughs"],
  },
};
