const logic = `automation({
  actions: [
    async function livestockAndFence(context) {
      var topic = String(context.topic || "");
      var evt = topic.split("/").pop();

      function byTopic(wanted) {
        return devices.list().find(function(d) { return d.topic === wanted; });
      }
      function setAction(label) {
        state.set("lastAction", { label: label, at: Date.now() });
      }

      if (topic.indexOf("ui/") === 0) {
        if (evt === "simulate-strays") {
          events.emit("farm/sim/livestock-boundary-breach", {});
          setAction("Simulating an east-boundary crossing");
        } else if (evt === "move-herd") {
          events.emit("farm/sim/livestock-move-herd", {});
          setAction("Simulating a paddock rotation");
        } else if (evt === "simulate-fence-fault") {
          events.emit("farm/sim/livestock-fence-fault", {});
          setAction("Simulating perimeter energiser fault");
        } else if (evt === "restore-fence") {
          events.emit("farm/sim/livestock-fence-restore", {});
          setAction("Restoring perimeter energiser");
        } else if (evt === "reset-livestock") {
          events.emit("farm/sim/livestock-reset", {});
          state.set("recallInProgress", false);
          setAction("Resetting livestock system to nominal");
        } else if (evt === "recall-strays") {
          var recall = byTopic("switch/fence/recall/state");
          var collars = byTopic("sensor/fence/collars");
          if (!recall || !collars) {
            setAction("Recall blocked: collar or recall hardware unavailable");
            return;
          }
          state.set("recallInProgress", true);
          setAction("Recall dispatched · waiting for collars to return inside boundary");
          var result = await devices.action(
            recall.id,
            "command",
            { payload: { active: true } },
            {
              tier: "observed",
              deviceId: collars.id,
              condition: { field: "strays", op: "eq", value: 0 },
              timeoutMs: 5000,
            }
          );
          state.set("recallInProgress", false);
          if (result.success) {
            setAction("Recall verified · herd contained");
            events.emit("farm/livestock/recall-verified", { lifecycleState: result.lifecycleState });
          } else {
            setAction("Recall not verified: " + String(result.error || result.lifecycleState || "unknown"));
            events.emit("farm/livestock/recall-failed", { reason: result.error || "not observed", lifecycleState: result.lifecycleState });
          }
        }
        return;
      }

      if (topic !== "sensor/fence/collars" && topic !== "sensor/fence/energiser") return;

      if (topic === "sensor/fence/collars") {
        var strays = Math.max(0, Number(context.state && context.state.strays) || 0);
        var herd = Math.max(0, Number(context.state && context.state.herd) || 0);
        var tracked = Math.max(0, Number(context.state && context.state.tracked) || 0);
        var avgBattery = Math.max(0, Math.min(100, Number(context.state && context.state.avgBattery) || 0));
        var paddock = String(context.state && context.state.paddock || "A");
        var breachSector = String(context.state && context.state.breachSector || "");
        var movement = String(context.state && context.state.movement || "grazing");
        state.set("strays", strays);
        state.set("herd", herd);
        state.set("tracked", tracked);
        state.set("avgBattery", avgBattery);
        state.set("paddock", paddock);
        state.set("breachSector", breachSector);
        state.set("movement", movement);
        if (state.get("recallInProgress") === undefined) state.set("recallInProgress", false);

        var previous = Number(state.get("lastStrays"));
        state.set("lastStrays", strays);
        if (strays > 0 && previous !== strays) {
          setAction(strays + " collars outside the virtual boundary · " + (breachSector || "sector unknown"));
          events.emit("farm/livestock/breach", { strays: strays, herd: herd, tracked: tracked, sector: breachSector });
        } else if (strays === 0 && previous > 0) {
          setAction("Herd contained · all tracked collars inside boundary");
          events.emit("farm/livestock/contained", { herd: herd, tracked: tracked, paddock: paddock });
        }
      } else {
        var voltage = Number(context.state && context.state.voltage);
        var current = Number(context.state && context.state.current);
        var fault = Boolean(context.state && context.state.fault === true);
        if (!isNaN(voltage)) state.set("voltage", voltage);
        if (!isNaN(current)) state.set("fenceCurrent", current);
        state.set("fenceFault", fault);
        var previousFault = Boolean(state.get("lastFenceFault"));
        state.set("lastFenceFault", fault);
        if (fault && !previousFault) {
          setAction("Perimeter energiser fault · physical boundary protection degraded");
          events.emit("farm/livestock/fence-fault", { voltage: voltage });
        } else if (!fault && previousFault) {
          setAction("Perimeter energiser restored");
          events.emit("farm/livestock/fence-restored", { voltage: voltage });
        }
      }
    },
  ],
});`;

const ui = `import { useEffect, useMemo, useState } from "react";
import type { CustomComponentProps } from "./types";

export default function LivestockFence(aeolus: CustomComponentProps) {
  const strays = Math.max(0, Number(aeolus.read("strays") ?? 0));
  const herd = Math.max(0, Number(aeolus.read("herd") ?? 30));
  const tracked = Math.max(0, Number(aeolus.read("tracked") ?? 30));
  const avgBattery = Math.max(0, Math.min(100, Number(aeolus.read("avgBattery") ?? 74)));
  const paddock = String(aeolus.read("paddock") ?? "A");
  const breachSector = String(aeolus.read("breachSector") ?? "");
  const movement = String(aeolus.read("movement") ?? "grazing");
  const voltage = Number(aeolus.read("voltage") ?? 7.2);
  const fenceCurrent = Number(aeolus.read("fenceCurrent") ?? 0.4);
  const fault = Boolean(aeolus.read("fenceFault"));
  const recallInProgress = Boolean(aeolus.read("recallInProgress"));
  const lastAction = aeolus.read("lastAction") as any;
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setPhase((v) => (v + 1) % 100000), 90);
    return () => clearInterval(id);
  }, []);

  const cattle = useMemo(() => Array.from({ length: 30 }).map((_, i) => ({
    row: Math.floor(i / 6),
    col: i % 6,
    seed: i * 0.73,
  })), []);

  const alert = strays > 0;
  const activeA = paddock === "A";
  const actionLabel = lastAction?.label ? String(lastAction.label) : "Collar network online";
  const mainStatus = recallInProgress ? "RECALL IN PROGRESS" : alert ? strays + " OUTSIDE" : "HERD CONTAINED";

  function Cow(props: { x: number; y: number; stray?: boolean; faded?: boolean; seed: number }) {
    const bob = Math.sin(phase * .045 + props.seed) * 2.5;
    const sway = Math.cos(phase * .037 + props.seed) * 3.5;
    const color = props.stray ? "#FF786A" : props.faded ? "#7C7459" : "#D6C08B";
    return <g transform={"translate(" + (props.x + sway) + " " + (props.y + bob) + ")"} opacity={props.faded ? .42 : 1}>
      {props.stray && <circle r="10" fill="none" stroke="#FF6A5E" strokeOpacity={.25 + (Math.sin(phase * .15 + props.seed) + 1) * .22} />}
      <ellipse rx="6.5" ry="3.7" fill={color} />
      <circle cx="5.5" cy="-1" r="2.5" fill={color} />
      <line x1="-3" y1="3" x2="-4" y2="7" stroke={color} strokeWidth="1.3" />
      <line x1="3" y1="3" x2="4" y2="7" stroke={color} strokeWidth="1.3" />
    </g>;
  }

  return (
    <div style={{ padding: 12, minHeight: "100%", background: "linear-gradient(180deg,#0B120E,#080D0A)", color: "#E8EEE9" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 850 }}>LIVESTOCK & VIRTUAL FENCE</div>
          <div style={{ color: "#68786E", fontSize: 8, marginTop: 2 }}>30 GPS collars · rotational paddocks · verified recall</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: recallInProgress ? "#F3C568" : alert ? "#FF776B" : "#7CEB9B", fontSize: 10, fontWeight: 800 }}>{mainStatus}</div>
          <div style={{ color: "#657269", fontSize: 7 }}>{tracked}/{herd} tracked · {Math.round(avgBattery)}% collar battery</div>
        </div>
      </div>

      <div style={{ border: "1px solid " + (alert ? "#5F302B" : fault ? "#62452D" : "#294234"), borderRadius: 11, overflow: "hidden", background: "#09130D" }}>
        <svg width="100%" height="235" viewBox="0 0 470 235">
          <rect width="470" height="235" fill="#09140D" />
          <path d="M25 35 L220 30 L225 202 L35 207 Z" fill={activeA ? "#18391F" : "#112719"} stroke={activeA ? "#67D88A" : "#355540"} strokeWidth="1.4" strokeDasharray="7 5" />
          <path d="M243 30 L434 38 L446 199 L238 202 Z" fill={!activeA ? "#18391F" : "#112719"} stroke={!activeA ? "#67D88A" : "#355540"} strokeWidth="1.4" strokeDasharray="7 5" />
          <text x="38" y="25" fill={activeA ? "#82E8A0" : "#587262"} fontSize="8" letterSpacing="1.2">PADDOCK A</text>
          <text x="250" y="25" fill={!activeA ? "#82E8A0" : "#587262"} fontSize="8" letterSpacing="1.2">PADDOCK B</text>
          <path d="M229 25 L233 210" stroke="#2D4936" strokeWidth="2" strokeDasharray="3 5" />

          {cattle.map((cow, i) => {
            const isStray = i < strays;
            const baseX = activeA ? 58 + cow.col * 25 : 270 + cow.col * 24;
            const baseY = 62 + cow.row * 29;
            const returnProgress = movement === "returning" ? Math.min(1, ((phase * .025 + i * .02) % 1)) : 0;
            const strayX = breachSector === "west" ? 8 : 456;
            const x = isStray ? strayX + (activeA ? -returnProgress * 210 : -returnProgress * 90) : baseX;
            const y = isStray ? 76 + i * 42 : baseY;
            return <Cow key={i} x={x} y={y} stray={isStray} seed={cow.seed} />;
          })}

          {recallInProgress && Array.from({ length: 4 }).map((_, i) => <path key={i} d="M438 86 C390 95 350 110 310 128" fill="none" stroke="#F0C967" strokeWidth="2" strokeDasharray="5 7" strokeDashoffset={-(phase * 2 + i * 12)} opacity={.35 + i * .12} />)}

          <g transform="translate(310 169)">
            <rect width="145" height="54" rx="9" fill="#0A120D" stroke={fault ? "#7B4439" : "#31543B"} />
            <text x="10" y="14" fill="#6D7C73" fontSize="7">PHYSICAL FENCE BACKSTOP</text>
            <text x="10" y="34" fill={fault ? "#FF7A6F" : "#78E99A"} fontSize="16" fontFamily="monospace" fontWeight="700">{voltage.toFixed(1)} kV</text>
            <text x="91" y="34" fill="#7E8D84" fontSize="8">{fenceCurrent.toFixed(2)} A</text>
            <text x="10" y="47" fill={fault ? "#F39A7D" : "#56695E"} fontSize="6.5">{fault ? "FAULT · boundary degraded" : "energiser healthy"}</text>
          </g>
        </svg>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 6, marginTop: 8 }}>
        <button onClick={() => aeolus.fire(alert ? "recall-strays" : "simulate-strays")} disabled={recallInProgress} style={{ borderRadius: 8, padding: "8px 5px", border: "1px solid " + (alert ? "#743B34" : "#31573C"), background: alert ? "#2A1714" : "#11241A", color: alert ? "#FF9A8D" : "#8DE9A8", fontSize: 8, fontWeight: 750, cursor: recallInProgress ? "wait" : "pointer", opacity: recallInProgress ? .55 : 1 }}>{recallInProgress ? "Recalling…" : alert ? "Recall herd" : "Simulate breach"}</button>
        <button onClick={() => aeolus.fire("move-herd")} disabled={alert || recallInProgress} style={{ borderRadius: 8, padding: "8px 5px", border: "1px solid #3A543F", background: "#132019", color: "#8DB79A", fontSize: 8, cursor: alert ? "not-allowed" : "pointer", opacity: alert ? .5 : 1 }}>Rotate paddock</button>
        <button onClick={() => aeolus.fire(fault ? "restore-fence" : "simulate-fence-fault")} style={{ borderRadius: 8, padding: "8px 5px", border: "1px solid " + (fault ? "#315B3C" : "#62452D"), background: fault ? "#102319" : "#251C10", color: fault ? "#83D99A" : "#E0B071", fontSize: 8, cursor: "pointer" }}>{fault ? "Restore fence" : "Fence fault"}</button>
        <button onClick={() => aeolus.fire("reset-livestock")} style={{ borderRadius: 8, padding: "8px 5px", border: "1px solid #303A34", background: "#151B17", color: "#87958D", fontSize: 8, cursor: "pointer" }}>Reset</button>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 7 }}>
        <div style={{ color: "#66736B", fontSize: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{actionLabel}</div>
        <div style={{ color: "#506057", fontSize: 7, whiteSpace: "nowrap" }}>Current paddock {paddock} · {movement.replace(/-/g, " ")}</div>
      </div>
    </div>
  );
}`;

export const livestockAutomation = {
  key: "farm-livestock",
  name: "Livestock & Virtual Fence",
  triggerTopic: "sensor/fence/#",
  scriptSource: logic,
  uiSource: ui,
  demoAccess: {
    fireEvents: ["recall-strays", "simulate-strays", "move-herd", "simulate-fence-fault", "restore-fence", "reset-livestock"],
  },
};
