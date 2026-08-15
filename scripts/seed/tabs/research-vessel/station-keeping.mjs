const logic = `automation({
  actions: [
    async function stationKeeping(context) {
      var topic = String(context.topic || "");
      var evt = topic.split("/").pop();
      function byTopic(wanted) { return devices.list().find(function(d) { return d.topic === wanted; }); }
      function setAction(label) { state.set("lastAction", { label: label, at: Date.now() }); }
      function project() {
        var gnss = byTopic("sensor/vessel/gnss");
        var current = byTopic("sensor/vessel/current");
        var dp = byTopic("switch/vessel/dp-controller/state");
        var drift = Number(gnss && gnss.state && gnss.state.driftM);
        var heading = Number(gnss && gnss.state && gnss.state.heading);
        var speed = Number(current && current.state && current.state.speedKn);
        var direction = Number(current && current.state && current.state.direction);
        if (!isNaN(drift)) state.set("driftM", drift);
        if (!isNaN(heading)) state.set("heading", heading);
        if (!isNaN(speed)) state.set("currentKn", speed);
        if (!isNaN(direction)) state.set("currentDirection", direction);
        state.set("dpEngaged", Boolean(dp && dp.state && dp.state.engaged));
        state.set("dpMode", String(dp && dp.state && dp.state.mode || "holding"));
        state.set("bowThrust", Number(dp && dp.state && dp.state.bowThrust || 0));
        state.set("sternThrust", Number(dp && dp.state && dp.state.sternThrust || 0));
        events.emit("vessel/summary/station", {
          dpEngaged: Boolean(dp && dp.state && dp.state.engaged),
          dpMode: String(dp && dp.state && dp.state.mode || "holding"),
          driftM: isNaN(drift) ? 0 : drift,
          currentKn: isNaN(speed) ? 0 : speed,
          heading: isNaN(heading) ? 0 : heading,
          bowThrust: Number(dp && dp.state && dp.state.bowThrust || 0),
          sternThrust: Number(dp && dp.state && dp.state.sternThrust || 0),
        });
      }

      async function setDp(engaged) {
        var dp = byTopic("switch/vessel/dp-controller/state");
        if (!dp) { setAction("DP controller unavailable"); return; }
        state.set("commandPending", true);
        var result = await devices.action(dp.id, "command", { payload: { engaged: engaged, mode: engaged ? "hold" : "off" } }, {
          tier: "observed", deviceId: dp.id,
          condition: { field: "engaged", op: "eq", value: engaged }, timeoutMs: 5000,
        });
        state.set("commandPending", false);
        if (result.success) setAction(engaged ? "Dynamic positioning engaged" : "Dynamic positioning disengaged");
        else setAction("DP command not verified: " + String(result.error || result.lifecycleState || "unknown"));
        project();
      }

      async function correctStation() {
        if (Boolean(state.get("correctionActive"))) return;
        var dp = byTopic("switch/vessel/dp-controller/state");
        var gnss = byTopic("sensor/vessel/gnss");
        if (!dp || !gnss || !Boolean(dp.state && dp.state.engaged)) return;
        state.set("correctionActive", true);
        setAction("Station error exceeded 4 m · requesting DP recovery");
        var result = await devices.action(dp.id, "command", { payload: { engaged: true, mode: "recover" } }, {
          tier: "observed", deviceId: gnss.id,
          condition: { field: "driftM", op: "lte", value: 2 }, timeoutMs: 7000,
        });
        state.set("correctionActive", false);
        if (result.success) {
          setAction("Station recovered · GNSS error below 2 m");
          events.emit("vessel/station/recovered", { lifecycleState: result.lifecycleState });
        } else {
          setAction("Station recovery not verified: " + String(result.error || result.lifecycleState || "unknown"));
        }
        project();
      }

      if (topic.indexOf("ui/") === 0) {
        if (evt === "dp-engage") await setDp(true);
        else if (evt === "dp-disengage") await setDp(false);
        else if (evt === "simulate-current-shear") { events.emit("vessel/sim/current-shear", {}); setAction("Injecting 2.1 kn cross-current into simulator"); }
        else if (evt === "reset-station") { events.emit("vessel/sim/station-reset", {}); state.set("correctionActive", false); setAction("Resetting station-keeping environment"); }
        return;
      }

      if (topic.indexOf("sensor/vessel/") !== 0 && topic.indexOf("switch/vessel/dp-controller/state") !== 0) { project(); return; }
      project();
      var gnss = byTopic("sensor/vessel/gnss");
      var dp = byTopic("switch/vessel/dp-controller/state");
      var drift = Number(gnss && gnss.state && gnss.state.driftM);
      if (!isNaN(drift) && drift > 4 && Boolean(dp && dp.state && dp.state.engaged)) await correctStation();
    },
  ],
});`;

const ui = `import { useEffect, useState } from "react";
import type { CustomComponentProps } from "./types";

export default function StationKeeping(aeolus: CustomComponentProps) {
  const engaged = aeolus.read("dpEngaged") !== false;
  const mode = String(aeolus.read("dpMode") || "holding");
  const drift = Number(aeolus.read("driftM") ?? 1.2);
  const current = Number(aeolus.read("currentKn") ?? .8);
  const currentDir = Number(aeolus.read("currentDirection") ?? 248);
  const heading = Number(aeolus.read("heading") ?? 142);
  const bow = Number(aeolus.read("bowThrust") ?? 18);
  const stern = Number(aeolus.read("sternThrust") ?? 12);
  const pending = Boolean(aeolus.read("commandPending")) || Boolean(aeolus.read("correctionActive"));
  const last = aeolus.read("lastAction") as any;
  const [phase, setPhase] = useState(0);
  useEffect(() => { const id = setInterval(() => setPhase(v => (v + 1) % 100000), 90); return () => clearInterval(id); }, []);
  const action = last?.label ? String(last.label) : "GNSS + current telemetry online";
  const healthy = engaged && drift <= 4;
  const statusColor = !engaged ? "#E18462" : healthy ? "#77DBA2" : "#F1B85E";
  const x = 180 + Math.min(54, drift * 5.4) * Math.cos((currentDir - 90) * Math.PI / 180);
  const y = 104 + Math.min(54, drift * 5.4) * Math.sin((currentDir - 90) * Math.PI / 180);

  return <div style={{ padding: 11, minHeight: "100%", background: "linear-gradient(180deg,#07131A,#050D12)", color: "#EAF1F4" }}>
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 7 }}>
      <div><div style={{ fontSize: 12, fontWeight: 900 }}>STATION KEEPING</div><div style={{ color: "#637A86", fontSize: 7.5, marginTop: 2 }}>GNSS error → DP controller → bow + stern thrust</div></div>
      <div style={{ textAlign: "right" }}><div style={{ color: statusColor, fontSize: 9, fontWeight: 850 }}>{!engaged ? "DP OFF" : healthy ? "HOLDING STATION" : "CORRECTING"}</div><div style={{ color: "#60727B", fontSize: 7 }}>{drift.toFixed(1)} m error</div></div>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "1.3fr .9fr", gap: 7 }}>
      <div style={{ border: "1px solid #1D3947", borderRadius: 10, background: "#06151E", padding: 6 }}>
        <svg width="100%" height="160" viewBox="0 0 360 160">
          <circle cx="180" cy="104" r="54" fill="#0A2230" stroke="#235268" strokeDasharray="3 4" />
          <circle cx="180" cy="104" r="20" fill="none" stroke="#33728A" strokeDasharray="2 3" />
          <line x1="180" y1="39" x2="180" y2="153" stroke="#173B4B"/><line x1="115" y1="104" x2="245" y2="104" stroke="#173B4B"/>
          <circle cx="180" cy="104" r="3" fill="#6ED8A0"/><text x="180" y="97" textAnchor="middle" fill="#5B8597" fontSize="6">STATION</text>
          <g transform={"translate(" + x + " " + y + ") rotate(" + (heading-90) + ")"}>
            <path d="M-21 -7 L15 -7 L24 0 L15 7 L-21 7 L-27 0 Z" fill="#D8E3E6" stroke={statusColor}/>
            <circle cx="-20" cy="0" r="2.5" fill={stern > 0 ? "#6BDCF3" : "#52636B"}/><circle cx="18" cy="0" r="2.5" fill={bow > 0 ? "#6BDCF3" : "#52636B"}/>
          </g>
          <g transform={"translate(56 44) rotate(" + (currentDir-90) + ")"}><line x1="-22" y1="0" x2="22" y2="0" stroke="#E8B75E" strokeWidth="2"/><path d="M22 0 l-8 -5 l0 10 z" fill="#E8B75E"/></g>
          <text x="18" y="18" fill="#708996" fontSize="7">CURRENT {current.toFixed(1)} kn · {Math.round(currentDir)}°</text>
          <text x="18" y="148" fill="#596F7A" fontSize="6.5">Position error is real simulated GNSS state, not local animation state.</text>
        </svg>
      </div>
      <div style={{ border: "1px solid #1D3947", borderRadius: 10, background: "#07131A", padding: 9 }}>
        <div style={{ color: "#67808D", fontSize: 6.5, letterSpacing: ".12em" }}>THRUSTER DEMAND</div>
        {[['BOW',bow],['STERN',stern]].map(([label,val]: any) => <div key={label} style={{ marginTop: 11 }}><div style={{ display: "flex", justifyContent: "space-between", color: "#AFC0C6", fontSize: 7 }}><span>{label}</span><span>{Math.round(val)}%</span></div><div style={{ height: 6, marginTop: 4, background: "#14242C", borderRadius: 5, overflow: "hidden" }}><div style={{ height: "100%", width: Math.min(100,val) + "%", background: val > 55 ? "#E6B15A" : "#50B9D2" }} /></div></div>)}
        <div style={{ marginTop: 14, color: "#667B85", fontSize: 7 }}>Mode</div><div style={{ color: statusColor, fontSize: 10, fontWeight: 800, marginTop: 2 }}>{mode.toUpperCase()}</div>
      </div>
    </div>

    <div style={{ marginTop: 7, border: "1px solid #213945", background: "#07141C", borderRadius: 9, padding: 8 }}>
      <div style={{ color: "#7B929D", fontSize: 6.5, letterSpacing: ".12em", marginBottom: 6 }}>OPERATOR CONTROLS</div>
      <div style={{ display: "flex", gap: 6 }}><button disabled={pending || engaged} onClick={() => aeolus.fire("dp-engage")} style={{ flex: 1, padding: "7px", borderRadius: 7, border: "1px solid #315D48", background: "#10241B", color: "#80DCA3", fontSize: 8, cursor: "pointer" }}>Engage DP</button><button disabled={pending || !engaged} onClick={() => aeolus.fire("dp-disengage")} style={{ flex: 1, padding: "7px", borderRadius: 7, border: "1px solid #654234", background: "#241611", color: "#E49B79", fontSize: 8, cursor: "pointer" }}>Disengage DP</button></div>
    </div>

    <div style={{ marginTop: 7, border: "1px dashed #66502D", background: "#171309", borderRadius: 9, padding: 8 }}>
      <div style={{ color: "#D8B66D", fontSize: 6.5, letterSpacing: ".12em" }}>DEMO SCENARIO</div><div style={{ color: "#806F50", fontSize: 7, margin: "3px 0 6px" }}>Inject external ocean conditions. These are not vessel operator controls.</div>
      <div style={{ display: "flex", gap: 6 }}><button onClick={() => aeolus.fire("simulate-current-shear")} style={{ flex: 1, padding: "6px", borderRadius: 6, border: "1px solid #6A5130", background: "#21180B", color: "#E3B866", fontSize: 7.5, cursor: "pointer" }}>2.1 kn current shear</button><button onClick={() => aeolus.fire("reset-station")} style={{ padding: "6px 9px", borderRadius: 6, border: "1px solid #454138", background: "#171713", color: "#898B82", fontSize: 7.5, cursor: "pointer" }}>Reset scenario</button></div>
    </div>
    <div style={{ color: "#5B6D75", fontSize: 7, marginTop: 6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{action}</div>
  </div>;
}`;

export const stationKeepingAutomation = {
  key: "vessel-station-keeping",
  name: "Station Keeping",
  triggerTopic: "sensor/vessel/#",
  scriptSource: logic,
  uiSource: ui,
  demoAccess: { fireEvents: ["dp-engage", "dp-disengage", "simulate-current-shear", "reset-station"] },
};
