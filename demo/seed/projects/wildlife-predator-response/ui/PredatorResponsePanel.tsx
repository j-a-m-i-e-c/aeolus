// wildlife-predator-response — visual implementation behind ui/index.tsx
import { useEffect, useState } from "react";
import { commandLadder, commandVerdict, control, decimal, metres, percent, rpm, rungProps, toggleProps, verdictProps, watts } from "@aeolus/ui";
export default function PredatorResponsePanel({ model, actions }: {
    model: Record<string, any>;
    actions: Record<string, (...args: any[]) => void>;
}) {
    const armed = model.armed !== false, until = Number(model.activeUntil ?? 0), species = String(model.lastSpecies || "none"), category = String(model.lastCategory || "none"), responses = Number(model.responsesToday ?? 3), pending = Boolean(model.commandPending), verifiedAt = Number(model.lastVerifiedAt ?? 0), verifiedTarget = String(model.lastVerifiedTarget || "none"), outcome = String(model.lastOutcome || "Waiting for classified wildlife event"), last = model.lastAction as any;
    const [now, setNow] = useState(Date.now());
    useEffect(() => { const id = setInterval(() => setNow(Date.now()), 100); return () => clearInterval(id); }, []);
    const active = until > now, remaining = Math.max(0, (until - now) / 1000), color = active ? "#F0A05F" : armed ? "#7BD59A" : "#7B8580", verifiedAge = verifiedAt ? Math.max(0, Math.round((now - verifiedAt) / 1000)) : null;
    // Arming is a policy switch, so it stays pressable; stopping a pulse only
    // exists while one is physically running.
    const armVisual = toggleProps(armed, { pending });
    const stopVisual = control({ pending, disabled: !active });
    // The tachometer is the observation the command waited on, so it is called out
    // once it confirms the fan is genuinely up to speed.
    const tachVerified = Number(model.measuredRpm ?? 0) >= 2000;
    const predatorFleeing = String(model.predatorMovement ?? "") === "fleeing";
    const verdict = commandVerdict(model.lastCommand), rungs = commandLadder(model.lastCommand);
 return <div style={{ padding: 13, minHeight: "100%", background: "linear-gradient(180deg,#0C0D0B,#080907)", color: "#EFF1EA" }}><div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10, gap: 10 }}><div><div style={{ fontSize: 17, fontWeight: 900 }}>PREDATOR RESPONSE</div><div style={{ fontSize: 12, color: "#898F87", marginTop: 3 }}>Classification event → policy → verified humane actuator</div></div><div style={{ textAlign: "right" }}><div style={{ fontSize: 12, fontWeight: 850, color }}>{active ? "DETERRENT ACTIVE" : armed ? "ARMED" : "DISARMED"}</div><div style={{ fontSize: 11, color: "#7D837C", marginTop: 2 }}>{responses} verified responses today</div></div></div>
    <div style={{ border: "1px solid #343830", borderRadius: 12, padding: 9, background: "#0D100C" }}><svg width="100%" height="170" viewBox="0 0 420 160"><rect x="22" y="35" width="58" height="78" rx="8" fill="#151A15" stroke="#69766A"/><circle cx="51" cy="61" r="12" fill="#07100A" stroke={color}/><circle cx="51" cy="61" r="4" fill={active ? "#F0D26A" : "#496050"}/><path d="M80 57 Q142 33 205 55" fill="none" stroke={active ? "#F0A05F" : "#344039"} strokeWidth="2" strokeDasharray={active ? "4 3" : "2 7"}/><path d="M80 75 Q150 55 214 76" fill="none" stroke={active ? "#F0D26A" : "#344039"} strokeWidth="2" strokeDasharray={active ? "4 3" : "2 7"}/><g transform="translate(268 79)" fill={active ? "#C97655" : "#69736B"} stroke={active ? "#C97655" : "#69736B"}><ellipse rx="27" ry="11"/><circle cx="24" cy="-8" r="9"/><path d="M18 -15 L22 -25 L27 -16 M29 -16 L36 -25 L35 -11"/><path d="M-24 -2 Q-51 -18 -60 -2" fill="none" strokeWidth="8"/></g><text x="51" y="135" textAnchor="middle" fill="#919C92" fontSize="10">DETERRENT UNIT</text><text x="268" y="135" textAnchor="middle" fill="#919C92" fontSize="10">{species.toUpperCase()}</text>{active && <text x="150" y="21" textAnchor="middle" fill="#F0B66E" fontSize="11">VERIFIED PULSE · {remaining.toFixed(1)}s</text>}</svg></div>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7, marginTop: 8 }}><div style={{ border: "1px solid #343830", borderRadius: 9, padding: 9, background: "#0D100C" }}><div style={{ fontSize: 11, color: "#858C84" }}>LAST CLASSIFICATION</div><div style={{ fontSize: 13, fontWeight: 800, color: category === "predator" ? "#E8906B" : "#9AB2A0", marginTop: 3 }}>{species}</div><div style={{ fontSize: 11, color: "#747B74", marginTop: 2 }}>{category}</div></div><div style={{ border: "1px solid " + (verifiedAt ? "#365A43" : "#343830"), borderRadius: 9, padding: 9, background: verifiedAt ? "#0C1610" : "#0D100C" }}><div style={{ fontSize: 11, color: "#858C84" }}>LAST PHYSICAL RESPONSE</div><div style={{ fontSize: 13, fontWeight: 800, color: verifiedAt ? "#83D69B" : "#7B817A", marginTop: 3 }}>{verifiedAt ? "VERIFIED · " + verifiedTarget : "NONE YET"}</div><div style={{ fontSize: 11, color: "#747B74", marginTop: 2 }}>{verifiedAge === null ? "waiting for predator event" : verifiedAge + "s ago"}</div></div></div>
    {/* The deterrent station's own physical readings. Commanded and measured speed
        are shown side by side because the gap between them is the evidence. */}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 7, marginTop: 8 }}>{[
      ["SOLAR", watts(model.solarW), "#E4C768"],
      ["BATTERY", percent(model.batteryPct), "#8FD6A4"],
      ["COMMAND", rpm(model.commandRpm), "#9BB2E6"],
      ["TACHOMETER", rpm(model.measuredRpm), tachVerified ? "#83D69B" : "#C2C7BE"],
    ].map((cell: any) => <div key={cell[0]} style={{ border: "1px solid #343830", borderRadius: 9, padding: 8, background: "#0D100C" }}>
      <div style={{ fontSize: 11, color: "#858C84" }}>{cell[0]}</div>
      <div style={{ fontSize: 13, fontFamily: "monospace", fontWeight: 800, color: cell[2], marginTop: 3 }}>{cell[1]}</div>
    </div>)}</div>
    <div style={{ marginTop: 7, border: "1px solid #343830", borderRadius: 9, padding: 9, background: "#0D100C", display: "flex", justifyContent: "space-between", gap: 8 }}>
      <div>
        <div style={{ fontSize: 11, color: "#858C84" }}>PREDATOR RANGE</div>
        <div style={{ fontSize: 13, fontWeight: 800, color: predatorFleeing ? "#83D69B" : "#E8906B", marginTop: 3 }}>
          {metres(model.predatorDistanceM, 1)}{predatorFleeing ? " and opening" : ""}
        </div>
      </div>
      <div style={{ textAlign: "right", fontSize: 11, color: "#747B74" }}>
        {/* Measured from collar-free trail-camera ranging, not from the command. */}
        {String(model.predatorMovement ?? "clear")} · {decimal(model.predatorSpeedMps, 1)} m/s
      </div>
    </div>
    <div style={{ marginTop: 8, border: "1px solid #373B34", borderRadius: 10, padding: 9, background: "#0E100D" }}><div style={{ fontSize: 11, color: "#A0A69E", letterSpacing: ".1em", marginBottom: 7 }}>OPERATOR CONTROLS</div><div style={{ display: "flex", gap: 6 }}><button {...armVisual} style={{ ...armVisual.style, flex: 1, padding: "9px" }} onClick={() => actions.toggleArmed()}>{pending ? "Verifying deterrent command…" : armed ? "Disarm response" : "Arm response"}</button><button {...stopVisual} style={{ ...stopVisual.style, flex: 1, padding: "9px" }} onClick={() => actions.stopDeterrent()}>Stop active pulse</button></div><div style={{ fontSize: 11, color: "#767D75", marginTop: 7 }}>No simulator controls here. Only predator-classified domain events can request this actuator.</div></div><div style={{ fontSize: 11, color: "#7B827A", marginTop: 7 }}>{pending ? "Waiting for command verification…" : last?.label ? String(last.label) : outcome}</div>    {/* What the last command actually proved. Every rung is a durable record the
        runtime wrote, not a step this pane inferred from the outcome. */}
    {verdict && <div style={{ marginTop: 8, border: "1px solid #343830", borderRadius: 9, padding: 9, background: "#0D100C" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 5 }}><div style={{ fontSize: 11, color: "#858C84", letterSpacing: ".1em" }}>COMMAND EVIDENCE</div><div style={verdictProps(verdict)}>{verdict.headline}</div></div>
      {rungs.map((rung: any) => { const rv = rungProps(rung); return <div key={rung.state} style={rv.style}><span>{rv.mark}</span><span>{rung.label}</span>{rung.detail && <span style={{ color: "#747B74" }}>{rung.detail}</span>}</div>; })}
      <div style={{ fontSize: 11, color: "#747B74", marginTop: 5 }}>{verdict.clampNote || verdict.detail}</div>
    </div>}
    </div>;
}
