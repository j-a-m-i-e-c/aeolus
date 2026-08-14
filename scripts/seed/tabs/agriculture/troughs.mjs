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

      async function refill(source) {
        if (Boolean(state.get("refillCommandActive"))) return;
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
        setAction("Opening refill manifold for " + lowIds.length + " low troughs");
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
          setAction("Refill verified · all targeted troughs recovered");
          events.emit("farm/troughs/refill-verified", { source: source || "operator", targets: lowIds, lifecycleState: result.lifecycleState });
        } else {
          setAction("Refill not verified: " + String(result.error || result.lifecycleState || "unknown"));
          events.emit("farm/troughs/refill-failed", { reason: result.error || "not observed", lifecycleState: result.lifecycleState });
        }
      }

      if (topic.indexOf("ui/") === 0) {
        if (evt === "refill-troughs") await refill("operator");
        else if (evt === "simulate-drinking") {
          events.emit("farm/sim/troughs-drink", {});
          setAction("Simulating herd water demand at four troughs");
        } else if (evt === "toggle-auto") {
          var next = !Boolean(state.get("autoRefill"));
          state.set("autoRefill", next);
          setAction(next ? "Automatic low-trough recovery enabled" : "Automatic low-trough recovery disabled");
        } else if (evt === "reset-troughs") {
          events.emit("farm/sim/troughs-reset", {});
          state.set("lowActive", false);
          state.set("refillCommandActive", false);
          state.set("autoRefill", true);
          setAction("Resetting trough network to nominal");
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
      state.set("consumptionTodayLitres", consumptionToday);
      state.set("lastDrinkLitres", lastDrink);
      state.set("refillFlowLpm", refillFlow);
      if (state.get("autoRefill") === undefined) state.set("autoRefill", true);
      if (state.get("refillCommandActive") === undefined) state.set("refillCommandActive", false);

      var lowActive = Boolean(state.get("lowActive"));
      if (low > 0 && !lowActive) {
        state.set("lowActive", true);
        setAction(low + " troughs below refill threshold · average " + Math.round(average) + "%");
        events.emit("farm/troughs/low", { average: average, low: low, lowIds: lowIds });
        if (Boolean(state.get("autoRefill"))) await refill("automatic");
      } else if (low === 0) {
        if (lowActive) {
          state.set("lowActive", false);
          setAction("Trough network recovered · all low points cleared");
          events.emit("farm/troughs/recovered", { average: average });
        }
      }
    },
  ],
});`;

const ui = `import { useEffect, useMemo, useState } from "react";
import type { CustomComponentProps } from "./types";

export default function TroughWatering(aeolus: CustomComponentProps) {
  const average = Math.max(0, Math.min(100, Number(aeolus.read("troughAverage") ?? 83)));
  const low = Math.max(0, Math.min(20, Number(aeolus.read("troughLow") ?? 0)));
  const refilling = Math.max(0, Math.min(20, Number(aeolus.read("troughRefilling") ?? 0)));
  const levelsRaw = aeolus.read("troughLevels") as number[] | undefined;
  const levels = Array.isArray(levelsRaw) && levelsRaw.length === 20 ? levelsRaw : [86,78,91,82,74,88,79,93,84,76,90,81,87,77,92,85,73,89,80,94];
  const lowIds = (aeolus.read("lowIds") as string[] | undefined) || [];
  const refillTargets = (aeolus.read("refillTargets") as string[] | undefined) || [];
  const drinkingIds = (aeolus.read("drinkingIds") as string[] | undefined) || [];
  const drinkingHead = Math.max(0, Number(aeolus.read("drinkingHead") ?? 0));
  const consumptionToday = Math.max(0, Number(aeolus.read("consumptionTodayLitres") ?? 1240));
  const lastDrink = Math.max(0, Number(aeolus.read("lastDrinkLitres") ?? 0));
  const refillFlow = Math.max(0, Number(aeolus.read("refillFlowLpm") ?? 0));
  const auto = aeolus.read("autoRefill") !== false;
  const refillCommandActive = Boolean(aeolus.read("refillCommandActive"));
  const lastAction = aeolus.read("lastAction") as any;
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setPhase((v) => (v + 1) % 100000), 110);
    return () => clearInterval(id);
  }, []);

  const positions = useMemo(() => Array.from({ length: 20 }).map((_, i) => ({
    x: 82 + (i % 5) * 88,
    y: 52 + Math.floor(i / 5) * 47,
  })), []);

  const status = drinkingIds.length > 0 ? "CATTLE DRINKING" : refilling > 0 || refillCommandActive ? "REFILLING " + Math.max(refilling, refillTargets.length) : low > 0 ? low + " LOW" : "NETWORK HEALTHY";
  const statusColor = drinkingIds.length > 0 ? "#E9C66D" : low > 0 ? "#F4A45A" : refilling > 0 ? "#76DDF4" : "#74DDA0";
  const actionLabel = lastAction?.label ? String(lastAction.label) : "Distributed trough telemetry online";

  function Trough(props: { index: number; x: number; y: number }) {
    const id = "T" + (props.index + 1);
    const level = Math.max(0, Math.min(100, Number(levels[props.index]) || 0));
    const isLow = lowIds.includes(id) || level < 45;
    const isRefilling = refillTargets.includes(id);
    const isDrinking = drinkingIds.includes(id);
    const waterWidth = Math.max(3, 27 * level / 100);
    return <g transform={"translate(" + props.x + " " + props.y + ")"}>
      <line x1="-34" y1="0" x2="-13" y2="0" stroke={isRefilling ? "#4ECDED" : "#254451"} strokeWidth={isRefilling ? "2.2" : "1.2"} />
      {isRefilling && <circle cx={-23 + ((phase + props.index * 7) % 12)} cy="0" r="2" fill="#9CEFFF" />}
      <rect x="-13" y="-8" width="32" height="16" rx="5" fill="#0D191D" stroke={isLow ? "#9B6234" : isRefilling ? "#3F91A7" : "#345660"} />
      <rect x="-10" y="1" width={waterWidth} height="4" rx="2" fill={isLow ? "#B27638" : "#43C7EA"} opacity=".85" />
      <text x="3" y="-13" textAnchor="middle" fill="#6C828A" fontSize="6.5">{id}</text>
      <text x="3" y="20" textAnchor="middle" fill={isLow ? "#E4A767" : "#7E949A"} fontSize="6.5">{Math.round(level)}%</text>
      {isDrinking && <g transform="translate(25 -2)">
        <ellipse rx="6" ry="3.4" fill="#C9B27E" />
        <circle cx="5" cy="-1" r="2.3" fill="#C9B27E" />
        <line x1="7" y1="0" x2="11" y2="5" stroke="#C9B27E" strokeWidth="1.2" />
        <circle cx="12" cy={7 + Math.sin(phase * .3 + props.index) * 2} r="1.5" fill="#72DCF5" opacity=".8" />
      </g>}
    </g>;
  }

  return (
    <div style={{ padding: 12, minHeight: "100%", background: "linear-gradient(180deg,#091116,#080D10)", color: "#E8EEF2" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 850 }}>TROUGH WATERING</div>
          <div style={{ color: "#687982", fontSize: 8, marginTop: 2 }}>20 local level sensors · cattle demand · targeted refill manifold</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: statusColor, fontSize: 10, fontWeight: 800 }}>{status}</div>
          <div style={{ color: "#62737B", fontSize: 7 }}>{Math.round(average)}% average · {refillFlow.toFixed(0)} L/min refill</div>
        </div>
      </div>

      <div style={{ border: "1px solid #263B43", borderRadius: 11, background: "#071116", overflow: "hidden" }}>
        <svg width="100%" height="242" viewBox="0 0 520 242">
          <rect width="520" height="242" fill="#071116" />
          <path d="M25 28 L25 216" stroke="#2A6273" strokeWidth="6" strokeLinecap="round" />
          <path d="M25 28 L25 216" stroke="#55CAE9" strokeWidth="1.7" strokeLinecap="round" opacity={refilling > 0 ? .95 : .45} />
          {[52,99,146,193].map((y, row) => <g key={row}>
            <line x1="25" y1={y} x2="475" y2={y} stroke="#213D48" strokeWidth="2" />
            <text x="34" y={y - 9} fill="#536971" fontSize="6.5">PADDOCK {String.fromCharCode(65 + row)}</text>
          </g>)}
          {positions.map((pos, i) => <Trough key={i} index={i} x={pos.x} y={pos.y} />)}
          <g transform="translate(372 13)">
            <rect width="132" height="30" rx="7" fill="#0A171B" stroke="#28444D" />
            <text x="9" y="12" fill="#677B82" fontSize="6.5">HERD WATER USE TODAY</text>
            <text x="9" y="24" fill="#86E3F7" fontSize="10" fontFamily="monospace" fontWeight="700">{Math.round(consumptionToday).toLocaleString()} L</text>
            {lastDrink > 0 && <text x="82" y="24" fill="#A79062" fontSize="6.5">last drink {Math.round(lastDrink)} L</text>}
          </g>
          {drinkingHead > 0 && <text x="34" y="231" fill="#BDA66C" fontSize="7">{drinkingHead} head currently drinking · trough levels are physical simulator state</text>}
        </svg>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr .9fr .8fr", gap: 6, marginTop: 8 }}>
        <button onClick={() => aeolus.fire("simulate-drinking")} style={{ borderRadius: 8, padding: "8px 5px", border: "1px solid #5E5631", background: "#211D0F", color: "#DAC175", fontSize: 8, fontWeight: 750, cursor: "pointer" }}>Simulate herd drinking</button>
        <button onClick={() => aeolus.fire("refill-troughs")} disabled={low === 0 || refillCommandActive} style={{ borderRadius: 8, padding: "8px 5px", border: "1px solid " + (low > 0 ? "#2A6170" : "#303B40"), background: low > 0 ? "#102830" : "#151A1D", color: low > 0 ? "#7ADCF4" : "#69777C", fontSize: 8, cursor: low > 0 ? "pointer" : "not-allowed" }}>Refill low troughs</button>
        <button onClick={() => aeolus.fire("toggle-auto")} style={{ borderRadius: 8, padding: "8px 5px", border: "1px solid " + (auto ? "#315B45" : "#303B40"), background: auto ? "#10251A" : "#151A1D", color: auto ? "#82E3A0" : "#87949A", fontSize: 8, cursor: "pointer" }}>Auto {auto ? "ON" : "OFF"}</button>
        <button onClick={() => aeolus.fire("reset-troughs")} style={{ borderRadius: 8, padding: "8px 5px", border: "1px solid #303B40", background: "#151A1D", color: "#87949A", fontSize: 8, cursor: "pointer" }}>Reset</button>
      </div>
      <div style={{ color: "#63727A", fontSize: 8, marginTop: 7, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{actionLabel}</div>
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
    fireEvents: ["refill-troughs", "simulate-drinking", "toggle-auto", "reset-troughs"],
  },
};
