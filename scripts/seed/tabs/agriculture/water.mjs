const logic = `automation({
  actions: [
    async function waterManagement(context) {
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

      init("distributionActive", false);
      init("houseRefillActive", false);
      init("shedRefillActive", false);
      init("transferActive", false);
      init("transferStopping", false);
      init("transferMode", "idle");
      init("transferTargetLitres", 0);
      init("transferProgressLitres", 0);
      init("flowTotalLitres", 0);
      init("demoScenarioPending", "");
      init("energyAllowed", true);

      async function stopPump(reason) {
        if (Boolean(state.get("transferStopping"))) return;
        var pump = byTopic("switch/farm/dam-pump/state");
        var flow = byTopic("sensor/farm/transfer-flow");
        if (!pump || !flow) {
          setAction("Pump stop blocked: pump or flow sensor unavailable");
          return;
        }
        state.set("transferStopping", true);
        var result = await devices.action(
          pump.id,
          "command",
          { payload: { on: false } },
          {
            tier: "observed",
            deviceId: flow.id,
            condition: { field: "litresPerMinute", op: "eq", value: 0 },
            timeoutMs: 5000,
          }
        );
        state.set("transferStopping", false);
        if (result.success) {
          var delivered = Math.max(0, Number(state.get("transferProgressLitres")) || 0);
          state.set("lastTransferLitres", delivered);
          state.set("transferActive", false);
          state.set("transferMode", "idle");
          state.set("transferTargetLitres", 0);
          setAction("Transfer stopped · zero flow observed");
          events.emit("farm/water/transfer-stopped", { reason: reason, deliveredLitres: delivered, lifecycleState: result.lifecycleState });
        } else {
          setAction("Pump stop not verified: " + String(result.error || result.lifecycleState || "unknown"));
          events.emit("farm/water/transfer-failed", { stage: "stop", reason: result.error || "not verified", lifecycleState: result.lifecycleState });
        }
      }

      async function startTransfer(requestedLitres, source) {
        var pump = byTopic("switch/farm/dam-pump/state");
        var flow = byTopic("sensor/farm/transfer-flow");
        var header = byTopic("sensor/farm/header-tank");
        var dam = byTopic("sensor/farm/dam");
        var battery = byTopic("sensor/farm/energy/battery");
        if (!pump || !flow || !header || !dam) {
          setAction("Transfer blocked: water hardware unavailable");
          return;
        }

        var damPct = Number(dam.state && dam.state.value);
        var headerPct = Number(header.state && header.state.value);
        var soc = Number(battery && battery.state && battery.state.soc);
        var energyAllowed = !battery || battery.state.available !== false;

        if (!isNaN(damPct) && damPct <= 10) {
          setAction("Transfer blocked: source reserve low");
          events.emit("farm/water/transfer-blocked", { reason: "source reserve low", damPct: damPct });
          return;
        }
        if (!energyAllowed || (!isNaN(soc) && soc < 30)) {
          setAction("Transfer blocked: site energy reserve low");
          events.emit("farm/water/transfer-blocked", { reason: "site energy reserve low", soc: soc });
          return;
        }
        if (!isNaN(headerPct) && headerPct >= 95) {
          setAction("Transfer blocked: header tank already full");
          return;
        }
        if ((pump.state && pump.state.on) || Boolean(state.get("transferActive"))) {
          setAction("Transfer pump already running");
          return;
        }

        var requested = Math.max(100, Math.min(3000, Number(requestedLitres) || 500));
        var headerLitres = Math.max(0, Number(header.state && header.state.litres) || (isNaN(headerPct) ? 0 : headerPct * 50));
        var damLitres = Math.max(0, Number(dam.state && dam.state.litres) || (isNaN(damPct) ? 0 : damPct * 600));
        var headerHeadroom = Math.max(0, 5000 - headerLitres);
        var sourceAboveReserve = Math.max(0, damLitres - 6000);
        var litres = Math.floor(Math.min(requested, headerHeadroom, sourceAboveReserve));
        if (litres < 100) {
          setAction("Transfer blocked: insufficient safe source/headroom for a batch");
          return;
        }
        var startTotal = Math.max(0, Number(flow.state && flow.state.totalLitres) || 0);
        state.set("transferActive", true);
        state.set("transferMode", source === "automatic-header-recovery" ? "automatic" : "manual");
        state.set("transferTargetLitres", litres);
        state.set("transferStartTotalLitres", startTotal);
        state.set("transferProgressLitres", 0);
        setAction((source === "automatic-header-recovery" ? "Automatic recovery" : "Operator batch") + " · requesting " + litres + " L from lower dam");

        var result = await devices.action(
          pump.id,
          "command",
          { payload: { on: true, litres: litres } },
          {
            tier: "observed",
            deviceId: flow.id,
            condition: { field: "litresPerMinute", op: "gt", value: 0 },
            timeoutMs: 5000,
          }
        );
        if (result.success) {
          setAction((source === "automatic-header-recovery" ? "Automatic recovery" : litres + " L batch") + " running · flow verified");
          events.emit("farm/water/transfer-started", { litres: litres, source: source || "automation", lifecycleState: result.lifecycleState });
        } else {
          state.set("transferActive", false);
          state.set("transferMode", "idle");
          state.set("transferTargetLitres", 0);
          setAction("Transfer not verified: " + String(result.error || result.lifecycleState || "unknown"));
          events.emit("farm/water/transfer-failed", { stage: "start", reason: result.error || "not verified", lifecycleState: result.lifecycleState });
        }
      }

      async function refillZone(zone, tankTopic, valveTopic, targetPct) {
        var tank = byTopic(tankTopic);
        var valve = byTopic(valveTopic);
        if (!tank || !valve) return false;
        var current = Number(tank.state && tank.state.value);
        if (!isNaN(current) && current >= targetPct) return true;

        var key = zone === "house" ? "houseRefillActive" : "shedRefillActive";
        state.set(key, true);
        setAction((zone === "house" ? "House" : "Shed") + " tank low · opening header feed");
        var result = await devices.action(
          valve.id,
          "command",
          { payload: { on: true, targetPct: targetPct } },
          {
            tier: "observed",
            deviceId: tank.id,
            condition: { field: "value", op: "gte", value: targetPct - 0.5 },
            timeoutMs: 5000,
          }
        );
        state.set(key, false);
        if (result.success) {
          setAction((zone === "house" ? "House" : "Shed") + " tank recovered from header storage");
          events.emit("farm/water/downstream-refill-verified", { zone: zone, targetPct: targetPct, lifecycleState: result.lifecycleState });
          return true;
        }
        setAction((zone === "house" ? "House" : "Shed") + " refill not verified: " + String(result.error || result.lifecycleState || "unknown"));
        events.emit("farm/water/downstream-refill-failed", { zone: zone, lifecycleState: result.lifecycleState });
        return false;
      }

      async function reconcileDownstream() {
        if (Boolean(state.get("distributionActive"))) return;
        var header = byTopic("sensor/farm/header-tank");
        var house = byTopic("sensor/farm/house-tank");
        var shed = byTopic("sensor/farm/shed-tank");
        var headerPct = Number(header && header.state && header.state.value);
        var housePct = Number(house && house.state && house.state.value);
        var shedPct = Number(shed && shed.state && shed.state.value);
        var needHouse = !isNaN(housePct) && housePct < 55;
        var needShed = !isNaN(shedPct) && shedPct < 65;
        if ((!needHouse && !needShed) || (!isNaN(headerPct) && headerPct <= 20)) return;

        state.set("distributionActive", true);
        try {
          if (needHouse) await refillZone("house", "sensor/farm/house-tank", "switch/farm/house-fill/state", 75);
          if (needShed) await refillZone("shed", "sensor/farm/shed-tank", "switch/farm/shed-fill/state", 75);
        } finally {
          state.set("distributionActive", false);
        }
      }

      if (topic.indexOf("ui/") === 0) {
        if (evt === "transfer-500") await startTransfer(500, "operator");
        else if (evt === "transfer-1000") await startTransfer(1000, "operator");
        else if (evt === "pump-stop") await stopPump("operator");
        else if (evt === "simulate-header-low") {
          if (String(state.get("demoScenarioPending") || "")) return;
          state.set("demoScenarioPending", "header-drawdown");
          state.set("recoveryHoldUntil", Date.now() + 4000);
          events.emit("farm/sim/header-low", {});
          setAction("DEMO · injecting header-tank drawdown");
        } else if (evt === "simulate-property-demand") {
          if (String(state.get("demoScenarioPending") || "")) return;
          state.set("demoScenarioPending", "morning-demand");
          events.emit("farm/sim/property-water-demand", {});
          setAction("DEMO · injecting morning house + shed demand");
        } else if (evt === "reset-water") {
          events.emit("farm/sim/water-reset", {});
          state.set("recoveryHoldUntil", 0);
          state.set("distributionActive", false);
          state.set("houseRefillActive", false);
          state.set("shedRefillActive", false);
          state.set("transferActive", false);
          state.set("transferStopping", false);
          state.set("transferMode", "idle");
          state.set("transferTargetLitres", 0);
          state.set("transferProgressLitres", 0);
          state.set("demoScenarioPending", "");
          setAction("DEMO · water system reset to nominal");
        }
        return;
      }

      if (topic !== "sensor/farm/dam" &&
          topic !== "sensor/farm/header-tank" &&
          topic !== "sensor/farm/transfer-flow" &&
          topic !== "sensor/farm/shed-tank" &&
          topic !== "sensor/farm/house-tank" &&
          topic !== "sensor/farm/energy/battery") return;

      var pump = byTopic("switch/farm/dam-pump/state");
      var flow = byTopic("sensor/farm/transfer-flow");
      var header = byTopic("sensor/farm/header-tank");
      var dam = byTopic("sensor/farm/dam");
      var battery = byTopic("sensor/farm/energy/battery");
      var shed = byTopic("sensor/farm/shed-tank");
      var house = byTopic("sensor/farm/house-tank");

      var damPct = Number(dam && dam.state && dam.state.value);
      var headerPct = Number(header && header.state && header.state.value);
      var soc = Number(battery && battery.state && battery.state.soc);
      var pumpOn = Boolean(pump && pump.state && pump.state.on);
      var shedPct = Number(shed && shed.state && shed.state.value);
      var housePct = Number(house && house.state && house.state.value);
      var flowLpm = Number(flow && flow.state && flow.state.litresPerMinute);
      var flowTotal = Number(flow && flow.state && flow.state.totalLitres);
      var physicalBatchActive = Boolean(flow && flow.state && flow.state.batchActive);

      if (!isNaN(damPct)) state.set("damPct", damPct);
      if (!isNaN(headerPct)) state.set("headerPct", headerPct);
      if (!isNaN(shedPct)) state.set("shedPct", shedPct);
      if (!isNaN(housePct)) state.set("housePct", housePct);
      if (!isNaN(flowLpm)) state.set("flowLpm", flowLpm);
      if (!isNaN(flowTotal)) state.set("flowTotalLitres", flowTotal);
      state.set("pumpOn", pumpOn);
      if (!isNaN(soc)) state.set("batterySoc", soc);
      state.set("energyAllowed", !battery || (battery.state && battery.state.available !== false && (isNaN(soc) || soc >= 30)));

      var pendingScenario = String(state.get("demoScenarioPending") || "");
      if (pendingScenario === "header-drawdown" && topic === "sensor/farm/header-tank" && !isNaN(headerPct) && headerPct <= 30) {
        state.set("demoScenarioPending", "");
      } else if (pendingScenario === "morning-demand" &&
                 ((topic === "sensor/farm/house-tank" && !isNaN(housePct) && housePct <= 50) ||
                  (topic === "sensor/farm/shed-tank" && !isNaN(shedPct) && shedPct <= 60))) {
        state.set("demoScenarioPending", "");
      }

      var transferActive = Boolean(state.get("transferActive"));
      var transferTarget = Math.max(0, Number(state.get("transferTargetLitres")) || 0);
      var transferStart = Math.max(0, Number(state.get("transferStartTotalLitres")) || 0);
      if (transferActive && !isNaN(flowTotal)) {
        var progress = Math.max(0, flowTotal - transferStart);
        state.set("transferProgressLitres", progress);
        if (progress >= transferTarget - 1 && pumpOn && !Boolean(state.get("transferStopping"))) {
          state.set("transferActive", false);
          setAction("Batch target reached · stopping transfer at " + Math.round(progress) + " L");
          await stopPump("batch volume reached");
          pumpOn = false;
        } else if (!physicalBatchActive && !pumpOn && !isNaN(flowLpm) && flowLpm === 0 && progress > 0) {
          // Reconcile a device-side failsafe stop rather than leaving the UI in
          // an impossible forever-running batch state.
          state.set("lastTransferLitres", progress);
          state.set("transferActive", false);
          state.set("transferMode", "idle");
          state.set("transferTargetLitres", 0);
          setAction("Transfer ended at device · " + Math.round(progress) + " L observed");
        }
      }

      var sourceLowActive = Boolean(state.get("sourceLowActive"));
      if (!isNaN(damPct) && damPct <= 10 && !sourceLowActive) {
        state.set("sourceLowActive", true);
        setAction("Source water reserve low");
        events.emit("farm/water/source-low", { damPct: damPct });
      } else if (!isNaN(damPct) && damPct > 12 && sourceLowActive) {
        state.set("sourceLowActive", false);
      }

      await reconcileDownstream();
      header = byTopic("sensor/farm/header-tank");
      headerPct = Number(header && header.state && header.state.value);
      if (!isNaN(headerPct)) state.set("headerPct", headerPct);

      var recoveryHeld = Date.now() < (Number(state.get("recoveryHoldUntil")) || 0);
      var headerLowActive = Boolean(state.get("headerLowActive"));
      if (!isNaN(headerPct) && headerPct <= 30 && !headerLowActive && !recoveryHeld && !Boolean(state.get("distributionActive")) && !Boolean(state.get("transferActive")) && !pumpOn) {
        state.set("headerLowActive", true);
        var targetLitres = Math.max(500, Math.round((72 - headerPct) * 50));
        setAction("Header reserve low · automatic recovery requested");
        events.emit("farm/water/header-low", { headerPct: headerPct, damPct: damPct });
        await startTransfer(targetLitres, "automatic-header-recovery");
      } else if (!isNaN(headerPct) && headerPct > 35 && headerLowActive) {
        state.set("headerLowActive", false);
      }

      var mode = String(state.get("transferMode") || "idle");
      if (mode === "automatic" && !isNaN(headerPct) && headerPct >= 70 && pumpOn && !Boolean(state.get("transferStopping"))) {
        state.set("transferActive", false);
        setAction("Header recovery target reached · stopping transfer");
        await stopPump("header recovery target reached");
        pumpOn = false;
      } else if (!isNaN(headerPct) && headerPct >= 95 && pumpOn && !Boolean(state.get("transferStopping"))) {
        state.set("transferActive", false);
        setAction("Header high-level safety stop");
        await stopPump("header high-level safety");
        pumpOn = false;
      }

      var energyAllowed = !battery || battery.state.available !== false;
      if (pumpOn && (!energyAllowed || (!isNaN(soc) && soc < 30)) && !Boolean(state.get("transferStopping"))) {
        state.set("transferActive", false);
        setAction("Energy reserve low · stopping discretionary pump load");
        await stopPump("energy reserve protection");
      }
    },
  ],
});`;

const ui = `import { useEffect, useState } from "react";
import type { CustomComponentProps } from "./types";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function useSmooth(value: number) {
  const [display, setDisplay] = useState(value);
  useEffect(() => {
    let frame = 0;
    const from = display;
    const id = setInterval(() => {
      frame += 1;
      const t = Math.min(1, frame / 18);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (value - from) * eased);
      if (t >= 1) clearInterval(id);
    }, 45);
    return () => clearInterval(id);
  }, [value]);
  return display;
}

export default function WaterManagement(aeolus: CustomComponentProps) {
  const damTarget = clamp(Number(aeolus.read("damPct") ?? 82), 0, 100);
  const headerTarget = clamp(Number(aeolus.read("headerPct") ?? 65), 0, 100);
  const shedTarget = clamp(Number(aeolus.read("shedPct") ?? 72), 0, 100);
  const houseTarget = clamp(Number(aeolus.read("housePct") ?? 64), 0, 100);
  const dam = useSmooth(damTarget);
  const header = useSmooth(headerTarget);
  const shed = useSmooth(shedTarget);
  const house = useSmooth(houseTarget);
  const pumpOn = Boolean(aeolus.read("pumpOn"));
  const flow = Math.max(0, Number(aeolus.read("flowLpm") ?? 0));
  const batterySoc = clamp(Number(aeolus.read("batterySoc") ?? 78), 0, 100);
  const energyAllowed = aeolus.read("energyAllowed") !== false && batterySoc >= 30;
  const distributionActive = Boolean(aeolus.read("distributionActive"));
  const houseRefill = Boolean(aeolus.read("houseRefillActive"));
  const shedRefill = Boolean(aeolus.read("shedRefillActive"));
  const transferActive = Boolean(aeolus.read("transferActive"));
  const transferStopping = Boolean(aeolus.read("transferStopping"));
  const transferMode = String(aeolus.read("transferMode") ?? "idle");
  const transferTarget = Math.max(0, Number(aeolus.read("transferTargetLitres") ?? 0));
  const transferProgress = Math.max(0, Number(aeolus.read("transferProgressLitres") ?? 0));
  const totalizer = Math.max(0, Number(aeolus.read("flowTotalLitres") ?? 0));
  const lastTransfer = Math.max(0, Number(aeolus.read("lastTransferLitres") ?? 0));
  const demoScenarioPending = String(aeolus.read("demoScenarioPending") ?? "");
  const lastAction = aeolus.read("lastAction") as any;
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setPhase((value) => (value + 1) % 100000), 90);
    return () => clearInterval(id);
  }, []);

  const moving = pumpOn && flow > 0;
  const batchPct = transferTarget > 0 ? Math.max(0, Math.min(100, transferProgress / transferTarget * 100)) : 0;
  const operatorBusy = pumpOn || transferActive || transferStopping;
  const demoBusy = operatorBusy || distributionActive || houseRefill || shedRefill || demoScenarioPending.length > 0;
  const actionLabel = lastAction?.label ? String(lastAction.label) : "Water system online";

  function Tank(props: { x: number; y: number; w: number; h: number; label: string; value: number; litresPerPct: number; accent?: string }) {
    const fill = Math.max(5, (props.h - 10) * props.value / 100);
    const accent = props.accent || "#42C9EA";
    return <g transform={"translate(" + props.x + " " + props.y + ")"}>
      <rect width={props.w} height={props.h} rx="10" fill="#0A171A" stroke="#405E64" strokeWidth="1.2" />
      <rect x="5" y={props.h - 5 - fill} width={props.w - 10} height={fill} rx="6" fill={accent} opacity=".58" />
      <line x1="7" x2={props.w - 7} y1={props.h * .35} y2={props.h * .35} stroke="#6A8388" strokeOpacity=".22" strokeDasharray="3 4" />
      <text x={props.w / 2} y="-7" textAnchor="middle" fill="#7C9297" fontSize="10" letterSpacing="1">{props.label}</text>
      <text x={props.w / 2} y={props.h / 2 + 4} textAnchor="middle" fill="#E9FAFE" fontSize={props.w > 75 ? "18" : "13"} fontFamily="monospace" fontWeight="800">{Math.round(props.value)}%</text>
      <text x={props.w / 2} y={props.h / 2 + 18} textAnchor="middle" fill="#68878E" fontSize="10">{Math.round(props.value * props.litresPerPct).toLocaleString()} L</text>
    </g>;
  }

  function PulseLine(props: { path: string; active: boolean; color?: string }) {
    const color = props.color || "#4BD9F6";
    return <g>
      <path d={props.path} fill="none" stroke="#243A3F" strokeWidth="7" strokeLinecap="round" />
      <path d={props.path} fill="none" stroke={props.active ? color : "#40585D"} strokeWidth="2.2" strokeLinecap="round" />
      {props.active && Array.from({ length: 5 }).map((_, i) => {
        const offset = ((phase * 4 + i * 19) % 100);
        return <path key={i} d={props.path} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeDasharray="1 99" strokeDashoffset={-offset} opacity=".9" />;
      })}
    </g>;
  }

  return (
    <div style={{ padding: 12, minHeight: "100%", color: "#E8EEF2", background: "linear-gradient(180deg,#081315,#071012 58%,#070C0D)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 850 }}>WATER MANAGEMENT</div>
          <div style={{ color: "#657A7F", fontSize:11, marginTop: 2 }}>Dam transfer · header reserve · house & shed distribution</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: moving ? "#78E6FF" : pumpOn ? "#F1C06B" : "#7C8F91", fontSize:11, fontWeight: 800 }}>{transferStopping ? "STOPPING" : moving ? (transferMode === "automatic" ? "AUTO RECOVERY" : "BATCH TRANSFER") : pumpOn ? "PUMP ON · WAITING FLOW" : distributionActive ? "DISTRIBUTING" : "SYSTEM BALANCED"}</div>
          <div style={{ color: "#596D70", fontSize:11, marginTop: 2 }}>{flow.toFixed(0)} L/min · totalizer {Math.round(totalizer).toLocaleString()} L</div>
        </div>
      </div>

      <div style={{ border: "1px solid #243B40", borderRadius: 12, overflow: "hidden", background: "#071114" }}>
        <svg width="100%" height="278" viewBox="0 0 620 278" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="water-ground" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#0D211B"/><stop offset="1" stopColor="#10271F"/></linearGradient>
            <filter id="water-glow"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          </defs>
          <rect width="620" height="278" fill="#071114" />
          <path d="M0 208 C120 170 214 180 300 142 C390 103 485 116 620 86 L620 278 L0 278 Z" fill="url(#water-ground)" />

          <Tank x={30} y={156} w={128} h={82} label="LOWER DAM" value={dam} litresPerPct={600} accent="#268FB3" />
          <PulseLine path="M158 199 C215 194 236 169 276 126 C310 90 345 82 386 82" active={moving} />
          <g transform="translate(220 174)">
            <circle r="23" fill="#09181B" stroke={pumpOn ? "#51D5F5" : "#3D5358"} strokeWidth="2" />
            <g style={{ transform: "rotate(" + (moving ? phase * 10 : 0) + "deg)", transformOrigin: "0px 0px" }}><path d="M0 -12 L4 -3 L12 0 L4 3 L0 12 L-4 3 L-12 0 L-4 -3 Z" fill={pumpOn ? "#70E2F7" : "#52666B"}/></g>
            <text x="0" y="36" textAnchor="middle" fill="#70868A" fontSize="10">TRANSFER</text>
          </g>

          <Tank x={366} y={38} w={102} h={128} label="HEADER" value={header} litresPerPct={50} accent="#38BFE4" />
          <PulseLine path="M417 166 C432 190 470 192 495 201" active={shedRefill} color="#66DCF5" />
          <PulseLine path="M417 166 C455 179 536 169 563 184" active={houseRefill} color="#66DCF5" />
          <Tank x={470} y={190} w={62} h={62} label="SHED" value={shed} litresPerPct={80} accent="#318CAC" />
          <Tank x={544} y={176} w={62} h={76} label="HOUSE" value={house} litresPerPct={40} accent="#318CAC" />

          <g transform="translate(483 170)"><circle r="7" fill={shedRefill ? "#4ED8F4" : "#18292D"} stroke="#4B676D"/><text x="0" y="2.5" textAnchor="middle" fill="#D9F8FE" fontSize="10">V</text></g>
          <g transform="translate(551 158)"><circle r="7" fill={houseRefill ? "#4ED8F4" : "#18292D"} stroke="#4B676D"/><text x="0" y="2.5" textAnchor="middle" fill="#D9F8FE" fontSize="10">V</text></g>

          {moving && Array.from({ length: 5 }).map((_, i) => <circle key={i} cx={178 + ((phase * 3 + i * 39) % 185)} cy={190 - ((phase * 3 + i * 39) % 185) * .48} r="2.1" fill="#9AF0FF" opacity=".9" filter="url(#water-glow)" />)}

          <text x="309" y="269" textAnchor="middle" fill="#50666B" fontSize="10">Header gravity feeds local storage · each refill is verified against the destination tank sensor</text>
        </svg>
      </div>

      {transferTarget > 0 && <div style={{ marginTop: 8, padding: "7px 9px", border: "1px solid #234651", borderRadius: 8, background: "#09191E" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize:11, color: "#718B91", marginBottom: 5 }}>
          <span>{transferMode === "automatic" ? "AUTOMATIC HEADER RECOVERY" : "OPERATOR BATCH"}</span>
          <span>{Math.min(transferTarget, transferProgress).toFixed(0)} / {transferTarget.toFixed(0)} L</span>
        </div>
        <div style={{ height: 5, borderRadius: 5, background: "#173038", overflow: "hidden" }}><div style={{ width: batchPct + "%", height: "100%", background: "#55D6F3" }} /></div>
      </div>}

      <div style={{ marginTop: 8, padding: 8, border: "1px solid #244650", borderRadius: 9, background: "#0A171B" }}>
        <div style={{ color: "#6E858B", fontSize:11, fontWeight: 800, letterSpacing: 1, marginBottom: 6 }}>OPERATOR CONTROLS</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 5 }}>
          <button onClick={() => aeolus.fire("transfer-500")} disabled={operatorBusy || !energyAllowed} style={{ borderRadius: 7, padding: "7px 4px", border: "1px solid " + (!operatorBusy && energyAllowed ? "#27586A" : "#2C393D"), background: !operatorBusy && energyAllowed ? "#0C2630" : "#12191B", color: !operatorBusy && energyAllowed ? "#79DDF5" : "#5B686C", fontSize:11, fontWeight: 750, cursor: !operatorBusy && energyAllowed ? "pointer" : "not-allowed" }}>Transfer 500 L</button>
          <button onClick={() => aeolus.fire("transfer-1000")} disabled={operatorBusy || !energyAllowed} style={{ borderRadius: 7, padding: "7px 4px", border: "1px solid " + (!operatorBusy && energyAllowed ? "#27586A" : "#2C393D"), background: !operatorBusy && energyAllowed ? "#0C2630" : "#12191B", color: !operatorBusy && energyAllowed ? "#79DDF5" : "#5B686C", fontSize:11, fontWeight: 750, cursor: !operatorBusy && energyAllowed ? "pointer" : "not-allowed" }}>Transfer 1000 L</button>
          <button onClick={() => aeolus.fire("pump-stop")} disabled={!pumpOn || transferStopping} style={{ borderRadius: 7, padding: "7px 4px", border: "1px solid " + (pumpOn ? "#6A3B34" : "#2C3638"), background: pumpOn ? "#281713" : "#111718", color: pumpOn ? "#F39B8C" : "#566366", fontSize:11, cursor: pumpOn && !transferStopping ? "pointer" : "not-allowed" }}>{transferStopping ? "Stopping…" : "Stop transfer"}</button>
        </div>
      </div>

      <div style={{ marginTop: 7, padding: 8, border: "1px dashed #5B4E2F", borderRadius: 9, background: "#17150D" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div><div style={{ color: "#C8AA62", fontSize:11, fontWeight: 850, letterSpacing: 1 }}>DEMO SCENARIO</div><div style={{ color: "#766D54", fontSize:11, marginTop: 2 }}>Injects external physical conditions. These are not normal operator controls.</div></div>
          {demoScenarioPending && <div style={{ color: "#D7B968", fontSize:11 }}>INJECTING…</div>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr .7fr", gap: 5 }}>
          <button onClick={() => aeolus.fire("simulate-header-low")} disabled={demoBusy} style={{ borderRadius: 7, padding: "7px 4px", border: "1px solid #5C4D2A", background: "#221C0E", color: demoBusy ? "#756C50" : "#D8BD6B", fontSize:11, cursor: demoBusy ? "not-allowed" : "pointer" }}>Header drawdown</button>
          <button onClick={() => aeolus.fire("simulate-property-demand")} disabled={demoBusy} style={{ borderRadius: 7, padding: "7px 4px", border: "1px solid #4D5630", background: "#19200E", color: demoBusy ? "#687052" : "#BACE78", fontSize:11, cursor: demoBusy ? "not-allowed" : "pointer" }}>Morning demand</button>
          <button onClick={() => aeolus.fire("reset-water")} style={{ borderRadius: 7, padding: "7px 4px", border: "1px solid #3D3A30", background: "#171713", color: "#8D8878", fontSize:11, cursor: "pointer" }}>Reset demo</button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center", marginTop: 7 }}>
        <div style={{ color: "#677A7E", fontSize:11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{actionLabel}{lastTransfer > 0 && !operatorBusy ? " · last batch " + Math.round(lastTransfer) + " L" : ""}</div>
        <div style={{ borderRadius: 999, padding: "2px 7px", border: "1px solid " + (energyAllowed ? "#31533A" : "#69462F"), background: energyAllowed ? "#102118" : "#25170F", color: energyAllowed ? "#78D890" : "#E6A16B", fontSize:11 }}>ENERGY {energyAllowed ? "PERMITTED" : "HELD"} · {Math.round(batterySoc)}%</div>
      </div>
    </div>
  );
}`;

export const waterAutomation = {
  key: "farm-water",
  name: "Water Management",
  triggerTopic: "sensor/farm/#",
  scriptSource: logic,
  uiSource: ui,
  demoAccess: {
    fireEvents: ["transfer-500", "transfer-1000", "pump-stop", "simulate-header-low", "simulate-property-demand", "reset-water"],
  },
};
