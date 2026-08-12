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

      var collars = byTopic("sensor/fence/collars");
      var recall = byTopic("switch/fence/recall/state");

      if (topic.indexOf("ui/") === 0) {
        if (evt === "simulate-strays") {
          events.emit("farm/sim/livestock-boundary-breach", {});
          setAction("Simulating a virtual-fence boundary crossing");
        } else if (evt === "reset-livestock") {
          events.emit("farm/sim/livestock-reset", {});
          setAction("Resetting livestock system to nominal");
        } else if (evt === "recall-strays") {
          if (!recall || !collars) {
            setAction("Recall blocked: collar or recall hardware unavailable");
            return;
          }
          setAction("Recall command dispatched to collars");
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
        // UI projection: mirror ONLY observed collar state into this automation's
        // own state (the non-admin demo user has no direct device visibility, so
        // the UI reads these via aeolus.read, not aeolus.devices).
        state.set("strays", strays);
        state.set("herd", herd);
        state.set("tracked", tracked);
        var previous = Number(state.get("lastStrays"));
        state.set("lastStrays", strays);

        if (strays > 0 && previous !== strays) {
          setAction(strays + " collars outside the virtual fence");
          events.emit("farm/livestock/breach", { strays: strays, herd: herd, tracked: tracked });
        } else if (strays === 0 && previous !== 0) {
          setAction("Herd contained · all collars inside boundary");
          events.emit("farm/livestock/contained", { herd: herd, tracked: tracked });
        }
      } else {
        // Energiser: mirror observed voltage/fault into the projection.
        var voltage = Number(context.state && context.state.voltage);
        var fault = Boolean(context.state && context.state.fault === true);
        if (!isNaN(voltage)) state.set("voltage", voltage);
        state.set("fenceFault", fault);
        if (fault) {
          setAction("Fence energiser fault detected");
          events.emit("farm/livestock/fence-fault", { voltage: context.state.voltage });
        }
      }
    },
  ],
});`;

const ui = `import { useEffect, useMemo, useState } from "react";
import type { CustomComponentProps } from "./types";

export default function LivestockFence(aeolus: CustomComponentProps) {
  // Non-admin demo users have no direct device visibility, so this UI reads the
  // automation's projection state (mirrored from observed device state) rather
  // than the raw device inventory.
  const strays = Math.max(0, Number(aeolus.read("strays") ?? 2));
  const herd = Math.max(0, Number(aeolus.read("herd") ?? 30));
  const tracked = Math.max(0, Number(aeolus.read("tracked") ?? 30));
  const voltage = Number(aeolus.read("voltage") ?? 7.2);
  const fault = Boolean(aeolus.read("fenceFault"));
  const lastAction = aeolus.read("lastAction") as any;
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setPhase((v) => (v + 1) % 100000), 90);
    return () => clearInterval(id);
  }, []);

  const cattle = useMemo(() => Array.from({ length: 30 }).map((_, i) => ({
    x: 70 + (i % 6) * 57 + (Math.floor(i / 6) % 2) * 13,
    y: 65 + Math.floor(i / 6) * 34,
    p: i * 0.71,
  })), []);

  const alert = strays > 0;
  const actionLabel = lastAction?.label ? String(lastAction.label) : "Collar network online";

  return (
    <div style={{ padding: 12, minHeight: "100%", background: "linear-gradient(180deg,#0B120E,#080D0A)", color: "#E8EEE9" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 850 }}>LIVESTOCK & VIRTUAL FENCE</div>
          <div style={{ color: "#68786E", fontSize: 8, marginTop: 2 }}>GPS collars · boundary events · verified recall</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: alert ? "#FF776B" : "#7CEB9B", fontSize: 10, fontWeight: 800 }}>{alert ? strays + " OUTSIDE" : "CONTAINED"}</div>
          <div style={{ color: "#657269", fontSize: 7 }}>{tracked}/{herd} tracked</div>
        </div>
      </div>

      <div style={{ border: "1px solid " + (alert ? "#5F302B" : "#294234"), borderRadius: 11, overflow: "hidden", background: "#09130D" }}>
        <svg width="100%" height="220" viewBox="0 0 420 220">
          <defs><filter id="lg"><feGaussianBlur stdDeviation="2.5" /></filter></defs>
          <rect width="420" height="220" fill="#0B1B10" />
          <path d="M35 32 L370 26 L389 190 L48 198 Z" fill="#16321B" fillOpacity="0.62" stroke={alert ? "#FF7467" : "#65D989"} strokeWidth="1.5" strokeDasharray="7 5" />
          <text x="47" y="24" fill={alert ? "#FF8D82" : "#7AE49A"} fontSize="8" letterSpacing="1.2">PADDOCK A · VIRTUAL BOUNDARY</text>
          {cattle.map((cow, i) => {
            const stray = i < strays;
            const x = stray ? 20 + i * 13 + Math.sin(phase * .07 + cow.p) * 4 : cow.x + Math.sin(phase * .05 + cow.p) * 4;
            const y = stray ? 70 + i * 31 : cow.y + Math.cos(phase * .04 + cow.p) * 3;
            return <g key={i}>
              {stray && <circle cx={x} cy={y} r="10" fill="none" stroke="#FF6659" strokeOpacity={0.35 + (Math.sin(phase * .15 + i) + 1) * .2} />}
              <ellipse cx={x} cy={y} rx="6" ry="3.7" fill={stray ? "#FF776B" : "#D2BC8B"} />
              <circle cx={x + 5} cy={y - .5} r="2.4" fill={stray ? "#FF776B" : "#D2BC8B"} />
            </g>;
          })}
          <g transform="translate(275 44)">
            <rect width="118" height="43" rx="8" fill="#0A120D" stroke={fault ? "#6E3932" : "#31543B"} />
            <text x="10" y="14" fill="#6D7C73" fontSize="7">FENCE ENERGISER</text>
            <text x="10" y="31" fill={fault ? "#FF7A6F" : "#78E99A"} fontSize="15" fontFamily="monospace" fontWeight="700">{voltage.toFixed(1)} kV</text>
          </g>
        </svg>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7, marginTop: 8 }}>
        <button onClick={() => aeolus.fire(alert ? "recall-strays" : "simulate-strays")} style={{ borderRadius: 8, padding: "8px 9px", border: "1px solid " + (alert ? "#743B34" : "#31573C"), background: alert ? "#2A1714" : "#11241A", color: alert ? "#FF9A8D" : "#8DE9A8", fontSize: 9, fontWeight: 750, cursor: "pointer" }}>{alert ? "Recall strays" : "Simulate breach"}</button>
        <button onClick={() => aeolus.fire("reset-livestock")} style={{ borderRadius: 8, padding: "8px 9px", border: "1px solid #303A34", background: "#151B17", color: "#87958D", fontSize: 9, cursor: "pointer" }}>Reset livestock</button>
      </div>
      <div style={{ color: "#66736B", fontSize: 8, marginTop: 7 }}>{actionLabel}</div>
      <div style={{ color: "#4F5D54", fontSize: 7, marginTop: 3 }}>No water-system dependency · physical collar state arrives over MQTT</div>
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
    fireEvents: ["recall-strays", "simulate-strays", "reset-livestock"],
  },
};
