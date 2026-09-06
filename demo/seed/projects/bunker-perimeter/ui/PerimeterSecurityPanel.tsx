// bunker-perimeter — visual implementation behind ui/index.tsx
import { useEffect, useState } from "react";
import { control, integer, metres, percent, toggleProps } from "@aeolus/ui";
function Z({ x, y, p, lit, scale = 1 }: {
    x: number;
    y: number;
    p: number;
    lit: boolean;
    scale?: number;
}) { const s = Math.sin(p) * 2, c = lit ? "#B6C49C" : "#66735C"; return <g transform={"translate(" + x + " " + y + ") scale(" + scale + ")"} stroke={c} fill={c} opacity={lit ? 1 : .7}><circle cy="-18" r="5"/><path d={"M0 -13 Q" + (5 + s) + " -4 " + s + " 8"} fill="none" strokeWidth="6"/><line x1={s} y1="-6" x2={-12 + s} y2="1" strokeWidth="4"/><line x1={s} y1="8" x2={-6 + s} y2="23" strokeWidth="4"/><line x1={s} y1="8" x2={7 + s} y2="23" strokeWidth="4"/></g>; }
export default function PerimeterSecurityPanel({ model, actions }: {
    model: Record<string, any>;
    actions: Record<string, (...args: any[]) => void>;
}) {
    const contacts = Number(model.contacts ?? 0), sector = String(model.sector || "east"), lights = Boolean(model.lightsOn), auto = model.autoLights !== false, pending = Boolean(model.pending), available = model.lightsAvailable !== false, last = model.lastAction as any;
    const range = Number(model.rangeM ?? 140), movement = String(model.movement || "clear"), ambient = Number(model.ambientContacts ?? 2);
    const track = Math.max(40, Number(model.trackRangeM ?? 140)), detect = Number(model.detectRangeM ?? 60), fence = Number(model.fenceRangeM ?? 18);
    // Brightness, not the switch. What turns contacts back is light on the ground.
    const beamPct = Number(model.floodlightPct ?? (lights ? 100 : 0));
    const [p, setP] = useState(0);
    useEffect(() => { const id = setInterval(() => setP(v => v + .12), 90); return () => clearInterval(id); }, []);
    const threat = contacts > 0, withdrawing = movement === "withdrawing";
    // Closing is not the same situation as standing at the fence, and neither is the
    // same as leaving, so the pane says which one it is.
    const MOVEMENT_LABEL: Record<string, string> = {
        clear: "APPROACH CLEAR",
        approaching: "CLOSING",
        "at-fence": "AT THE FENCE",
        withdrawing: "WITHDRAWING",
    };
    // Contacts are placed by their measured range, so the picture cannot show an
    // empty approach while the classifier is reporting three of them at the fence.
    const xFor = (r: number, side: number) => 215 + side * (100 + (Math.max(fence, Math.min(track, r)) - fence) / (track - fence) * 105);
    const beam = .02 + (beamPct / 100) * .2;
    // The floodlight control reflects the state Aeolus last OBSERVED, so it is a
    // toggle over observed truth; AUTO is the policy the manual override left.
    const lightVisual = toggleProps(lights, { pending, disabled: !available });
    const autoVisual = control({ pending, current: auto });
    const headline = threat ? integer(contacts) + (contacts === 1 ? " CONTACT" : " CONTACTS") : withdrawing ? "WITHDRAWING" : "CLEAR";
    const movementLabel = MOVEMENT_LABEL[movement] || movement.toUpperCase();
    return <div style={{ padding: 13, minHeight: "100%", background: "#0B0D09", color: "#EEF0E9" }}><div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}><div><div style={{ fontSize: 17, fontWeight: 900 }}>PERIMETER SECURITY</div><div style={{ fontSize: 12, color: "#858D82", marginTop: 3 }}>Local classification → policy → verified floodlighting</div></div><div style={{ textAlign: "right" }}><div style={{ fontSize: 12, fontWeight: 850, color: threat ? "#ED8B72" : withdrawing ? "#D9C46A" : "#7FD19A" }}>{headline}</div><div style={{ fontSize: 11, color: auto ? "#83C99A" : "#D9B06A", marginTop: 2 }}>LIGHTING {auto ? "AUTO" : "MANUAL"}</div></div></div>
    <div style={{ border: "1px solid #34382F", borderRadius: 11, background: "#10120D", marginTop: 9, overflow: "hidden" }}><svg width="100%" height="185" viewBox="0 0 430 170"><rect width="430" height="170" fill="#11150F"/>
      {/* Treeline, alert ring and fence, drawn at the ranges the classifier reports. */}
      <path d="M0 116 H430" stroke="#485044" strokeDasharray="4 4"/>
      {[-1, 1].map(side => <g key={side}>
        <line x1={xFor(track, side)} y1="60" x2={xFor(track, side)} y2="140" stroke="#2E3A2C" strokeWidth="8"/>
        <line x1={xFor(detect, side)} y1="70" x2={xFor(detect, side)} y2="140" stroke={threat ? "#8A6048" : "#3B4738"} strokeDasharray="2 5"/>
        <line x1={xFor(fence, side)} y1="82" x2={xFor(fence, side)} y2="140" stroke="#5B6455" strokeDasharray="5 4"/>
      </g>)}
      <text x="8" y="56" fill="#5E6A5B" fontSize="9">TREELINE {metres(track)}</text><text x="422" y="56" textAnchor="end" fill={threat ? "#9A705A" : "#5E6A5B"} fontSize="9">ALERT RING {metres(detect)}</text>
      <rect x="160" y="77" width="110" height="58" fill="#171B14" stroke="#6A7061"/><path d="M155 78 L215 46 L275 78" fill="#181D14" stroke="#6A7061"/>
      <circle cx="135" cy="82" r="6" fill={beamPct > 5 ? "#E6D682" : "#4C4D42"}/><path d="M135 82 L38 132 L170 132Z" fill="#F0D879" opacity={beam}/>
      <circle cx="295" cy="82" r="6" fill={beamPct > 5 ? "#E6D682" : "#4C4D42"}/><path d="M295 82 L260 132 L402 132Z" fill="#F0D879" opacity={beam}/>
      {/* Always something out past the treeline. It is tracked, just not raised. */}
      {Array.from({ length: Math.min(ambient, 4) }).map((_, i) => <Z key={"a" + i} x={xFor(track, i % 2 === 0 ? -1 : 1) + (i < 2 ? 0 : 14 * (i % 2 === 0 ? 1 : -1))} y={126} p={p * .4 + i * 2} lit={false} scale={.7}/>)}
      {Array.from({ length: Math.min(contacts, 4) }).map((_, i) => <Z key={i} x={xFor(range, i % 2 === 0 ? -1 : 1) + Math.floor(i / 2) * 17 * (i % 2 === 0 ? 1 : -1)} y={132} p={p + i} lit={beamPct > 40}/>)}
      <text x="215" y="158" textAnchor="middle" fill="#899184" fontSize="10">{sector.toUpperCase()} SECTOR · FLOODLIGHTS {percent(beamPct)} · {auto ? "AUTO" : "MANUAL OVERRIDE"}</text></svg></div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6, marginTop: 8 }}>{[
      ["NEAREST CONTACT", threat || withdrawing ? metres(range) : "beyond " + metres(detect), threat ? "#ED8B72" : "#C4CBBF"],
      ["MOVEMENT", movementLabel, withdrawing ? "#83D69B" : movement === "approaching" ? "#EDA277" : threat ? "#E9C07E" : "#9AA394"],
      ["FLOODLIGHTS", percent(beamPct), beamPct > 40 ? "#E6D682" : "#9AA394"],
    ].map((cell: any) => <div key={cell[0]} style={{ border: "1px solid #34382F", borderRadius: 9, padding: 8, background: "#10120D" }}>
      <div style={{ fontSize: 11, color: "#868E83" }}>{cell[0]}</div>
      <div style={{ fontSize: 13, fontFamily: "monospace", fontWeight: 800, color: cell[2], marginTop: 3 }}>{cell[1]}</div>
    </div>)}</div>
    <div style={{ marginTop: 8, border: "1px solid #373A33", borderRadius: 10, padding: 9, background: "#0F110E" }}><div style={{ fontSize: 11, color: "#9BA097", letterSpacing: ".1em", marginBottom: 7 }}>OPERATOR CONTROLS</div><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}><button {...lightVisual} style={{ ...lightVisual.style, padding: "9px" }} onClick={() => actions.toggleLights()}>{!available ? "Floodlight controller offline" : pending ? "Verifying floodlight command…" : lights ? "Turn floodlights off" : "Turn floodlights on"}</button><button {...autoVisual} style={{ ...autoVisual.style, padding: "9px" }} onClick={() => actions.returnAuto()}>{auto ? "AUTO policy active" : "Return to automatic control"}</button></div><div style={{ fontSize: 11, color: "#7D847A", marginTop: 7 }}>The button reflects the floodlights Aeolus last OBSERVED, not what it asked for. A verified manual command enters MANUAL override; Return to AUTO hands the lights back to contact policy.</div></div>
    <div style={{ marginTop: 16, border: "1px dashed #685237", borderRadius: 10, padding: 9, background: "#171309" }}><div style={{ fontSize: 11, color: "#D6B773", letterSpacing: ".1em" }}>DEMO SCENARIO</div><div style={{ fontSize: 11, color: "#9C8964", margin: "4px 0 7px" }}>Inject something regrettably bipedal crossing the treeline. It walks in, and lit floodlights turn it back.</div><div style={{ display: "flex", gap: 6 }}><button disabled={threat} onClick={() => actions.simulateContacts()} style={{ flex: 1, padding: "9px", borderRadius: 7, border: "1px solid #6D4936", background: "#21130D", color: "#E7A47E", fontSize: 12 }}>Shambling contacts</button><button onClick={() => actions.clearPerimeter()} style={{ padding: "9px 12px", borderRadius: 7, border: "1px solid #48483D", background: "#161713", color: "#A3A398", fontSize: 12 }}>Send them away</button></div></div>
    <div style={{ fontSize: 11, color: "#777E74", marginTop: 7 }}>{last?.label ? String(last.label) : "Perimeter classifier online"}</div></div>;
}
