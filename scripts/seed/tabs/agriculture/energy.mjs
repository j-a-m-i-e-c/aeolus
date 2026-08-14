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
      function init(key, value) {
        if (state.get(key) === undefined) state.set(key, value);
      }

      init("autoOpportunity", true);
      init("chargerCommandPending", false);
      init("demoScenarioPending", "");
      init("energyMode", "solar-surplus");

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
          setAction((on ? "Opportunity charging online" : "Opportunity charging shed") + " · physical state verified");
          events.emit("farm/energy/opportunity-load", { on: on, reason: reason, lifecycleState: result.lifecycleState });
        } else {
          setAction("Charger-bank command not verified: " + String(result.error || result.lifecycleState || "unknown"));
        }
      }

      if (topic.indexOf("ui/") === 0) {
        if (evt === "simulate-low-battery") {
          if (String(state.get("demoScenarioPending") || "")) return;
          state.set("demoScenarioPending", "low-reserve");
          events.emit("farm/sim/energy-low", {});
          setAction("DEMO · injecting cloud cover + low battery reserve");
        } else if (evt === "restore-battery") {
          if (String(state.get("demoScenarioPending") || "")) return;
          state.set("demoScenarioPending", "restore");
          events.emit("farm/sim/energy-restore", {});
          setAction("DEMO · restoring nominal solar + battery reserve");
        } else if (evt === "toggle-opportunity") {
          var current = state.get("autoOpportunity");
          var enabled = current === undefined ? true : Boolean(current);
          var next = !enabled;
          state.set("autoOpportunity", next);
          if (!next) await setCharger(false, "operator disabled opportunity charging");
          else setAction("Automatic opportunity charging enabled · lowest-priority load");
        } else if (evt === "reset-energy") {
          events.emit("farm/sim/energy-reset", {});
          state.set("autoOpportunity", true);
          state.set("chargerCommandPending", false);
          state.set("demoScenarioPending", "");
          setAction("DEMO · energy system reset to nominal");
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

      var netKw = (isNaN(solarKw) ? 0 : solarKw) - (isNaN(loadKw) ? 0 : loadKw);
      var headroomBeforeCharger = (isNaN(solarKw) ? 0 : solarKw) - Math.max(0, (isNaN(loadKw) ? 0 : loadKw) - (isNaN(chargerKw) ? 0 : chargerKw));
      state.set("netKw", netKw);
      state.set("solarMarginKw", headroomBeforeCharger);

      var chargerIsOn = chargerOn || (!isNaN(chargerKw) && chargerKw > 0);
      var pumpActive = !isNaN(pumpKw) && pumpKw > 0.1;
      var mode = !allowed
        ? "reserve-protection"
        : pumpActive && !chargerIsOn
          ? "water-priority"
          : chargerIsOn
            ? "opportunity-charging"
            : netKw < 0
              ? "battery-support"
              : netKw >= 0.4
                ? "solar-surplus"
                : "balanced";
      state.set("energyMode", mode);

      var pendingScenario = String(state.get("demoScenarioPending") || "");
      if (pendingScenario === "low-reserve" && (!allowed || (!isNaN(soc) && soc <= 20))) state.set("demoScenarioPending", "");
      else if (pendingScenario === "restore" && allowed && !isNaN(soc) && soc >= 70) state.set("demoScenarioPending", "");

      var previous = state.get("previousAllowed");
      state.set("previousAllowed", allowed);
      if (allowed === false && previous !== false) {
        setAction("Reserve protection active · water transfer held and opportunity load shed");
      } else if (allowed === true && previous === false) {
        setAction("Energy reserve restored · normal load policy resumed");
      } else if (previous === undefined) {
        setAction("Energy policy online · priorities: essential > water > charging");
      }

      events.emit("farm/energy/permission", {
        allowed: allowed,
        soc: isNaN(soc) ? null : soc,
        solarKw: isNaN(solarKw) ? null : solarKw,
        loadKw: isNaN(loadKw) ? null : loadKw,
        mode: mode,
      });

      var auto = Boolean(state.get("autoOpportunity"));
      // Opportunity charging is deliberately the lowest-priority load. It can
      // start only with comfortable headroom and is shed as soon as water
      // transfer or reserve conditions consume that margin.
      if (auto && !chargerIsOn && allowed && !isNaN(soc) && soc >= 60 && headroomBeforeCharger >= 0.65) {
        await setCharger(true, "solar headroom available after higher-priority loads");
      } else if (chargerIsOn && (!auto || !allowed || (!isNaN(soc) && soc < 45) || netKw < 0.2 || (pumpActive && netKw < 0.35))) {
        await setCharger(false, !allowed ? "reserve protection" : pumpActive ? "water transfer given priority" : netKw < 0.2 ? "solar headroom exhausted" : "automatic control disabled");
      }
    },
  ],
});`;

const ui = `import { useEffect, useState } from "react";
import type { CustomComponentProps } from "./types";

export default function SiteEnergy(aeolus: CustomComponentProps) {
  const soc = Math.max(0, Math.min(100, Number(aeolus.read("batterySoc") ?? 78)));
  const solar = Math.max(0, Number(aeolus.read("solarKw") ?? 2.1));
  const load = Math.max(0, Number(aeolus.read("loadKw") ?? .72));
  const baseLoad = Math.max(0, Number(aeolus.read("baseLoadKw") ?? .72));
  const pumpLoad = Math.max(0, Number(aeolus.read("pumpKw") ?? 0));
  const chargerLoad = Math.max(0, Number(aeolus.read("chargerKw") ?? 0));
  const chargerOn = Boolean(aeolus.read("chargerOn")) || chargerLoad > 0;
  const available = aeolus.read("batteryAvailable") !== false && soc >= 30;
  const allowed = aeolus.read("allowed") !== false && available;
  const solarMargin = Number(aeolus.read("solarMarginKw") ?? (solar - (load - chargerLoad)));
  const netKw = Number(aeolus.read("netKw") ?? (solar - load));
  const mode = String(aeolus.read("energyMode") ?? "solar-surplus");
  const autoOpportunity = aeolus.read("autoOpportunity") !== false;
  const chargerPending = Boolean(aeolus.read("chargerCommandPending"));
  const demoScenarioPending = String(aeolus.read("demoScenarioPending") ?? "");
  const lastAction = aeolus.read("lastAction") as any;
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setPhase((v) => (v + 1) % 100000), 100);
    return () => clearInterval(id);
  }, []);

  const net = solar - load;
  const status = mode === "reserve-protection" ? "RESERVE PROTECTION" : mode === "water-priority" ? "WATER PRIORITY" : mode === "opportunity-charging" ? "OPPORTUNITY CHARGING" : mode === "solar-surplus" ? "SOLAR SURPLUS" : mode === "battery-support" ? "BATTERY SUPPORT" : "BALANCED";
  const statusColor = mode === "reserve-protection" ? "#F09B61" : mode === "water-priority" ? "#73DDF1" : mode === "opportunity-charging" ? "#8DE59A" : mode === "solar-surplus" ? "#B6DE78" : mode === "battery-support" ? "#E6C26B" : "#8AB7A0";
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
          <div style={{ color: "#777B68", fontSize: 8, marginTop: 2 }}>Local load policy · essential loads → water transfer → opportunity charging</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: statusColor, fontSize: 10, fontWeight: 800 }}>{status}</div>
          <div style={{ color: "#667064", fontSize: 7 }}>{!allowed ? "water transfer held" : mode === "water-priority" ? "chargers shed for pump demand" : chargerOn ? "surplus charging active" : "higher-priority loads protected"}</div>
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

      <div style={{ marginTop: 8, padding: 8, border: "1px solid #3B462C", borderRadius: 9, background: "#12160E" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center" }}>
          <div>
            <div style={{ color: "#87937B", fontSize: 7, fontWeight: 850, letterSpacing: 1 }}>OPERATOR CONTROL</div>
            <div style={{ color: "#656F60", fontSize: 6.5, marginTop: 2 }}>Shed charging is lowest priority. Auto mode uses spare solar and yields to water transfer.</div>
          </div>
          <button onClick={() => aeolus.fire("toggle-opportunity")} disabled={chargerPending} style={{ minWidth: 135, borderRadius: 8, padding: "8px", border: "1px solid " + (autoOpportunity ? "#3C5E3F" : "#353A32"), background: autoOpportunity ? "#132218" : "#161A15", color: autoOpportunity ? "#8DD49A" : "#879083", fontSize: 8, cursor: chargerPending ? "wait" : "pointer" }}>Opportunity charging {autoOpportunity ? "AUTO" : "OFF"}</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 5, marginTop: 7, fontSize: 6.5 }}>
          <div style={{ padding: "5px 6px", borderRadius: 6, background: "#171B13", color: "#9BA594" }}><b>1</b> Essential farm load</div>
          <div style={{ padding: "5px 6px", borderRadius: 6, background: pumpLoad > 0 ? "#10232A" : "#171B13", color: pumpLoad > 0 ? "#83DCEB" : "#9BA594" }}><b>2</b> Water transfer</div>
          <div style={{ padding: "5px 6px", borderRadius: 6, background: chargerOn ? "#142319" : "#171B13", color: chargerOn ? "#8DD49A" : "#777F74" }}><b>3</b> Shed charging</div>
        </div>
      </div>

      <div style={{ marginTop: 7, padding: 8, border: "1px dashed #615034", borderRadius: 9, background: "#19140D" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div><div style={{ color: "#C99F64", fontSize: 7, fontWeight: 850, letterSpacing: 1 }}>DEMO SCENARIO</div><div style={{ color: "#776752", fontSize: 6.5, marginTop: 2 }}>Injects weather/reserve conditions into the simulated site.</div></div>
          {demoScenarioPending && <div style={{ color: "#D7A66B", fontSize: 7 }}>INJECTING…</div>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr .9fr .65fr", gap: 6 }}>
          <button onClick={() => aeolus.fire("simulate-low-battery")} disabled={!available || !!demoScenarioPending} style={{ borderRadius: 8, padding: "8px", border: "1px solid #6C4A2F", background: "#25180F", color: !available || demoScenarioPending ? "#735E4C" : "#E5A268", fontSize: 8, fontWeight: 750, cursor: !available || demoScenarioPending ? "not-allowed" : "pointer" }}>Cloud + low reserve</button>
          <button onClick={() => aeolus.fire("restore-battery")} disabled={available || !!demoScenarioPending} style={{ borderRadius: 8, padding: "8px", border: "1px solid #315B3C", background: "#102319", color: available || demoScenarioPending ? "#516A57" : "#83D99A", fontSize: 8, cursor: available || demoScenarioPending ? "not-allowed" : "pointer" }}>Restore nominal</button>
          <button onClick={() => aeolus.fire("reset-energy")} style={{ borderRadius: 8, padding: "8px", border: "1px solid #433B30", background: "#181510", color: "#8E8678", fontSize: 8, cursor: "pointer" }}>Reset demo</button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, marginTop: 7, alignItems: "center" }}>
        <div style={{ color: "#6D756A", fontSize: 8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{actionLabel}</div>
        <div style={{ color: chargerOn ? "#8DCF99" : pumpLoad > 0 ? "#75CEDD" : "#626B61", fontSize: 7, whiteSpace: "nowrap" }}>{chargerOn ? "CHARGER BANK ON" : pumpLoad > 0 ? "CHARGERS YIELD TO WATER" : "CHARGER BANK SHED"} · site net {netKw >= 0 ? "+" : ""}{netKw.toFixed(2)} kW</div>
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
