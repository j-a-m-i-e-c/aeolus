// vessel-rov — visual implementation behind ui/index.tsx
import { useEffect, useState } from "react";
import { control, decimal, integer, metres, percent } from "@aeolus/ui";
function clamp(v: number, a: number, b: number) { return Math.min(b, Math.max(a, v)); }
/** The vehicle's mission phase in the words a pilot would use. */
const PHASE_LABEL: Record<string, string> = {
    "at-surface": "AT SURFACE",
    diving: "DESCENDING",
    "approaching-seabed": "APPROACHING SEABED",
    "on-station": "ON STATION",
    surveying: "SURVEYING",
    holding: "HOLDING POSITION",
    recovering: "RECOVERING",
};
export default function RovOperationsDashboard({ model, actions }: {
    model: Record<string, any>;
    actions: Record<string, (...args: any[]) => void>;
}) {
    const seabed = Math.max(50, Number(model.seabedDepth ?? 385));
    const depth = clamp(Number(model.depth ?? 60), 0, seabed);
    const heading = Number(model.heading ?? 88), battery = Number(model.battery ?? 78), tether = Number(model.tetherTension ?? 287);
    const current = Number(model.crossCurrentKt ?? .2), legs = Number(model.transectLegs ?? 0);
    const mode = String(model.mode || "at-surface"), lights = model.lightsOn !== false;
    const pending = Boolean(model.commandPending) || Boolean(model.tetherProtectionActive);
    const protectedAt = Number(model.protectionAt ?? 0);
    const last = model.lastAction as any;
    const [phase, setPhase] = useState(0);
    useEffect(() => { const id = setInterval(() => setPhase(v => (v + 1) % 100000), 90); return () => clearInterval(id); }, []);
    const action = last?.label ? String(last.label) : "ROV at launch depth · ready to dive";
    const high = tether >= 650;
    const atSurface = mode === "at-surface", diving = mode === "diving" || mode === "approaching-seabed";
    const onStation = mode === "on-station", surveying = mode === "surveying", recovering = mode === "recovering", holding = mode === "holding";
    const moving = diving || recovering;
    // The vehicle is placed by its DEPTH against the whole water column. Positioning
    // it from altitude — as this pane used to — pinned it a few pixels off the bottom
    // however shallow it actually was.
    const surfaceY = 20, seabedY = 168;
    const yOf = (d: number) => surfaceY + clamp(d, 0, seabed) / seabed * (seabedY - surfaceY);
    const rovY = yOf(depth), rovX = 172;
    // The tether bows downstream in proportion to the current pulling on it, so the
    // cause of a rising load is visible rather than only its number.
    const bend = clamp(current, 0, 2) * 30;
    const tetherPath = "M24 12 Q" + Math.round((24 + rovX) / 2 + bend) + " " + Math.round((12 + rovY) / 2 - 8) + " " + rovX + " " + Math.round(rovY);
    const arrowLen = 10 + clamp(current, 0, 2) * 26;
    // Diving is the state the vehicle is already in on station; a transect needs it
    // off the surface first; Hold only exists while something is actually moving.
    const diveVisual = control({ pending: pending && !moving, current: diving, disabled: onStation || surveying });
    const surveyVisual = control({ pending: pending && !surveying, current: surveying, disabled: moving || atSurface });
    const holdVisual = control({ pending, disabled: !moving && !surveying });
    const recoverVisual = control({ pending: pending && !moving, current: recovering, disabled: atSurface });
    const diveLabel = diving ? "Descending to 355 m" : onStation ? "On station at 355 m" : "Dive to 355 m";
    const surveyLabel = surveying ? "Surveying transect" : legs > 0 ? "Fly another transect" : "Start transect";
    return <div style={{ padding: 11, minHeight: "100%", background: "linear-gradient(180deg,#061219,#041018)", color: "#EDF3F5" }}>
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 7 }}><div><div style={{ fontSize: 12, fontWeight: 900 }}>ROV OPERATIONS</div><div style={{ color: "#607B87", fontSize: 11, marginTop: 2 }}>Vehicle command · tether protection · seabed survey</div></div><div style={{ textAlign: "right" }}><div style={{ color: high ? "#F08E6B" : surveying ? "#73DBA1" : "#63D1E8", fontSize: 11, fontWeight: 850 }}>{high ? "TETHER PROTECTION" : (PHASE_LABEL[mode] || mode.toUpperCase())}</div><div style={{ color: "#5E737C", fontSize: 11 }}>{metres(depth)} · {metres(model.altitude, 1)} off bottom</div></div></div>
    <div style={{ display: "grid", gridTemplateColumns: "1.25fr .85fr", gap: 7 }}><div style={{ border: "1px solid #1B3A49", borderRadius: 10, overflow: "hidden", background: "#04131D" }}><svg width="100%" height="190" viewBox="0 0 330 190"><defs><linearGradient id="rovWater" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0A3046"/><stop offset="1" stopColor="#031019"/></linearGradient></defs><rect width="330" height="190" fill="url(#rovWater)"/>
      {/* One water column, ruled in real metres, with the seabed at its real depth. */}
      {[0, .25, .5, .75, 1].map(f => <g key={f}><line x1="0" y1={yOf(seabed * f)} x2="330" y2={yOf(seabed * f)} stroke="#2C566D" opacity=".16"/><text x="4" y={yOf(seabed * f) - 2} fill="#5C7E90" fontSize="9">{Math.round(seabed * f)}m</text></g>)}
      <path d={"M0 " + seabedY + " Q38 " + (seabedY - 11) + " 75 " + (seabedY - 1) + " T150 " + (seabedY - 3) + " T225 " + (seabedY + 2) + " T330 " + (seabedY - 7) + " L330 190 L0 190 Z"} fill="#1D2925" stroke="#59634E"/>
      <text x="258" y={seabedY + 18} fill="#6E7A66" fontSize="9">SEABED {Math.round(seabed)}m</text>
      <g transform="translate(14 8)"><rect width="30" height="7" rx="2" fill="#C9D4D8" stroke="#7F9299"/></g>
      <path d={tetherPath} fill="none" stroke={high ? "#E27D5D" : "#627B86"} strokeWidth={high ? 2 : 1.2} strokeDasharray="4 3"/>
      {/* Cross-current: the physical cause, drawn at the length it is measured at. */}
      <g opacity=".65">{[0, 1, 2].map(i => <g key={i} stroke={high ? "#F0A87F" : "#4E93A8"} fill="none"><line x1="238" y1={rovY - 16 + i * 16} x2={238 + arrowLen} y2={rovY - 16 + i * 16}/><path d={"M" + (238 + arrowLen) + " " + (rovY - 20 + i * 16) + " l4 4 l-4 4"}/></g>)}</g>
      <text x="238" y={rovY + 30} fill={high ? "#F0A87F" : "#5F8B9C"} fontSize="9">{decimal(current, 1)} kt</text>
      <g transform={"translate(" + rovX + " " + Math.round(rovY) + ") rotate(" + (heading - 90) + ")"}><rect x="-20" y="-9" width="40" height="18" rx="5" fill="#102F3D" stroke={high ? "#E27D5D" : "#58D2ED"}/><circle cx="-11" cy="0" r="3.5" fill={lights ? "#B9F4FF" : "#4C626A"}/><path d="M20 -4 L30 -9 M20 4 L30 9" stroke="#58D2ED"/><circle cx="4" cy="0" r="2" fill="#77DDA0"/></g>
      {surveying && Array.from({ length: 5 }).map((_, i) => <circle key={i} cx={196 + ((phase + i * 22) % 84)} cy={rovY + 15 + Math.sin((phase + i * 9) * .13) * 4} r="1.5" fill="#6ED6E9" opacity=".55"/>)}
      {/* Altitude is the gap the picture already shows, annotated — not the input the picture was built from. */}
      <line x1="128" y1={rovY} x2="128" y2={seabedY} stroke="#6FA0A8" strokeDasharray="2 3"/><text x="80" y={(rovY + seabedY) / 2} fill="#6D929C" fontSize="9">{metres(model.altitude, 1)} AGL</text>
      <text x="252" y="14" fill="#5F7F8C" fontSize="9">VIS {metres(model.visibility, 1)}</text><text x="252" y="26" fill="#5F7F8C" fontSize="9">HDG {integer(heading)}°</text></svg></div>
      <div style={{ border: "1px solid #1B3A49", borderRadius: 10, background: "#07141B", padding: 9 }}><div style={{ color: "#687F89", fontSize: 11, letterSpacing: ".12em" }}>VEHICLE HEALTH</div><div style={{ marginTop: 9, color: "#697E87", fontSize: 11 }}>BATTERY</div><div style={{ fontSize: 19, fontWeight: 850, color: battery < 30 ? "#E98B68" : "#8CDBA0" }}>{percent(battery)}</div><div style={{ height: 5, background: "#17272E", borderRadius: 4, overflow: "hidden" }}><div style={{ height: "100%", width: clamp(battery, 0, 100) + "%", background: battery < 30 ? "#D46D4E" : "#55AD70" }}/></div>
      <div style={{ marginTop: 11, color: "#697E87", fontSize: 11 }}>TETHER LOAD</div><div style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 800, color: high ? "#F08A68" : "#C8D4D8", marginTop: 2 }}>{integer(tether)} N</div><div style={{ height: 5, background: "#17272E", borderRadius: 4, overflow: "hidden", marginTop: 3 }}><div style={{ height: "100%", width: Math.min(100, tether / 8) + "%", background: high ? "#D56646" : "#4DABC0" }}/></div>
      {/* An automatic action the operator cannot account for is worse than none. */}
      {protectedAt > 0 && <div style={{ color: "#E9A97E", fontSize: 11, marginTop: 4 }}>Aeolus held station automatically</div>}
      <div style={{ marginTop: 11, color: "#697E87", fontSize: 11 }}>CROSS-CURRENT</div><div style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 800, color: current > 1 ? "#F0B98A" : "#BFCED2", marginTop: 2 }}>{decimal(current, 1)} kt</div>
      <div style={{ marginTop: 9, color: "#697E87", fontSize: 11 }}>THRUSTER {percent(model.thrusterPct)} · {integer(legs)} legs</div></div></div>
    <div style={{ marginTop: 7, border: "1px solid #263F4A", borderRadius: 9, padding: 8, background: "#07151D" }}><div style={{ color: "#80949D", fontSize: 11, letterSpacing: ".12em", marginBottom: 6 }}>OPERATOR CONTROLS</div><div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}><button {...diveVisual} style={{ ...diveVisual.style, flex: 1, minWidth: 75 }} onClick={() => actions.rovDive()}>{diveLabel}</button><button {...surveyVisual} style={{ ...surveyVisual.style, flex: 1, minWidth: 75 }} onClick={() => actions.rovSurvey()}>{surveyLabel}</button><button {...holdVisual} style={{ ...holdVisual.style, padding: "7px 9px" }} onClick={() => actions.rovHold()}>Hold position</button><button {...recoverVisual} style={{ ...recoverVisual.style, padding: "7px 9px" }} onClick={() => actions.rovRecover()}>{recovering ? "Recovering to surface…" : "Recover to surface"}</button></div></div>
    <div style={{ marginTop: 16, border: "1px dashed #69502E", borderRadius: 9, padding: 8, background: "#171309" }}><div style={{ color: "#D8B66D", fontSize: 11, letterSpacing: ".12em" }}>DEMO SCENARIO</div><div style={{ color: "#806F50", fontSize: 11, margin: "3px 0 6px" }}>Inject a deep cross-current. High tether load should make Aeolus command a safe hold.</div><div style={{ display: "flex", gap: 5 }}><button onClick={() => actions.simulateRovCurrent()} style={{ flex: 1, padding: "6px", borderRadius: 6, border: "1px solid #6A5130", background: "#21180B", color: "#E3B866", fontSize: 11, cursor: "pointer" }}>Inject cross-current</button><button onClick={() => actions.resetRov()} style={{ padding: "6px 9px", borderRadius: 6, border: "1px solid #454138", background: "#171713", color: "#898B82", fontSize: 11, cursor: "pointer" }}>Reset mission</button></div></div>
    <div style={{ color: "#5A6F78", fontSize: 11, marginTop: 6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{action}</div>
  </div>;
}
