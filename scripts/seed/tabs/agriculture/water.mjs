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

      var pump = byTopic("switch/farm/dam-pump/state");
      var flow = byTopic("sensor/farm/transfer-flow");
      var header = byTopic("sensor/farm/header-tank");
      var dam = byTopic("sensor/farm/dam");
      var battery = byTopic("sensor/farm/energy/battery");

      async function stopPump(reason) {
        if (!pump || !flow) {
          setAction("Pump stop blocked: pump or flow sensor unavailable");
          return;
        }
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
        if (result.success) {
          setAction("Pump stopped · zero flow observed");
          events.emit("farm/water/transfer-stopped", { reason: reason, lifecycleState: result.lifecycleState });
        } else {
          setAction("Pump stop not verified: " + String(result.error || result.lifecycleState || "unknown"));
          events.emit("farm/water/transfer-failed", { stage: "stop", reason: result.error || "not verified", lifecycleState: result.lifecycleState });
        }
      }

      async function startTransfer(requestedLitres, source) {
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
        if (pump.state && pump.state.on) {
          setAction("Transfer pump already running");
          return;
        }

        var litres = Math.max(100, Math.min(3000, Number(requestedLitres) || 500));
        setAction("Requesting " + litres + " L transfer");
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
          setAction("Transfer verified · flow observed");
          events.emit("farm/water/transfer-started", { litres: litres, source: source || "automation", lifecycleState: result.lifecycleState });
        } else {
          setAction("Transfer not verified: " + String(result.error || result.lifecycleState || "unknown"));
          events.emit("farm/water/transfer-failed", { stage: "start", reason: result.error || "not verified", lifecycleState: result.lifecycleState });
        }
      }

      // Bounded operator/demo inputs belong to this automation itself. The only
      // simulator interaction is a reserved Automation Event representing an
      // external-world stimulus; physical state still comes back over MQTT.
      if (topic.indexOf("ui/") === 0) {
        if (evt === "transfer-500") await startTransfer(500, "operator");
        else if (evt === "transfer-1000") await startTransfer(1000, "operator");
        else if (evt === "pump-stop") await stopPump("operator");
        else if (evt === "simulate-header-low") {
          // Briefly hold off auto-recovery so the drawdown is visibly readable
          // before the automation refills. The simulator re-asserts the low
          // level after this window, re-triggering this automation to recover.
          state.set("recoveryHoldUntil", Date.now() + 4000);
          events.emit("farm/sim/header-low", {});
          setAction("Simulating header-tank drawdown");
        } else if (evt === "reset-water") {
          events.emit("farm/sim/water-reset", {});
          state.set("recoveryHoldUntil", 0);
          setAction("Resetting water system to nominal");
        }
        return;
      }

      // This single first-class automation owns both sensing and control for the
      // bulk-water domain. Its MQTT trigger is intentionally broad enough to see
      // water sensors plus the site battery used as a physical preflight input.
      if (topic !== "sensor/farm/dam" &&
          topic !== "sensor/farm/header-tank" &&
          topic !== "sensor/farm/transfer-flow" &&
          topic !== "sensor/farm/shed-tank" &&
          topic !== "sensor/farm/house-tank" &&
          topic !== "sensor/farm/energy/battery") return;

      var shed = byTopic("sensor/farm/shed-tank");
      var house = byTopic("sensor/farm/house-tank");

      var damPct = Number(dam && dam.state && dam.state.value);
      var headerPct = Number(header && header.state && header.state.value);
      var soc = Number(battery && battery.state && battery.state.soc);
      var pumpOn = Boolean(pump && pump.state && pump.state.on);
      var shedPct = Number(shed && shed.state && shed.state.value);
      var housePct = Number(house && house.state && house.state.value);
      var flowLpm = Number(flow && flow.state && flow.state.litresPerMinute);

      // UI projection: mirror ONLY observed device state into this automation's
      // own state — never a fabricated value. The non-admin demo user is not
      // granted direct device visibility, so the custom UI reads these keys via
      // aeolus.read() instead of aeolus.devices. pumpOn is the OBSERVED switch
      // state (published by the simulator after the command's physical effect),
      // not an optimistic echo of the button press. Guards prevent a missing
      // reading from overwriting a good projection with NaN.
      if (!isNaN(damPct)) state.set("damPct", damPct);
      if (!isNaN(headerPct)) state.set("headerPct", headerPct);
      if (!isNaN(shedPct)) state.set("shedPct", shedPct);
      if (!isNaN(housePct)) state.set("housePct", housePct);
      if (!isNaN(flowLpm)) state.set("flowLpm", flowLpm);
      state.set("pumpOn", pumpOn);
      if (!isNaN(soc)) state.set("batterySoc", soc);
      state.set("energyAllowed", !battery || (battery.state && battery.state.available !== false && (isNaN(soc) || soc >= 30)));

      var sourceLowActive = Boolean(state.get("sourceLowActive"));
      if (!isNaN(damPct) && damPct <= 10 && !sourceLowActive) {
        state.set("sourceLowActive", true);
        setAction("Source water reserve low");
        events.emit("farm/water/source-low", { damPct: damPct });
      } else if (!isNaN(damPct) && damPct > 12 && sourceLowActive) {
        state.set("sourceLowActive", false);
      }

      // While the manual-drawdown hold window is open, leave the low level in
      // place so it is legible in the UI; the simulator re-triggers this
      // automation once the window closes, and recovery proceeds then.
      var recoveryHeld = Date.now() < (Number(state.get("recoveryHoldUntil")) || 0);
      var headerLowActive = Boolean(state.get("headerLowActive"));
      if (!isNaN(headerPct) && headerPct <= 30 && !headerLowActive && !recoveryHeld) {
        state.set("headerLowActive", true);
        var targetLitres = Math.max(500, Math.round((75 - headerPct) * 50));
        setAction("Header tank low · automatic transfer requested");
        events.emit("farm/water/header-low", { headerPct: headerPct, damPct: damPct });
        await startTransfer(targetLitres, "automatic-header-recovery");
      } else if (!isNaN(headerPct) && headerPct > 35 && headerLowActive) {
        state.set("headerLowActive", false);
      }

      var satisfiedActive = Boolean(state.get("headerSatisfiedActive"));
      if (!isNaN(headerPct) && headerPct >= 70 && pumpOn && !satisfiedActive) {
        state.set("headerSatisfiedActive", true);
        setAction("Header target reached · stopping transfer");
        await stopPump("header target reached");
      } else if ((!pumpOn || (!isNaN(headerPct) && headerPct < 65)) && satisfiedActive) {
        state.set("headerSatisfiedActive", false);
      }

      var energyAllowed = !battery || battery.state.available !== false;
      if (pumpOn && (!energyAllowed || (!isNaN(soc) && soc < 30))) {
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

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export default function WaterManagement(aeolus: CustomComponentProps) {
  // A non-admin demo user is not granted direct device visibility, so this UI
  // reads the automation's own projection state (mirrored from observed device
  // state by the Logic) rather than the raw device inventory.
  const sharedDam = clamp(Number(aeolus.read("damPct") ?? 82), 0, 100);
  const sharedHeader = clamp(Number(aeolus.read("headerPct") ?? 65), 0, 100);
  const shed = clamp(Number(aeolus.read("shedPct") ?? 78), 0, 100);
  const house = clamp(Number(aeolus.read("housePct") ?? 55), 0, 100);
  const pumpOn = Boolean(aeolus.read("pumpOn"));
  const flow = Math.max(0, Number(aeolus.read("flowLpm") ?? 0));
  const batterySoc = clamp(Number(aeolus.read("batterySoc") ?? 78), 0, 100);
  const energyAllowed = aeolus.read("energyAllowed") !== false && batterySoc >= 30;
  const lastAction = aeolus.read("lastAction") as any;

  const [dam, setDam] = useState(sharedDam);
  const [header, setHeader] = useState(sharedHeader);
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    let frame = 0;
    const fromDam = dam;
    const fromHeader = header;
    const id = setInterval(() => {
      frame += 1;
      const t = Math.min(1, frame / 20);
      const eased = 1 - Math.pow(1 - t, 3);
      setDam(lerp(fromDam, sharedDam, eased));
      setHeader(lerp(fromHeader, sharedHeader, eased));
      if (t >= 1) clearInterval(id);
    }, 45);
    return () => clearInterval(id);
  }, [sharedDam, sharedHeader]);

  useEffect(() => {
    const id = setInterval(() => setPhase((value) => (value + 1) % 100000), 90);
    return () => clearInterval(id);
  }, []);

  const moving = pumpOn && flow > 0;
  const actionLabel = lastAction?.label ? String(lastAction.label) : "Water system online";
  const headerFillY = 65 + (1 - header / 100) * 105;
  const damFillY = 170 + (1 - dam / 100) * 58;

  function SmallTank(props: { x: number; label: string; value: number }) {
    const fillY = 192 + (1 - props.value / 100) * 42;
    return <g transform={"translate(" + props.x + " 0)"}>
      <rect x="0" y="184" width="58" height="58" rx="9" fill="#0B1718" stroke="#38565A" />
      <rect x="5" y={fillY} width="48" height={Math.max(4, 237 - fillY)} rx="5" fill="#247FA4" opacity="0.75" />
      <text x="29" y="178" textAnchor="middle" fill="#74878A" fontSize="7" letterSpacing="1">{props.label}</text>
      <text x="29" y="218" textAnchor="middle" fill="#D9F3FA" fontSize="12" fontFamily="monospace" fontWeight="700">{Math.round(props.value)}%</text>
    </g>;
  }

  return (
    <div style={{ padding: 12, minHeight: "100%", color: "#E8EEF2", background: "linear-gradient(180deg,#081315,#071012 58%,#070C0D)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ fontSize: 13, fontWeight: 850, letterSpacing: ".02em" }}>WATER MANAGEMENT</span>
            <span style={{ padding: "2px 6px", borderRadius: 999, border: "1px solid #284D57", background: "#0B2229", color: "#76DDF4", fontSize: 7, letterSpacing: ".09em" }}>AUTOMATION</span>
          </div>
          <div style={{ color: "#657A7F", fontSize: 8, marginTop: 2 }}>Dam → transfer pump → header storage</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: moving ? "#78E6FF" : pumpOn ? "#F1C06B" : "#7C8F91", fontSize: 9, fontWeight: 800 }}>{moving ? "FLOW OBSERVED" : pumpOn ? "PUMP ON · WAITING FLOW" : "TRANSFER IDLE"}</div>
          <div style={{ color: "#596D70", fontSize: 7, marginTop: 2 }}>{flow.toFixed(0)} L/min</div>
        </div>
      </div>

      <div style={{ border: "1px solid #243B40", borderRadius: 12, overflow: "hidden", background: "#071114" }}>
        <svg width="100%" height="270" viewBox="0 0 600 270" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="wm-water" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#66E3FF" />
              <stop offset="1" stopColor="#176E9F" />
            </linearGradient>
            <linearGradient id="wm-ground" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#0E211C" />
              <stop offset="1" stopColor="#10251D" />
            </linearGradient>
            <filter id="wm-glow"><feGaussianBlur stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          </defs>

          <rect width="600" height="270" fill="#071114" />
          <path d="M0 185 C105 152 192 162 270 132 C362 97 453 110 600 73 L600 270 L0 270 Z" fill="url(#wm-ground)" />

          {/* Lower dam */}
          <path d="M25 185 C54 156 133 153 172 182 C184 205 163 239 103 244 C49 248 21 226 25 185 Z" fill="#092C3B" stroke="#2B758F" strokeWidth="1.4" />
          <path d={"M29 " + damFillY + " C66 " + (damFillY - 12) + " 127 " + (damFillY - 14) + " 169 " + (damFillY + 2) + " L166 231 C119 244 57 242 33 225 Z"} fill="url(#wm-water)" opacity=".82" />
          <text x="100" y="177" textAnchor="middle" fill="#8FBAC7" fontSize="7" letterSpacing="1.2">LOWER DAM</text>
          <text x="100" y="204" textAnchor="middle" fill="#E9FAFF" fontSize="18" fontFamily="monospace" fontWeight="800">{Math.round(dam)}%</text>
          <text x="100" y="217" textAnchor="middle" fill="#65909C" fontSize="7">{Math.round(dam * 600).toLocaleString()} L</text>

          {/* Rising main */}
          <path d="M171 196 C220 190 238 169 267 139 C302 103 332 92 376 92" fill="none" stroke="#1F3237" strokeWidth="9" strokeLinecap="round" />
          <path d="M171 196 C220 190 238 169 267 139 C302 103 332 92 376 92" fill="none" stroke={moving ? "#39BDE8" : "#35545D"} strokeWidth="2.5" strokeLinecap="round" />
          {moving && Array.from({ length: 7 }).map((_, i) => {
            const t = (phase * .018 + i / 7) % 1;
            const x = 171 + t * 205;
            const y = 196 - t * 104 - Math.sin(t * Math.PI) * 15;
            return <circle key={i} cx={x} cy={y} r="2.3" fill="#8BEAFF" filter="url(#wm-glow)" />;
          })}

          {/* Pump */}
          <g transform="translate(206 171)">
            <circle r="24" fill="#0B171A" stroke={pumpOn ? "#4BCBEF" : "#40545A"} strokeWidth="2" />
            <circle r="15" fill="#0F2328" stroke="#52676D" />
            <g style={{ transform: "rotate(" + (moving ? phase * 10 : 0) + "deg)", transformOrigin: "0px 0px" }}>
              <path d="M0 -12 L4 -3 L12 0 L4 3 L0 12 L-4 3 L-12 0 L-4 -3 Z" fill={pumpOn ? "#65DDF6" : "#52666B"} />
            </g>
            <text x="0" y="37" textAnchor="middle" fill="#6E8489" fontSize="7">TRANSFER PUMP</text>
          </g>

          {/* Header tank */}
          <g transform="translate(374 32)">
            <ellipse cx="70" cy="18" rx="48" ry="13" fill="#132429" stroke="#52727A" />
            <rect x="22" y="18" width="96" height="135" fill="#102027" stroke="#52727A" />
            <ellipse cx="70" cy="153" rx="48" ry="13" fill="#102027" stroke="#52727A" />
            <rect x="27" y={headerFillY - 32} width="86" height={Math.max(6, 176 - headerFillY)} fill="#237EA6" opacity=".72" />
            <ellipse cx="70" cy={headerFillY - 32} rx="43" ry="9" fill="#57D4F2" opacity=".72" />
            <text x="70" y="64" textAnchor="middle" fill="#85A8B0" fontSize="7" letterSpacing="1.1">HEADER TANK</text>
            <text x="70" y="91" textAnchor="middle" fill="#F0FBFE" fontSize="22" fontFamily="monospace" fontWeight="800">{Math.round(header)}%</text>
            <text x="70" y="107" textAnchor="middle" fill="#6D939C" fontSize="7">{Math.round(header * 50).toLocaleString()} L</text>
          </g>

          {/* Other water stores: context only within the water domain. */}
          <SmallTank x={472} label="SHED" value={shed} />
          <SmallTank x={536} label="HOUSE" value={house} />

          <text x="300" y="258" textAnchor="middle" fill="#4E6468" fontSize="7">Physical tank + flow state arrives over MQTT · pump actions use verified command execution</text>
        </svg>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: 5, marginTop: 8 }}>
        <button onClick={() => aeolus.fire("transfer-500")} style={{ borderRadius: 7, padding: "7px 4px", border: "1px solid #27586A", background: "#0C2630", color: "#79DDF5", fontSize: 8, fontWeight: 750, cursor: "pointer" }}>+500 L</button>
        <button onClick={() => aeolus.fire("transfer-1000")} style={{ borderRadius: 7, padding: "7px 4px", border: "1px solid #27586A", background: "#0C2630", color: "#79DDF5", fontSize: 8, fontWeight: 750, cursor: "pointer" }}>+1000 L</button>
        <button onClick={() => aeolus.fire("pump-stop")} disabled={!pumpOn} style={{ borderRadius: 7, padding: "7px 4px", border: "1px solid " + (pumpOn ? "#6A3B34" : "#2C3638"), background: pumpOn ? "#281713" : "#111718", color: pumpOn ? "#F39B8C" : "#566366", fontSize: 8, cursor: pumpOn ? "pointer" : "not-allowed" }}>Stop</button>
        <button onClick={() => aeolus.fire("simulate-header-low")} style={{ borderRadius: 7, padding: "7px 4px", border: "1px solid #5C4D2A", background: "#221C0E", color: "#D8BD6B", fontSize: 8, cursor: "pointer" }}>Drawdown</button>
        <button onClick={() => aeolus.fire("reset-water")} style={{ borderRadius: 7, padding: "7px 4px", border: "1px solid #303B3D", background: "#12191A", color: "#7A898C", fontSize: 8, cursor: "pointer" }}>Reset</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center", marginTop: 7 }}>
        <div style={{ color: "#677A7E", fontSize: 8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{actionLabel}</div>
        <div style={{ borderRadius: 999, padding: "2px 7px", border: "1px solid " + (energyAllowed ? "#31533A" : "#69462F"), background: energyAllowed ? "#102118" : "#25170F", color: energyAllowed ? "#78D890" : "#E6A16B", fontSize: 7 }}>ENERGY {energyAllowed ? "PERMITTED" : "HELD"} · {Math.round(batterySoc)}%</div>
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
    fireEvents: ["transfer-500", "transfer-1000", "pump-stop", "simulate-header-low", "reset-water"],
  },
};
