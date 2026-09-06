// vessel-ctd — visual implementation behind ui/index.tsx
import { useEffect, useState } from "react";
import { commandLadder, commandVerdict, control, decimal, integer, metres, salinity as psu, rungProps, temperature, verdictProps } from "@aeolus/ui";
function clamp(v: number, a: number, b: number) { return Math.min(b, Math.max(a, v)); }
/** The wire's phase in the words a deck operator would use. */
const PHASE_LABEL: Record<string, string> = {
    "on-deck": "ON DECK",
    deploying: "DESCENDING",
    "at-depth": "AT DEPTH",
    recovering: "ASCENDING",
    holding: "HOLDING DEPTH",
};
export default function CtdOperationsDashboard({ model, actions }: {
    model: Record<string, any>;
    actions: Record<string, (...args: any[]) => void>;
}) {
    const depth = clamp(Number(model.depth ?? 3), 0, 500);
    const target = clamp(Number(model.targetDepth ?? 420), 0, 500);
    const status = String(model.status || "on-deck");
    const tension = Number(model.tension ?? 220);
    const pending = Boolean(model.commandPending);
    const interlockAt = Number(model.interlockAt ?? 0);
    const last = model.lastAction as any;
    const [phase, setPhase] = useState(0);
    useEffect(() => { const id = setInterval(() => setPhase(v => (v + 1) % 100000), 90); return () => clearInterval(id); }, []);
    const action = last?.label ? String(last.label) : "CTD on deck · ready to deploy";
    const tensionHigh = tension >= 650;
    const onDeck = status === "on-deck", deploying = status === "deploying", recovering = status === "recovering", holding = status === "holding", atDepth = status === "at-depth";
    const moving = deploying || recovering;
    // Paused above the target, the next descent is a resumption rather than a new
    // cast, so the control says so instead of pretending nothing happened.
    const canResume = holding && depth < target - 5;
    const tempAt = (d: number) => 18.5 - 14.3 / (1 + Math.exp(-(d - 90) / 18));
    const salAt = (d: number) => 35.0 - .4 / (1 + Math.exp(-(d - 90) / 40));
    const points: number[] = [];
    for (let d = 0; d <= Math.max(30, depth); d += 18)
        points.push(d);
    if (points[points.length - 1] !== depth)
        points.push(depth);
    const y = (d: number) => 24 + d / 500 * 185;
    const tx = (t: number) => 210 + (t - 3) / 16 * 105;
    const sx = (s: number) => 335 + (s - 34.55) / .55 * 92;
    const tPath = points.map((d, i) => (i ? "L" : "M") + tx(tempAt(d)).toFixed(1) + "," + y(d).toFixed(1)).join(" ");
    const sPath = points.map((d, i) => (i ? "L" : "M") + sx(salAt(d)).toFixed(1) + "," + y(d).toFixed(1)).join(" ");
    // Deploy is the only meaningful action on deck and the state the wire is
    // already in at depth. Hold only exists while the drum is turning. Recover is
    // available the moment the package is in the water, including mid-descent,
    // because reversing out of trouble must never require a Hold first.
    const deployVisual = control({ pending: pending && !moving, current: deploying, disabled: atDepth });
    const holdVisual = control({ pending, disabled: !moving });
    const recoverVisual = control({ pending: pending && !moving, current: recovering, disabled: onDeck });
    const deployLabel = deploying ? "Descending to " + Math.round(target) + " m"
        : atDepth ? "On station at " + Math.round(target) + " m"
            : canResume ? "Resume descent to " + Math.round(target) + " m"
                : "Deploy to " + Math.round(target) + " m";
    const verdict = commandVerdict(model.lastCommand), rungs = commandLadder(model.lastCommand);
 return <div style={{ padding: 11, minHeight: "100%", background: "linear-gradient(180deg,#09131A,#061018)", color: "#EDF2F4" }}>
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 7 }}><div><div style={{ fontSize: 12, fontWeight: 900 }}>CTD OPERATIONS</div><div style={{ color: "#687C87", fontSize: 11, marginTop: 2 }}>Winch control · water-column profile · cable-tension protection</div></div><div style={{ textAlign: "right" }}><div style={{ color: tensionHigh ? "#EF8A67" : moving ? "#69D7EF" : onDeck ? "#84DBA2" : "#9FD3B4", fontSize: 11, fontWeight: 850 }}>{tensionHigh ? "TENSION INTERLOCK" : (PHASE_LABEL[status] || status.toUpperCase())}</div><div style={{ color: "#60737D", fontSize: 11 }}>{metres(depth)} · target {metres(target)}</div></div></div>
    <div style={{ border: "1px solid #1F3948", borderRadius: 10, background: "#05131C", overflow: "hidden" }}><svg width="100%" height="220" viewBox="0 0 500 220">
      <rect width="190" height="220" fill="#08283E"/><rect y="42" width="190" height="178" fill="#061A2A"/><path d="M0 42 Q45 36 95 42 T190 42" fill="none" stroke="#62BDD7" opacity=".45"/>
      {[0, 100, 200, 300, 400, 500].map(d => <g key={d}><line x1="0" y1={y(d)} x2="190" y2={y(d)} stroke="#315369" opacity=".23"/><text x="5" y={y(d) - 2} fill="#527489" fontSize="10">{d}</text></g>)}
      <line x1="92" y1="31" x2="92" y2={y(depth)} stroke="#A7B7BC"/><g transform={"translate(92 " + y(depth) + ")"}><circle r="9" fill="#E5A64B" stroke="#FFD07B"/><rect x="-6" y="-12" width="12" height="3" fill="#C4CED0"/></g>
      {moving && Array.from({ length: 4 }).map((_, i) => <circle key={i} cx="92" cy={50 + ((phase * 2 + i * 38) % Math.max(30, y(depth) - 50))} r="1.5" fill="#70DBF3"/>)}
      <text x="108" y={y(depth) + 3} fill="#F2C06F" fontSize="10">{metres(depth)}</text>
      <rect x="190" width="310" height="220" fill="#071018"/><text x="210" y="15" fill="#6B818D" fontSize="10" letterSpacing="1">{onDeck ? "NO CAST YET" : "LIVE PROFILE"}</text>
      {[0, 100, 200, 300, 400, 500].map(d => <line key={d} x1="210" y1={y(d)} x2="474" y2={y(d)} stroke="#1A2F3B"/>)}<path d={tPath} fill="none" stroke="#F0A84A" strokeWidth="2"/><path d={sPath} fill="none" stroke="#51D1EA" strokeWidth="1.7" strokeDasharray="4 3"/>
      <line x1="210" y1={y(depth)} x2="474" y2={y(depth)} stroke="#6ED899" strokeDasharray="3 3"/><text x="212" y="208" fill="#F0A84A" fontSize="10">TEMP {temperature(model.temperature)}</text><text x="302" y="208" fill="#51D1EA" fontSize="10">SAL {psu(model.salinity)}</text><text x="404" y="208" fill="#83D29D" fontSize="10">O₂ {decimal(model.oxygen, 1)}</text>
    </svg></div>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 7 }}><div style={{ border: "1px solid " + (tensionHigh ? "#75412F" : "#263C47"), borderRadius: 8, padding: 7, background: "#081117" }}><div style={{ color: "#687D87", fontSize: 11 }}>CABLE TENSION</div><div style={{ color: tensionHigh ? "#F08B69" : "#C8D5D9", fontFamily: "monospace", fontSize: 14, fontWeight: 800, marginTop: 2 }}>{integer(tension)} N</div><div style={{ height: 5, background: "#17262E", borderRadius: 4, overflow: "hidden", marginTop: 4 }}><div style={{ height: "100%", width: Math.min(100, tension / 8) + "%", background: tensionHigh ? "#D76645" : "#4EACC1" }}/></div>
      {/* An automatic action the operator cannot account for is worse than none. */}
      {interlockAt > 0 && <div style={{ color: "#E9A97E", fontSize: 11, marginTop: 4 }}>Aeolus arrested the winch automatically</div>}</div><div style={{ border: "1px solid #263C47", borderRadius: 8, padding: 7, background: "#081117" }}><div style={{ color: "#687D87", fontSize: 11 }}>VERTICAL SPEED</div><div style={{ color: "#B9C9CF", fontFamily: "monospace", fontSize: 14, fontWeight: 800, marginTop: 2 }}>{decimal(model.verticalSpeed, 1)} m/s</div><div style={{ color: "#596E78", fontSize: 11, marginTop: 5 }}>Profile values are physical sonde MQTT state.</div></div></div>
    <div style={{ marginTop: 7, border: "1px solid #263E49", borderRadius: 9, padding: 8, background: "#07141C" }}><div style={{ color: "#80939C", fontSize: 11, letterSpacing: ".12em", marginBottom: 6 }}>OPERATOR CONTROLS</div><div style={{ display: "flex", gap: 5 }}><button {...deployVisual} style={{ ...deployVisual.style, flex: 1 }} onClick={() => actions.deploy420()}>{deployLabel}</button><button {...holdVisual} style={{ ...holdVisual.style, padding: "7px 9px" }} onClick={() => actions.holdCtd()}>Pause winch</button><button {...recoverVisual} style={{ ...recoverVisual.style, padding: "7px 9px" }} onClick={() => actions.recoverCtd()}>{recovering ? "Recovering to deck…" : "Recover to deck"}</button></div></div>
    <div style={{ marginTop: 16, border: "1px dashed #69502E", borderRadius: 9, padding: 8, background: "#171309" }}><div style={{ color: "#D8B66D", fontSize: 11, letterSpacing: ".12em" }}>DEMO SCENARIO</div><div style={{ color: "#806F50", fontSize: 11, margin: "3px 0 6px" }}>Inject a physical cable problem. The CTD automation should arrest the winch itself.</div><div style={{ display: "flex", gap: 5 }}><button onClick={() => actions.simulateSnag()} style={{ flex: 1, padding: "6px", borderRadius: 6, border: "1px solid #6A5130", background: "#21180B", color: "#E3B866", fontSize: 11, cursor: "pointer" }}>Inject cable snag</button><button onClick={() => actions.resetCtd()} style={{ padding: "6px 9px", borderRadius: 6, border: "1px solid #454138", background: "#171713", color: "#898B82", fontSize: 11, cursor: "pointer" }}>Reset cast</button></div></div>
    <div style={{ color: "#5B6E77", fontSize: 11, marginTop: 6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{action}</div>
      {/* What the last command actually proved. Every rung is a durable record the
        runtime wrote, not a step this pane inferred from the outcome. */}
    {verdict && <div style={{ marginTop: 8, border: "1px solid #263E49", borderRadius: 9, padding: 9, background: "#07141C" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 5 }}><div style={{ fontSize: 11, color: "#80939C", letterSpacing: ".1em" }}>COMMAND EVIDENCE</div><div style={verdictProps(verdict)}>{verdict.headline}</div></div>
      {rungs.map((rung: any) => { const rv = rungProps(rung); return <div key={rung.state} style={rv.style}><span>{rv.mark}</span><span>{rung.label}</span>{rung.detail && <span style={{ color: "#5B6E77" }}>{rung.detail}</span>}</div>; })}
      <div style={{ fontSize: 11, color: "#5B6E77", marginTop: 5 }}>{verdict.clampNote || verdict.detail}</div>
    </div>}
    </div>;
}
