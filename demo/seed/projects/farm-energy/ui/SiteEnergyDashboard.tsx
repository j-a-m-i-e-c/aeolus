// farm-energy — visual implementation behind ui/index.tsx
import { useEffect, useState } from "react";
import { toggleProps } from "@aeolus/ui";
export default function SiteEnergyDashboard({ model, actions }: {
    model: Record<string, any>;
    actions: Record<string, (...args: any[]) => void>;
}) {
    const soc = Math.max(0, Math.min(100, Number(model.batterySoc ?? 78)));
    const solar = Math.max(0, Number(model.solarKw ?? 2.1));
    const load = Math.max(0, Number(model.loadKw ?? .72));
    const baseLoad = Math.max(0, Number(model.baseLoadKw ?? .72));
    const pumpLoad = Math.max(0, Number(model.pumpKw ?? 0));
    const chargerLoad = Math.max(0, Number(model.chargerKw ?? 0));
    const chargerOn = Boolean(model.chargerOn) || chargerLoad > 0;
    const available = model.batteryAvailable !== false && soc >= 30;
    const allowed = model.allowed !== false && available;
    const solarMargin = Number(model.solarMarginKw ?? (solar - (load - chargerLoad)));
    const netKw = Number(model.netKw ?? (solar - load));
    const mode = String(model.energyMode ?? "solar-surplus");
    const autoOpportunity = model.autoOpportunity !== false;
    const chargerPending = Boolean(model.chargerCommandPending);
    const demoScenarioPending = String(model.demoScenarioPending ?? "");
    const lastAction = model.lastAction as any;
    const [phase, setPhase] = useState(0);
    useEffect(() => {
        const id = setInterval(() => setPhase((v) => (v + 1) % 100000), 100);
        return () => clearInterval(id);
    }, []);
    const net = solar - load;
    const status = mode === "reserve-protection" ? "RESERVE PROTECTION" : mode === "water-priority" ? "WATER PRIORITY" : mode === "opportunity-charging" ? "OPPORTUNITY CHARGING" : mode === "solar-surplus" ? "SOLAR SURPLUS" : mode === "battery-support" ? "BATTERY SUPPORT" : "BALANCED";
    const statusColor = mode === "reserve-protection" ? "#F09B61" : mode === "water-priority" ? "#73DDF1" : mode === "opportunity-charging" ? "#8DE59A" : mode === "solar-surplus" ? "#B6DE78" : mode === "battery-support" ? "#E6C26B" : "#8AB7A0";
    const actionLabel = lastAction?.label ? String(lastAction.label) : "Energy telemetry online";
    const opportunityVisual = toggleProps(autoOpportunity, { pending: chargerPending });
    function FlowDots(props: {
        x1: number;
        x2: number;
        y: number;
        active: boolean;
        reverse?: boolean;
        color: string;
    }) {
        if (!props.active)
            return null;
        return <g>{Array.from({ length: 5 }).map((_, i) => {
                const t = ((phase * .025 + i / 5) % 1);
                const p = props.reverse ? 1 - t : t;
                return <circle key={i} cx={props.x1 + (props.x2 - props.x1) * p} cy={props.y} r="2.2" fill={props.color} opacity=".85"/>;
            })}</g>;
    }
    function LoadBar(props: {
        label: string;
        value: number;
        max: number;
        active?: boolean;
    }) {
        const pct = Math.max(0, Math.min(100, props.value / props.max * 100));
        return <div style={{ display: "grid", gridTemplateColumns: "88px 1fr 48px", gap: 7, alignItems: "center", marginTop: 6 }}>
      <div style={{ color: props.active ? "#DCE7DB" : "#6E796E", fontSize: 11 }}>{props.label}</div>
      <div style={{ height: 5, borderRadius: 5, background: "#222A22", overflow: "hidden" }}><div style={{ width: pct + "%", height: "100%", background: props.active ? "#7AA984" : "#48564B" }}/></div>
      <div style={{ color: props.active ? "#CED9CD" : "#69746A", textAlign: "right", fontSize: 11, fontFamily: "monospace" }}>{props.value.toFixed(2)} kW</div>
    </div>;
    }
    return (<div style={{ padding: 12, minHeight: "100%", background: "linear-gradient(180deg,#10120C,#0B0E0A)", color: "#EDEFE8" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 850 }}>SITE ENERGY</div>
          <div style={{ color: "#777B68", fontSize: 11, marginTop: 2 }}>Local load policy · essential loads → water transfer → opportunity charging</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: statusColor, fontSize: 11, fontWeight: 800 }}>{status}</div>
          <div style={{ color: "#667064", fontSize: 11 }}>{!allowed ? "water transfer held" : mode === "water-priority" ? "chargers shed for pump demand" : chargerOn ? "surplus charging active" : "higher-priority loads protected"}</div>
        </div>
      </div>

      <div style={{ border: "1px solid #363823", background: "#10120C", borderRadius: 11, padding: 10 }}>
        <svg width="100%" height="150" viewBox="0 0 520 150">
          <rect width="520" height="150" rx="8" fill="#0F120C"/>
          <g transform="translate(28 37)">
            <path d="M0 25 L48 0 L96 25 L48 50 Z" fill="#2F3318" stroke="#8D8336"/>
            <path d="M18 28 L48 12 L78 28 L48 42 Z" fill="#CBB84C" opacity=".7"/>
            <text x="48" y="66" textAnchor="middle" fill="#7E8069" fontSize="10">SOLAR ARRAY</text>
            <text x="48" y="81" textAnchor="middle" fill="#F0D969" fontSize="14" fontFamily="monospace" fontWeight="800">{solar.toFixed(1)} kW</text>
          </g>
          <line x1="126" y1="63" x2="205" y2="63" stroke="#363F27" strokeWidth="4"/>
          <FlowDots x1={126} x2={205} y={63} active={solar > .05} color="#E5D45D"/>

          <g transform="translate(208 21)">
            <rect width="90" height="92" rx="11" fill="#121813" stroke={available ? "#6FA978" : "#B66A3B"} strokeWidth="2"/>
            <rect x="8" y={84 - Math.max(6, soc * .72)} width="74" height={Math.max(6, soc * .72)} rx="6" fill={available ? "#4FAE68" : "#B85C39"} opacity=".8"/>
            <text x="45" y="43" textAnchor="middle" fill="#F3F5EF" fontSize="20" fontFamily="monospace" fontWeight="850">{Math.round(soc)}%</text>
            <text x="45" y="107" textAnchor="middle" fill="#737D72" fontSize="10">BATTERY RESERVE</text>
          </g>

          <line x1="300" y1="63" x2="382" y2="63" stroke="#344039" strokeWidth="4"/>
          <FlowDots x1={300} x2={382} y={63} active={Math.abs(net) > .03} reverse={net < 0} color={net >= 0 ? "#78D98C" : "#E2B764"}/>

          <g transform="translate(386 25)">
            <rect width="105" height="80" rx="9" fill="#121713" stroke="#435047"/>
            <text x="52" y="17" textAnchor="middle" fill="#727D73" fontSize="10">FARM LOAD BUS</text>
            <text x="52" y="43" textAnchor="middle" fill="#E0E7DF" fontSize="18" fontFamily="monospace" fontWeight="800">{load.toFixed(2)}</text>
            <text x="52" y="55" textAnchor="middle" fill="#657066" fontSize="10">kW total</text>
            <text x="52" y="70" textAnchor="middle" fill={net >= 0 ? "#7DD990" : "#E1B36A"} fontSize="10">{net >= 0 ? "+" : ""}{net.toFixed(2)} kW site net</text>
          </g>
        </svg>

        <div style={{ borderTop: "1px solid #252B20", paddingTop: 5 }}>
          <LoadBar label="Base farm load" value={baseLoad} max={1.5} active={true}/>
          <LoadBar label="Water transfer pump" value={pumpLoad} max={1.2} active={pumpLoad > 0}/>
          <LoadBar label="Shed charger bank" value={chargerLoad} max={.5} active={chargerOn}/>
        </div>
      </div>

      <div style={{ marginTop: 8, padding: 8, border: "1px solid #3B462C", borderRadius: 9, background: "#12160E" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center" }}>
          <div>
            <div style={{ color: "#87937B", fontSize: 11, fontWeight: 850, letterSpacing: 1 }}>OPERATOR CONTROL</div>
            <div style={{ color: "#656F60", fontSize: 11, marginTop: 2 }}>Shed charging is lowest priority. Auto mode uses spare solar and yields to water transfer.</div>
          </div>
          <button {...opportunityVisual} style={{ ...opportunityVisual.style, minWidth: 135, padding: "8px" }} onClick={() => actions.toggleOpportunity()}>{chargerPending ? "Switching charging…" : "Opportunity charging " + (autoOpportunity ? "AUTO" : "OFF")}</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 5, marginTop: 7, fontSize: 11 }}>
          <div style={{ padding: "5px 6px", borderRadius: 6, background: "#171B13", color: "#9BA594" }}><b>1</b> Essential farm load</div>
          <div style={{ padding: "5px 6px", borderRadius: 6, background: pumpLoad > 0 ? "#10232A" : "#171B13", color: pumpLoad > 0 ? "#83DCEB" : "#9BA594" }}><b>2</b> Water transfer</div>
          <div style={{ padding: "5px 6px", borderRadius: 6, background: chargerOn ? "#142319" : "#171B13", color: chargerOn ? "#8DD49A" : "#777F74" }}><b>3</b> Shed charging</div>
        </div>
      </div>

      <div style={{ marginTop: 16, padding: 8, border: "1px dashed #615034", borderRadius: 9, background: "#19140D" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div><div style={{ color: "#C99F64", fontSize: 11, fontWeight: 850, letterSpacing: 1 }}>DEMO SCENARIO</div><div style={{ color: "#776752", fontSize: 11, marginTop: 2 }}>Injects weather/reserve conditions into the simulated site.</div></div>
          {demoScenarioPending && <div style={{ color: "#D7A66B", fontSize: 11 }}>INJECTING…</div>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr .9fr .65fr", gap: 6 }}>
          <button onClick={() => actions.simulateLowBattery()} disabled={!available || !!demoScenarioPending} style={{ borderRadius: 8, padding: "8px", border: "1px solid #6C4A2F", background: "#25180F", color: !available || demoScenarioPending ? "#735E4C" : "#E5A268", fontSize: 11, fontWeight: 750, cursor: !available || demoScenarioPending ? "not-allowed" : "pointer" }}>Cloud + low reserve</button>
          <button onClick={() => actions.restoreBattery()} disabled={available || !!demoScenarioPending} style={{ borderRadius: 8, padding: "8px", border: "1px solid #315B3C", background: "#102319", color: available || demoScenarioPending ? "#516A57" : "#83D99A", fontSize: 11, cursor: available || demoScenarioPending ? "not-allowed" : "pointer" }}>Restore nominal</button>
          <button onClick={() => actions.resetEnergy()} style={{ borderRadius: 8, padding: "8px", border: "1px solid #433B30", background: "#181510", color: "#8E8678", fontSize: 11, cursor: "pointer" }}>Reset demo</button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, marginTop: 7, alignItems: "center" }}>
        <div style={{ color: "#6D756A", fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{actionLabel}</div>
        <div style={{ color: chargerOn ? "#8DCF99" : pumpLoad > 0 ? "#75CEDD" : "#626B61", fontSize: 11, whiteSpace: "nowrap" }}>{chargerOn ? "CHARGER BANK ON" : pumpLoad > 0 ? "CHARGERS YIELD TO WATER" : "CHARGER BANK SHED"} · site net {netKw >= 0 ? "+" : ""}{netKw.toFixed(2)} kW</div>
      </div>
    </div>);
}
