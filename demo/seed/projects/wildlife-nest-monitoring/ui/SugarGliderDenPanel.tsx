// wildlife-nest-monitoring — visual implementation behind ui/index.tsx
function Glider({ x, y, small = false }: {
    x: number;
    y: number;
    small?: boolean;
}) { const s = small ? .72 : 1; return <g transform={"translate(" + x + " " + y + ") scale(" + s + ")"} fill="#A8B39E" stroke="#A8B39E"><ellipse rx="14" ry="8"/><circle cx="13" cy="-7" r="6"/><circle cx="10" cy="-12" r="3"/><circle cx="17" cy="-12" r="3"/><circle cx="15" cy="-8" r="1.4" fill="#10130F" stroke="none"/><path d="M-12 -1 Q-29 -12 -34 0 Q-31 12 -19 11" fill="none" strokeWidth="3"/><path d="M-1 5 L-11 13 L7 9 Z" opacity=".65"/></g>; }
/** The den fan, drawn turning at the speed the tachometer actually reports. */
function Fan({ x, y, measuredRpm }: {
    x: number;
    y: number;
    measuredRpm: number;
}) {
    // One revolution of the drawing per revolution of a slow fan: fast enough to
    // read as spinning, and it stops dead when the tachometer reads zero.
    const spinning = measuredRpm > 60;
    const period = spinning ? Math.max(.28, 900 / measuredRpm) : 0;
    const colour = spinning ? "#8FD3E4" : "#5C6660";
    return <g transform={"translate(" + x + " " + y + ")"}>
      <circle r="17" fill="#101613" stroke="#54615B"/>
      <g fill={colour} stroke={colour} strokeWidth="1.5">
        {spinning && <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur={period + "s"} repeatCount="indefinite"/>}
        <path d="M0 -3 Q10 -12 13 -2 Q4 -1 0 -3" fill={colour}/>
        <path d="M2 2 Q13 6 5 12 Q1 5 2 2" fill={colour}/>
        <path d="M-3 1 Q-13 6 -12 -4 Q-4 -2 -3 1" fill={colour}/>
      </g>
      <circle r="2.6" fill="#243029" stroke={colour}/>
    </g>;
}
import { control, percent, rpm, temperature, toggleProps, watts } from "@aeolus/ui";
export default function SugarGliderDenPanel({ model, actions }: {
    model: Record<string, any>;
    actions: Record<string, (...args: any[]) => void>;
}) {
    const temp = Number(model.temp ?? 31.8), humidity = Number(model.humidity ?? 61), adult = Boolean(model.adultPresent), adults = Number(model.adultGliders ?? 2), joeys = Number(model.joeys ?? 2), visits = Number(model.visits ?? 7), alert = Boolean(model.thermalAlert), last = model.lastAction as any;
    const thermalState = String(model.thermalState || "normal"), auto = model.autoCooling !== false, pending = Boolean(model.commandPending);
    const fanActive = Boolean(model.fanActive), measured = Number(model.fanMeasuredRpm ?? 0);
    const outcome = String(model.coolingOutcome || "Den box within range · fan idle");
    // The tachometer is the observation the cooling command waited on, so it is
    // called out only once it proves the impeller is genuinely moving air.
    const verified = measured >= Number(model.fanTargetRpm ?? 1800) * .8;
    const color = alert ? "#ED8A68" : thermalState === "cooling" ? "#8FD3E4" : "#79D39B";
    // Automatic cooling is a policy switch, so it stays pressable; stopping the fan
    // only exists while one is physically turning.
    const autoVisual = toggleProps(auto, { pending });
    const stopVisual = control({ pending, disabled: !fanActive });
    return <div style={{ padding: 13, minHeight: "100%", background: "linear-gradient(180deg,#0C100C,#080A08)", color: "#EFF3EC" }}><div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10, gap: 10 }}><div><div style={{ fontSize: 17, fontWeight: 900 }}>SUGAR GLIDER DEN</div><div style={{ fontSize: 12, color: "#89958A", marginTop: 3 }}>Den-box microclimate · occupancy · verified cooling</div></div><div style={{ textAlign: "right" }}><div style={{ fontSize: 12, fontWeight: 850, color }}>{alert ? "THERMAL ALERT" : thermalState === "cooling" ? "COOLING" : adult ? "ADULT AT DEN" : "DEN NORMAL"}</div><div style={{ fontSize: 11, color: "#7A847B", marginTop: 2 }}>{visits} visits tonight · {joeys} joeys</div></div></div><div style={{ display: "grid", gridTemplateColumns: "1.1fr .9fr", gap: 9 }}><div style={{ border: "1px solid #30382F", borderRadius: 11, background: "#0D120D", padding: 7 }}><svg width="100%" height="185" viewBox="0 0 300 180"><rect x="34" y="20" width="18" height="153" rx="6" fill="#392C1E"/><path d="M46 70 Q95 46 128 74" stroke="#59452D" strokeWidth="9" fill="none"/><rect x="118" y="35" width="116" height="116" rx="7" fill="#59462C" stroke="#9A8055"/><path d="M108 39 L176 10 L244 39" fill="#40321F" stroke="#9A8055"/><circle cx="188" cy="69" r="20" fill="#17150E" stroke="#A48A5D"/>{adult && <Glider x={189} y={69}/>}<Glider x={152} y={122} small/><Glider x={185} y={125} small/><Fan x={137} y={58} measuredRpm={measured}/><text x="176" y="168" textAnchor="middle" fill="#92856B" fontSize="10">DEN BOX SG-01 · {adults} adults · {joeys} joeys</text></svg></div><div style={{ display: "grid", gap: 7 }}>{[["TEMPERATURE", temperature(temp), color], ["HUMIDITY", percent(humidity), "#8FC4D6"], ["COLONY", adults + " adults · " + joeys + " joeys", "#CBB47A"]].map((m: any) => <div key={m[0]} style={{ border: "1px solid #30382F", borderRadius: 9, padding: 9, background: "#0D120D" }}><div style={{ fontSize: 11, color: "#8B958B" }}>{m[0]}</div><div style={{ fontSize: 17, fontFamily: "monospace", fontWeight: 850, color: m[2], marginTop: 3 }}>{m[1]}</div></div>)}</div></div>
    {/* Commanded and measured fan speed sit side by side because the gap between
        them is the evidence: an accepted command is not moving air. */}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 7, marginTop: 8 }}>{[
      ["SOLAR", watts(model.solarW), "#E4C768"],
      ["BATTERY", percent(model.batteryPct), "#8FD6A4"],
      ["FAN COMMAND", rpm(model.fanCommandRpm), "#9BB2E6"],
      ["TACHOMETER", rpm(model.fanMeasuredRpm), verified ? "#83D69B" : "#C2C7BE"],
    ].map((cell: any) => <div key={cell[0]} style={{ border: "1px solid #30382F", borderRadius: 9, padding: 8, background: "#0D120D" }}>
      <div style={{ fontSize: 11, color: "#8B958B" }}>{cell[0]}</div>
      <div style={{ fontSize: 13, fontFamily: "monospace", fontWeight: 800, color: cell[2], marginTop: 3 }}>{cell[1]}</div>
    </div>)}</div>
    <div style={{ marginTop: 9, border: "1px solid #373D35", borderRadius: 10, padding: 9, background: "#0D100D" }}><div style={{ fontSize: 11, color: "#A0A89F", letterSpacing: ".1em", marginBottom: 7 }}>OPERATOR CONTROLS</div><div style={{ display: "flex", gap: 6 }}><button {...autoVisual} style={{ ...autoVisual.style, flex: 1, padding: "9px" }} onClick={() => actions.toggleAutoCooling()}>{pending ? "Verifying cooling command…" : auto ? "Automatic cooling armed" : "Automatic cooling off"}</button><button {...stopVisual} style={{ ...stopVisual.style, flex: 1, padding: "9px" }} onClick={() => actions.stopCooling()}>Stop den fan</button></div><div style={{ fontSize: 11, color: "#767D75", marginTop: 7 }}>{outcome}</div></div>
    <div style={{ marginTop: 16, border: "1px dashed #5E5333", borderRadius: 10, padding: 9, background: "#151208" }}><div style={{ fontSize: 11, color: "#D3B76F", letterSpacing: ".1em" }}>DEMO SCENARIO</div><div style={{ fontSize: 11, color: "#9B8B65", margin: "4px 0 7px" }}>Inject physical den-box conditions. Monitoring logic only reacts to resulting sensor telemetry.</div><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><button disabled={adult} onClick={() => actions.simulateVisit()} style={{ flex: 1, minWidth: 120, padding: "9px", borderRadius: 7, border: "1px solid #4E6245", background: "#111C10", color: "#9DCEA0", fontSize: 12, cursor: "pointer" }}>Glider returns to den</button><button disabled={alert} onClick={() => actions.simulateHeat()} style={{ flex: 1, minWidth: 120, padding: "9px", borderRadius: 7, border: "1px solid #6A4B33", background: "#21150C", color: "#E3AC72", fontSize: 12, cursor: "pointer" }}>Hot afternoon</button><button onClick={() => actions.resetNest()} style={{ padding: "9px 12px", borderRadius: 7, border: "1px solid #49483D", background: "#161712", color: "#A2A69B", fontSize: 12, cursor: "pointer" }}>Reset</button></div></div><div style={{ fontSize: 11, color: "#778078", marginTop: 7 }}>{last?.label ? String(last.label) : "Den box telemetry online"}</div></div>;
}
