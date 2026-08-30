// farm-livestock — visual implementation behind ui/index.tsx
import { useEffect, useMemo, useState } from "react";
export default function LivestockDashboard({ model, actions }: {
    model: Record<string, any>;
    actions: Record<string, (...args: any[]) => void>;
}) {
    const strays = Math.max(0, Number(model.strays ?? 0));
    const herd = Math.max(0, Number(model.herd ?? 30));
    const tracked = Math.max(0, Number(model.tracked ?? 30));
    const avgBattery = Math.max(0, Math.min(100, Number(model.avgBattery ?? 74)));
    const paddock = String(model.paddock ?? "A");
    const breachSector = String(model.breachSector ?? "");
    const movement = String(model.movement ?? "grazing");
    const voltage = Number(model.voltage ?? 7.2);
    const fenceCurrent = Number(model.fenceCurrent ?? 0.4);
    const fault = Boolean(model.fenceFault);
    const recallInProgress = Boolean(model.recallInProgress);
    const demoScenarioPending = String(model.demoScenarioPending ?? "");
    const lastAction = model.lastAction as any;
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
    function Cow(props: {
        x: number;
        y: number;
        stray?: boolean;
        faded?: boolean;
        seed: number;
    }) {
        const bob = Math.sin(phase * .045 + props.seed) * 2.5;
        const sway = Math.cos(phase * .037 + props.seed) * 3.5;
        const color = props.stray ? "#FF786A" : props.faded ? "#7C7459" : "#D6C08B";
        return <g transform={"translate(" + (props.x + sway) + " " + (props.y + bob) + ")"} opacity={props.faded ? .42 : 1}>
      {props.stray && <circle r="10" fill="none" stroke="#FF6A5E" strokeOpacity={.25 + (Math.sin(phase * .15 + props.seed) + 1) * .22}/>}
      <ellipse rx="6.5" ry="3.7" fill={color}/>
      <circle cx="5.5" cy="-1" r="2.5" fill={color}/>
      <line x1="-3" y1="3" x2="-4" y2="7" stroke={color} strokeWidth="1.3"/>
      <line x1="3" y1="3" x2="4" y2="7" stroke={color} strokeWidth="1.3"/>
    </g>;
    }
    return (<div style={{ padding: 12, minHeight: "100%", background: "linear-gradient(180deg,#0B120E,#080D0A)", color: "#E8EEE9" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 850 }}>LIVESTOCK & VIRTUAL FENCE</div>
          <div style={{ color: "#68786E", fontSize: 11, marginTop: 2 }}>30 GPS collars · rotational paddocks · verified recall</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: recallInProgress ? "#F3C568" : alert ? "#FF776B" : "#7CEB9B", fontSize: 11, fontWeight: 800 }}>{mainStatus}</div>
          <div style={{ color: "#657269", fontSize: 11 }}>{tracked}/{herd} tracked · {Math.round(avgBattery)}% collar battery</div>
        </div>
      </div>

      <div style={{ border: "1px solid " + (alert ? "#5F302B" : fault ? "#62452D" : "#294234"), borderRadius: 11, overflow: "hidden", background: "#09130D" }}>
        <svg width="100%" height="235" viewBox="0 0 470 235">
          <rect width="470" height="235" fill="#09140D"/>
          <path d="M25 35 L220 30 L225 202 L35 207 Z" fill={activeA ? "#18391F" : "#112719"} stroke={activeA ? "#67D88A" : "#355540"} strokeWidth="1.4" strokeDasharray="7 5"/>
          <path d="M243 30 L434 38 L446 199 L238 202 Z" fill={!activeA ? "#18391F" : "#112719"} stroke={!activeA ? "#67D88A" : "#355540"} strokeWidth="1.4" strokeDasharray="7 5"/>
          <text x="38" y="25" fill={activeA ? "#82E8A0" : "#587262"} fontSize="10" letterSpacing="1.2">PADDOCK A</text>
          <text x="250" y="25" fill={!activeA ? "#82E8A0" : "#587262"} fontSize="10" letterSpacing="1.2">PADDOCK B</text>
          <path d="M229 25 L233 210" stroke="#2D4936" strokeWidth="2" strokeDasharray="3 5"/>

          {cattle.map((cow, i) => {
            const isStray = i < strays;
            const baseX = activeA ? 58 + cow.col * 25 : 270 + cow.col * 24;
            const baseY = 62 + cow.row * 29;
            const returnProgress = movement === "returning" ? Math.min(1, ((phase * .025 + i * .02) % 1)) : 0;
            const strayX = breachSector === "west" ? 8 : 456;
            const x = isStray ? strayX + (activeA ? -returnProgress * 210 : -returnProgress * 90) : baseX;
            const y = isStray ? 76 + i * 42 : baseY;
            return <Cow key={i} x={x} y={y} stray={isStray} seed={cow.seed}/>;
        })}

          {recallInProgress && Array.from({ length: 4 }).map((_, i) => <path key={i} d="M438 86 C390 95 350 110 310 128" fill="none" stroke="#F0C967" strokeWidth="2" strokeDasharray="5 7" strokeDashoffset={-(phase * 2 + i * 12)} opacity={.35 + i * .12}/>)}

          <g transform="translate(310 169)">
            <rect width="145" height="54" rx="9" fill="#0A120D" stroke={fault ? "#7B4439" : "#31543B"}/>
            <text x="10" y="14" fill="#6D7C73" fontSize="10">PHYSICAL FENCE BACKSTOP</text>
            <text x="10" y="34" fill={fault ? "#FF7A6F" : "#78E99A"} fontSize="16" fontFamily="monospace" fontWeight="700">{voltage.toFixed(1)} kV</text>
            <text x="91" y="34" fill="#7E8D84" fontSize="10">{fenceCurrent.toFixed(2)} A</text>
            <text x="10" y="47" fill={fault ? "#F39A7D" : "#56695E"} fontSize="10">{fault ? "FAULT · boundary degraded" : "energiser healthy"}</text>
          </g>
        </svg>
      </div>

      <div style={{ marginTop: 8, padding: 8, border: "1px solid #2D4836", borderRadius: 9, background: "#0C1710" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <div><div style={{ color: "#74877A", fontSize: 11, fontWeight: 850, letterSpacing: 1 }}>OPERATOR CONTROL</div><div style={{ color: "#5C6E62", fontSize: 11, marginTop: 2 }}>Recall is a real verified command to the virtual-fence/collar system.</div></div>
          <button onClick={() => actions.recallStrays()} disabled={!alert || recallInProgress} style={{ minWidth: 135, borderRadius: 8, padding: "8px 6px", border: "1px solid " + (alert ? "#743B34" : "#304138"), background: alert ? "#2A1714" : "#121A15", color: alert ? "#FF9A8D" : "#68766D", fontSize: 11, fontWeight: 750, cursor: alert && !recallInProgress ? "pointer" : "not-allowed" }}>{recallInProgress ? "Recalling…" : alert ? "Recall herd" : "No recall required"}</button>
        </div>
      </div>

      <div style={{ marginTop: 7, padding: 8, border: "1px dashed #5A5132", borderRadius: 9, background: "#17150D" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}><div><div style={{ color: "#C5AA67", fontSize: 11, fontWeight: 850, letterSpacing: 1 }}>DEMO SCENARIO</div><div style={{ color: "#746D57", fontSize: 11, marginTop: 2 }}>Injects livestock movement and fence conditions into the simulated property.</div></div>{demoScenarioPending && <div style={{ color: "#D4B770", fontSize: 11 }}>INJECTING…</div>}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 6 }}>
          <button onClick={() => actions.simulateStrays()} disabled={!!demoScenarioPending || recallInProgress || alert} style={{ borderRadius: 8, padding: "8px 5px", border: "1px solid #5F4930", background: "#21190F", color: demoScenarioPending || alert ? "#756A55" : "#D8B978", fontSize: 11, cursor: demoScenarioPending || alert ? "not-allowed" : "pointer" }}>Boundary breach</button>
          <button onClick={() => actions.moveHerd()} disabled={!!demoScenarioPending || alert || recallInProgress} style={{ borderRadius: 8, padding: "8px 5px", border: "1px solid #465238", background: "#171D11", color: demoScenarioPending || alert ? "#68705D" : "#AEBE82", fontSize: 11, cursor: demoScenarioPending || alert ? "not-allowed" : "pointer" }}>Herd changes paddock</button>
          <button onClick={() => actions.toggleFenceFault(fault)} disabled={!!demoScenarioPending} style={{ borderRadius: 8, padding: "8px 5px", border: "1px solid " + (fault ? "#315B3C" : "#62452D"), background: fault ? "#102319" : "#251C10", color: demoScenarioPending ? "#746B57" : fault ? "#83D99A" : "#E0B071", fontSize: 11, cursor: demoScenarioPending ? "not-allowed" : "pointer" }}>{fault ? "Restore fence" : "Fence fault"}</button>
          <button onClick={() => actions.resetLivestock()} style={{ borderRadius: 8, padding: "8px 5px", border: "1px solid #3C3A30", background: "#171713", color: "#8D8878", fontSize: 11, cursor: "pointer" }}>Reset demo</button>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 7 }}>
        <div style={{ color: "#66736B", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{actionLabel}</div>
        <div style={{ color: "#506057", fontSize: 11, whiteSpace: "nowrap" }}>Current paddock {paddock} · {movement.replace(/-/g, " ")}</div>
      </div>
    </div>);
}
