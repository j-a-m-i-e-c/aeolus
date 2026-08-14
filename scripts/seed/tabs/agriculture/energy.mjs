const logic = `automation({
  actions: [
    async function siteEnergy(context) {
      var topic = String(context.topic || "");
      var evt = topic.split("/").pop();

      function byTopic(wanted) {
        return devices.list().find(function(d) { return d.topic === wanted; });
      }
      function setAction(label) {
        state.set("lastAction", { label: label, at: Date.now() });
      }

      async function setCharger(on, reason) {
        if (Boolean(state.get("chargerCommandPending"))) return;
        var charger = byTopic("switch/farm/charger-bank/state");
        if (!charger) {
          setAction("Opportunity-load command blocked: charger bank unavailable");
          return;
        }
        var currentlyOn = Boolean(charger.state && charger.state.on);
        if (currentlyOn === on) return;
        state.set("chargerCommandPending", true);
        setAction((on ? "Enabling" : "Shedding") + " shed charger bank · " + reason);
        var result = await devices.action(
          charger.id,
          "command",
          { payload: { on: on } },
          {
            tier: "observed",
            deviceId: charger.id,
            condition: on
              ? { field: "watts", op: "gt", value: 0 }
              : { field: "watts", op: "eq", value: 0 },
            timeoutMs: 5000,
          }
        );
        state.set("chargerCommandPending", false);
        if (result.success) {
          setAction((on ? "Opportunity load online" : "Opportunity load shed") + " · physical state verified");
          events.emit("farm/energy/opportunity-load", { on: on, reason: reason, lifecycleState: result.lifecycleState });
        } else {
          setAction("Charger-bank command not verified: " + String(result.error || result.lifecycleState || "unknown"));
        }
      }

      if (topic.indexOf("ui/") === 0) {
        if (evt === "simulate-low-battery") {
          events.emit("farm/sim/energy-low", {});
          setAction("Simulating cloud cover + low battery reserve");
        } else if (evt === "restore-battery") {
          events.emit("farm/sim/energy-restore", {});
          setAction("Restoring solar production + battery reserve");
        } else if (evt === "toggle-opportunity") {
          var next = !Boolean(state.get("autoOpportunity"));
          state.set("autoOpportunity", next);
          if (!next) await setCharger(false, "automatic opportunity loads disabled");
          else setAction("Automatic opportunity-load control enabled");
        } else if (evt === "reset-energy") {
          events.emit("farm/sim/energy-reset", {});
          state.set("autoOpportunity", true);
          state.set("chargerCommandPending", false);
          setAction("Resetting energy system to nominal");
        }
        return;
      }

      if (topic !== "sensor/farm/energy/battery") return;
      var soc = Number(context.state && context.state.soc);
      var solarKw = Number(context.state && context.state.solarKw);
      var loadKw = Number(context.state && context.state.loadKw);
      var baseLoadKw = Number(context.state && context.state.baseLoadKw);
      var pumpKw = Number(context.state && context.state.pumpKw);
      var chargerKw = Number(context.state && context.state.chargerKw);
      var chargerOn = Boolean(context.state && context.state.chargerOn);
      var batteryAvailable = !(context.state && context.state.available === false);
      var allowed = batteryAvailable && (isNaN(soc) || soc >= 30);

      if (!isNaN(soc)) state.set("batterySoc", soc);
      if (!isNaN(solarKw)) state.set("solarKw", solarKw);
      if (!isNaN(loadKw)) state.set("loadKw", loadKw);
      if (!isNaN(baseLoadKw)) state.set("baseLoadKw", baseLoadKw);
      if (!isNaN(pumpKw)) state.set("pumpKw", pumpKw);
      if (!isNaN(chargerKw)) state.set("chargerKw", chargerKw);
      state.set("chargerOn", chargerOn || (!isNaN(chargerKw) && chargerKw > 0));
      state.set("batteryAvailable", batteryAvailable);
      state.set("allowed", allowed);
      if (state.get("autoOpportunity") === undefined) state.set("autoOpportunity", true);
      if (state.get("chargerCommandPending") === undefined) state.set("chargerCommandPending", false);

      var uncontrollableLoad = Math.max(0, (isNaN(loadKw) ? 0 : loadKw) - (isNaN(chargerKw) ? 0 : chargerKw));
      var solarMargin = (isNaN(solarKw) ? 0 : solarKw) - uncontrollableLoad;
      state.set("solarMarginKw", solarMargin);
      var mode = !allowed ? "reserve-protection" : solarMargin >= 0.7 ? "solar-surplus" : solarMargin >= 0 ? "balanced" : "battery-support";
      state.set("energyMode", mode);

      var previous = state.get("previousAllowed");
      state.set("previousAllowed", allowed);
      if (allowed === false && previous !== false) {
        setAction("Reserve protection active · discretionary loads constrained");
      } else if (allowed === true && previous === false) {
        setAction("Energy reserve restored · discretionary loads available");
      } else if (previous === undefined) {
        setAction("Energy telemetry online · evaluating opportunity loads");
      }

      events.emit("farm/energy/permission", {
        allowed: allowed,
        soc: isNaN(soc) ? null : soc,
        solarKw: isNaN(solarKw) ? null : solarKw,
        loadKw: isNaN(loadKw) ? null : loadKw,
        mode: mode,
      });

      var auto = Boolean(state.get("autoOpportunity"));
      var chargerIsOn = chargerOn || (!isNaN(chargerKw) && chargerKw > 0);
      if (auto && !chargerIsOn && allowed && !isNaN(soc) && soc >= 60 && solarMargin >= 0.7) {
        await setCharger(true, "solar surplus available");
      } else if (chargerIsOn && (!auto || !allowed || (!isNaN(soc) && soc < 45) || solarMargin < 0.15)) {
        await setCharger(false, !allowed ? "reserve protection" : solarMargin < 0.15 ? "solar margin collapsed" : "automatic control disabled");
      }
    },
  ],
});`;

const ui = `import { useEffect, useState } from "react";
import type { CustomComponentProps } from "./types";

export default function SiteEnergy(aeolus: CustomComponentProps) {
  const soc = Math.max(0, Math.min(100, Number(aeolus.read("batterySoc") ?? 78)));
  const solar = Math.max(0, Number(aeolus.read("solarKw") ?? 2.8));
  const load = Math.max(0, Number(aeolus.read("loadKw") ?? .72));
  const baseLoad = Math.max(0, Number(aeolus.read("baseLoadKw") ?? .72));
  const pumpLoad = Math.max(0, Number(aeolus.read("pumpKw") ?? 0));
  const chargerLoad = Math.max(0, Number(aeolus.read("chargerKw") ?? 0));
  const chargerOn = Boolean(aeolus.read("chargerOn")) || chargerLoad > 0;
  const available = aeolus.read("batteryAvailable") !== false && soc >= 30;
  const allowed = aeolus.read("allowed") !== false && available;
  const solarMargin = Number(aeolus.read("solarMarginKw") ?? (solar - (load - chargerLoad)));
  const mode = String(aeolus.read("energyMode") ?? "solar-surplus");
  const autoOpportunity = aeolus.read("autoOpportunity") !== false;
  const chargerPending = Boolean(aeolus.read("chargerCommandPending"));
  const lastAction = aeolus.read("lastAction") as any;
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setPhase((v) => (v + 1) % 100000), 100);
    return () => clearInterval(id);
  }, []);

  const net = solar - load;
  const status = mode === "reserve-protection" ? "RESERVE PROTECTION" : mode === "solar-surplus" ? "SOLAR SURPLUS" : mode === "battery-support" ? "BATTERY SUPPORT" : "BALANCED";
  const statusColor = mode === "reserve-protection" ? "#F09B61" : mode === "solar-surplus" ? "#8DE59A" : mode === "battery-support" ? "#E6C26B" : "#8AB7A0";
  const actionLabel = lastAction?.label ? String(lastAction.label) : "Energy telemetry online";

  function FlowDots(props: { x1: number; x2: number; y: number; active: boolean; reverse?: boolean; color: string }) {
    if (!props.active) return null;
    return <g>{Array.from({ length: 5 }).map((_, i) => {
      const t = ((phase * .025 + i / 5) % 1);
      const p = props.reverse ? 1 - t : t;
      return <circle key={i} cx={props.x1 + (props.x2 - props.x1) * p} cy={props.y} r="2.2" fill={props.color} opacity=".85" />;
    })}</g>;
  }

  function LoadBar(props: { label: string; value: number; max: number; active?: boolean }) {
    const pct = Math.max(0, Math.min(100, props.value / props.max * 100));
    return <div style={{ display: "grid", gridTemplateColumns: "88px 1fr 48px", gap: 7, alignItems: "center", marginTop: 6 }}>
      <div style={{ color: props.active ? "#DCE7DB" : "#6E796E", fontSize: 7 }}>{props.label}</div>
      <div style={{ height: 5, borderRadius: 5, background: "#222A22", overflow: "hidden" }}><div style={{ width: pct + "%", height: "100%", background: props.active ? "#7AA984" : "#48564B" }} /></div>
      <div style={{ color: props.active ? "#CED9CD" : "#69746A", textAlign: "right", fontSize: 7, fontFamily: "monospace" }}>{props.value.toFixed(2)} kW</div>
    </div>;
  }

  return (
    <div style={{ padding: 12, minHeight: "100%", background: "linear-gradient(180deg,#10120C,#0B0E0A)", color: "#EDEFE8" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 850 }}>SITE ENERGY</div>
          <div style={{ color: "#777B68", fontSize: 8, marginTop: 2 }}>Solar → battery → real Farm loads · automatic opportunity-load shedding</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: statusColor, fontSize: 10, fontWeight: 800 }}>{status}</div>
          <div style={{ color: "#667064", fontSize: 7 }}>{allowed ? "discretionary loads permitted" : "water transfer held"}</div>
        </div>
      </div>

      <div style={{ border: "1px solid #363823", background: "#10120C", borderRadius: 11, padding: 10 }}>
        <svg width="100%" height="150" viewBox="0 0 520 150">
          <rect width="520" height="150" rx="8" fill="#0F120C" />
          <g transform="translate(28 37)">
            <path d="M0 25 L48 0 L96 25 L48 50 Z" fill="#2F3318" stroke="#8D8336" />
            <path d="M18 28 L48 12 L78 28 L48 42 Z" fill="#CBB84C" opacity=".7" />
            <text x="48" y="66" textAnchor="middle" fill="#7E8069" fontSize="7">SOLAR ARRAY</text>
            <text x="48" y="81" textAnchor="middle" fill="#F0D969" fontSize="14" fontFamily="monospace" fontWeight="800">{solar.toFixed(1)} kW</text>
          </g>
          <line x1="126" y1="63" x2="205" y2="63" stroke="#363F27" strokeWidth="4" />
          <FlowDots x1={126} x2={205} y={63} active={solar > .05} color="#E5D45D" />

          <g transform="translate(208 21)">
            <rect width="90" height="92" rx="11" fill="#121813" stroke={available ? "#6FA978" : "#B66A3B"} strokeWidth="2" />
            <rect x="8" y={84 - Math.max(6, soc * .72)} width="74" height={Math.max(6, soc * .72)} rx="6" fill={available ? "#4FAE68" : "#B85C39"} opacity=".8" />
            <text x="45" y="43" textAnchor="middle" fill="#F3F5EF" fontSize="20" fontFamily="monospace" fontWeight="850">{Math.round(soc)}%</text>
            <text x="45" y="107" textAnchor="middle" fill="#737D72" fontSize="7">BATTERY RESERVE</text>
          </g>

          <line x1="300" y1="63" x2="382" y2="63" stroke="#344039" strokeWidth="4" />
          <FlowDots x1={300} x2={382} y={63} active={Math.abs(net) > .03} reverse={net < 0} color={net >= 0 ? "#78D98C" : "#E2B764"} />

          <g transform="translate(386 25)">
            <rect width="105" height="80" rx="9" fill="#121713" stroke="#435047" />
            <text x="52" y="17" textAnchor="middle" fill="#727D73" fontSize="7">FARM LOAD BUS</text>
            <text x="52" y="43" textAnchor="middle" fill="#E0E7DF" fontSize="18" fontFamily="monospace" fontWeight="800">{load.toFixed(2)}</text>
            <text x="52" y="55" textAnchor="middle" fill="#657066" fontSize="7">kW total</text>
            <text x="52" y="70" textAnchor="middle" fill={net >= 0 ? "#7DD990" : "#E1B36A"} fontSize="7">{net >= 0 ? "+" : ""}{net.toFixed(2)} kW site net</text>
          </g>
        </svg>

        <div style={{ borderTop: "1px solid #252B20", paddingTop: 5 }}>
          <LoadBar label="Base farm load" value={baseLoad} max={1.5} active={true} />
          <LoadBar label="Water transfer pump" value={pumpLoad} max={1.2} active={pumpLoad > 0} />
          <LoadBar label="Shed charger bank" value={chargerLoad} max={.5} active={chargerOn} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.15fr 1fr .8fr", gap: 6, marginTop: 8 }}>
        <button onClick={() => aeolus.fire(available ? "simulate-low-battery" : "restore-battery")} style={{ borderRadius: 8, padding: "8px", border: "1px solid " + (available ? "#6C4A2F" : "#315B3C"), background: available ? "#25180F" : "#102319", color: available ? "#E5A268" : "#83D99A", fontSize: 8, fontWeight: 750, cursor: "pointer" }}>{available ? "Simulate cloud + low reserve" : "Restore solar + reserve"}</button>
        <button onClick={() => aeolus.fire("toggle-opportunity")} disabled={chargerPending} style={{ borderRadius: 8, padding: "8px", border: "1px solid " + (autoOpportunity ? "#3C5E3F" : "#353A32"), background: autoOpportunity ? "#132218" : "#161A15", color: autoOpportunity ? "#8DD49A" : "#879083", fontSize: 8, cursor: chargerPending ? "wait" : "pointer" }}>Opportunity loads {autoOpportunity ? "AUTO" : "OFF"}</button>
        <button onClick={() => aeolus.fire("reset-energy")} style={{ borderRadius: 8, padding: "8px", border: "1px solid #353A32", background: "#161A15", color: "#879083", fontSize: 8, cursor: "pointer" }}>Reset</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, marginTop: 7, alignItems: "center" }}>
        <div style={{ color: "#6D756A", fontSize: 8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{actionLabel}</div>
        <div style={{ color: chargerOn ? "#8DCF99" : "#626B61", fontSize: 7, whiteSpace: "nowrap" }}>{chargerOn ? "CHARGER BANK ON" : "CHARGER BANK SHED"} · margin {solarMargin.toFixed(2)} kW</div>
      </div>
    </div>
  );
}`;

export const energyAutomation = {
  key: "farm-energy",
  name: "Site Energy",
  triggerTopic: "sensor/farm/energy/#",
  scriptSource: logic,
  uiSource: ui,
  demoAccess: {
    fireEvents: ["simulate-low-battery", "restore-battery", "toggle-opportunity", "reset-energy"],
  },
};
