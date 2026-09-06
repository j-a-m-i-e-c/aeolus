// bunker-overview — visual implementation behind ui/index.tsx
import { useEffect, useState } from "react";
import { decimal, integer, percent, temperature, watts } from "@aeolus/ui";
function Zombie({ x, y, p, lit, scale = 1 }: {
    x: number;
    y: number;
    p: number;
    lit: boolean;
    scale?: number;
}) { const sway = Math.sin(p) * 2, c = lit ? "#B4C39A" : "#495249"; return <g transform={"translate(" + x + " " + y + ") scale(" + scale + ")"} stroke={c} fill={c} opacity={lit ? .98 : .58}><circle cy="-19" r="5.5"/><path d={"M0 -13 Q" + (6 + sway) + " -4 " + sway + " 9"} fill="none" strokeWidth="6"/><line x1={sway} y1="-4" x2={-13 + sway} y2="2" strokeWidth="4"/><line x1={sway} y1="9" x2={-7 + sway} y2="25" strokeWidth="4"/><line x1={sway} y1="9" x2={8 + sway} y2="25" strokeWidth="4"/></g>; }
/** One labelled area of the shelter. */
function Area({ x, y, w, h, title, children }: {
    x: number;
    y: number;
    w: number;
    h: number;
    title: string;
    children: any;
}) { return <g><rect x={x} y={y} width={w} height={h} rx="5" fill="#10150F" stroke="#4B554A"/><text x={x + 11} y={y + 17} fill="#93A394" fontSize="10" fontWeight="800" letterSpacing=".7">{title}</text>{children}</g>; }
export default function BunkerOverviewDashboard({ model }: {
    model: Record<string, any>;
}) {
    const contacts = Number(model.contacts ?? 0), sealed = Boolean(model.sealed), pressure = Number(model.overpressure ?? 8);
    const battery = Number(model.battery ?? 74), gen = Boolean(model.generatorOn), signal = String(model.signal || "quiet");
    const occupants = Number(model.occupants ?? 4), bunks = Number(model.bunks ?? 6);
    const movement = String(model.movement || "clear"), ambient = Number(model.ambientContacts ?? 2);
    const range = Number(model.rangeM ?? 140);
    const track = Math.max(40, Number(model.trackRangeM ?? 140)), detect = Number(model.detectRangeM ?? 60), fence = Number(model.fenceRangeM ?? 18);
    // Brightness rather than the switch: what lights the ground is the light.
    const beamPct = Number(model.floodlightPct ?? (Boolean(model.lightsOn) ? 100 : 0));
    const transmitting = Boolean(model.transmitting), linked = signal !== "quiet";
    const [p, setP] = useState(0);
    useEffect(() => { const id = setInterval(() => setP(v => v + .1), 90); return () => clearInterval(id); }, []);
    // Contacts sit where the classifier says they are. Nothing on this scene is
    // positioned by how long ago something happened.
    const xFor = (r: number, side: number) => 380 + side * (120 + (Math.max(fence, Math.min(track, r)) - fence) / (track - fence) * 240);
    const beam = .02 + (beamPct / 100) * .26;
    const withdrawing = movement === "withdrawing";
    const headline = contacts > 0
        ? integer(contacts) + " PERIMETER CONTACT" + (contacts === 1 ? "" : "S")
        : withdrawing ? "CONTACTS WITHDRAWING" : "PERIMETER CLEAR";
    return <div style={{ padding: 14, minHeight: "100%", background: "linear-gradient(180deg,#090C09,#060806)", color: "#EDF0EA" }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 10 }}>
      <div><div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}><span style={{ fontSize: 18, fontWeight: 900 }}>OFF-GRID BUNKER</span><span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 99, border: "1px solid #405044", color: "#9BB9A0" }}>READ-ONLY OVERVIEW</span></div><div style={{ fontSize: 12, color: "#879087", marginTop: 4 }}>A working surface property and the six shelter areas underneath it. The zombies remain an implementation detail.</div></div>
      <div style={{ textAlign: "right" }}><div style={{ fontSize: 13, fontWeight: 850, color: contacts ? "#F09478" : withdrawing ? "#DCC673" : "#83D99E" }}>{headline}</div><div style={{ fontSize: 11, color: "#7D887E", marginTop: 3 }}>{sealed ? "sealed · " + integer(pressure) + " Pa" : "normal ventilation"} · battery {percent(battery)}</div></div>
    </div>
    <div style={{ border: "1px solid #30372F", borderRadius: 14, overflow: "hidden", background: "#0C100B" }}><svg width="100%" height="430" viewBox="0 0 760 410" preserveAspectRatio="xMidYMid meet"><defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#101710"/><stop offset="1" stopColor="#182118"/></linearGradient>
      <linearGradient id="beam" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#E8D97A" stopOpacity=".34"/><stop offset="1" stopColor="#E8D97A" stopOpacity="0"/></linearGradient></defs>
      <rect width="760" height="130" fill="url(#sky)"/><rect y="130" width="760" height="280" fill="#171712"/><path d="M0 130 Q170 116 330 128 T760 126" fill="#202C1D" stroke="#435044" strokeWidth="2"/>
      {/* treeline the classifier tracks out to */}
      {[-1, 1].map(side => <g key={side} opacity=".5">{[0, 1, 2].map(i => <path key={i} d={"M" + (xFor(track, side) + (i - 1) * 15) + " 122 l-7 -18 l7 -6 l7 6 z"} fill="#26331F" stroke="#3B4B33"/>)}</g>)}
      {/* surface cabin */}<g><rect x="303" y="63" width="154" height="72" rx="3" fill="#1C241B" stroke="#7B8678" strokeWidth="2"/><path d="M286 65 L380 25 L474 65 Z" fill="#252E23" stroke="#7B8678" strokeWidth="2"/><rect x="325" y="88" width="32" height="47" fill="#0E130E" stroke="#697367"/><rect x="398" y="82" width="37" height="28" fill={beamPct > 40 ? "#20301F" : "#102019"} stroke="#54705C"/><line x1="416.5" y1="82" x2="416.5" y2="110" stroke="#54705C"/><line x1="398" y1="96" x2="435" y2="96" stroke="#54705C"/><text x="380" y="57" textAnchor="middle" fill="#B8C2B4" fontSize="12" fontWeight="800">SURFACE CABIN</text></g>
      {/* solar array */}<g transform="translate(500 65)">{[0, 1, 2].map(i => <g key={i} transform={"translate(" + (i * 52) + " 0)"}><path d="M0 28 L42 18 L48 48 L6 56 Z" fill="#132A28" stroke="#527473"/><line x1="4" y1="34" x2="45" y2="25" stroke="#355654"/><line x1="8" y1="45" x2="47" y2="36" stroke="#355654"/></g>)}<text x="73" y="73" textAnchor="middle" fill="#819A8C" fontSize="11">SOLAR {watts(model.solar)}</text></g>
      {/* fence at its real range, alert ring marked */}<path d={"M" + xFor(fence, -1) + " 121 H" + (xFor(fence, -1) + 150) + " M" + (xFor(fence, 1) - 150) + " 121 H" + xFor(fence, 1)} stroke="#596657" strokeWidth="2" strokeDasharray="6 5"/>
      {[-1, 1].map(side => <line key={side} x1={xFor(detect, side)} y1="100" x2={xFor(detect, side)} y2="128" stroke={contacts ? "#8A6048" : "#38442F"} strokeDasharray="2 5"/>)}
      {/* floodlights sweep the approach when they are actually bright */}
      {[78, 682].map((lx, i) => <g key={lx}><line x1={lx} y1="120" x2={lx} y2="68" stroke="#6F796D" strokeWidth="3"/><rect x={lx - 7} y="64" width="14" height="8" rx="2" fill={beamPct > 5 ? "#E6D579" : "#54584D"}/><path d={i === 0 ? "M78 70 L198 100 L78 118 Z" : "M682 70 L562 100 L682 118 Z"} fill="url(#beam)" opacity={beam * 4}/></g>)}
      {/* nothing is deleted from the scene: distant wanderers are tracked, contacts are ranged */}
      {Array.from({ length: Math.min(ambient, 4) }).map((_, i) => <Zombie key={"a" + i} x={xFor(track, i % 2 === 0 ? -1 : 1) + (i < 2 ? 0 : 18 * (i % 2 === 0 ? 1 : -1))} y={116} p={p * .35 + i * 2} lit={false} scale={.72}/>)}
      {Array.from({ length: Math.min(contacts, 4) }).map((_, i) => <Zombie key={i} x={xFor(range, i % 2 === 0 ? -1 : 1) + Math.floor(i / 2) * 22 * (i % 2 === 0 ? 1 : -1)} y={121} p={p + i} lit={beamPct > 40}/>)}
      <text x="14" y="112" fill="#758076" fontSize="10">ALERT RING {integer(detect)} m · NEAREST {contacts || withdrawing ? integer(range) + " m" : "beyond ring"}</text>
      {/* access shaft */}<g><rect x="359" y="132" width="42" height="52" fill="#0D110C" stroke="#667064"/>{[142, 154, 166, 178].map(y => <line key={y} x1="370" y1={y} x2="390" y2={y} stroke="#5A6558"/>)}<line x1="370" y1="138" x2="370" y2="182" stroke="#5A6558"/><line x1="390" y1="138" x2="390" y2="182" stroke="#5A6558"/></g>
      {/* six shelter areas */}
      <rect x="104" y="186" width="552" height="200" rx="9" fill="#0B0E0A" stroke="#74786B" strokeWidth="3"/>
      <Area x={117} y={198} w={166} h={84} title="AIRLOCK">
        <rect x="132" y="226" width="34" height="46" rx="2" fill="#0E140E" stroke={sealed ? "#72D293" : "#7C8A7E"} strokeWidth="2"/><circle cx="160" cy="249" r="2.5" fill={sealed ? "#72D293" : "#7C8A7E"}/>
        <path d={sealed ? "M172 249 H196" : "M196 243 h-24 m0 12 h24"} stroke={sealed ? "#72D293" : "#6E7C70"} strokeWidth="2"/>
        <text x="205" y="240" fill="#CED5CA" fontSize="11" fontWeight="800">{sealed ? "SEALED" : "OPEN CYCLE"}</text><text x="205" y="257" fill="#7E8A7F" fontSize="10">{integer(pressure)} Pa overpressure</text>
        <text x="205" y="273" fill="#7E8A7F" fontSize="10">outer door interlocked</text>
      </Area>
      <Area x={297} y={198} w={166} h={84} title="HABITAT">
        {/* bunks, and one of them occupied per head we actually count */}
        {[0, 1, 2].map(i => <g key={i}>{[0, 1].map(row => { const idx = i * 2 + row; return <g key={row}><rect x={314 + i * 46} y={228 + row * 22} width="38" height="16" rx="2" fill={idx < occupants ? "#1D2A1E" : "#141813"} stroke={idx < occupants ? "#7FB489" : "#5B6459"}/>{idx < occupants && <circle cx={324 + i * 46} cy={236 + row * 22} r="4" fill="#8AC194"/>}</g>; })}</g>)}
        <text x="314" y="277" fill="#7E8A7F" fontSize="10">{integer(occupants)}/{integer(bunks)} bunks · {temperature(model.tempC)}</text>
      </Area>
      <Area x={477} y={198} w={166} h={84} title="POWER">
        <rect x="493" y="226" width="96" height="18" rx="4" fill="#171D16" stroke="#657264"/><rect x="496" y="229" width={90 * Math.max(0, Math.min(100, battery)) / 100} height="12" rx="3" fill={battery < 30 ? "#D46C58" : "#66BB7F"}/>
        <text x="598" y="239" fill="#CDD4CA" fontSize="11" fontWeight="800">{percent(battery)}</text>
        <text x="493" y="259" fill="#7E8A7F" fontSize="10">in {watts(model.solar)} · out {watts(model.load)}</text>
        <text x="493" y="274" fill={gen ? "#E1D47A" : "#7E8A7F"} fontSize="10">generator {gen ? "ONLINE" : "STANDBY"} · net {watts(model.net)}</text>
      </Area>
      <Area x={117} y={292} w={166} h={84} title="AIR / FILTRATION">
        <path d="M132 336 h20 m0 -12 v24 h18 v-24 z" fill="#141A13" stroke="#78958A" strokeWidth="2"/>
        {[0, 1, 2].map(i => <path key={i} d={"M" + (135 + i * 6) + " " + (322 - i * 2) + " q4 6 0 12"} stroke={sealed ? "#72D293" : "#5D6E63"} fill="none"/>)}
        <text x="180" y="331" fill="#CED5CA" fontSize="11" fontWeight="800">FILTER {percent(model.filterLife)}</text><text x="180" y="348" fill="#7E8A7F" fontSize="10">intake → HEPA → habitat</text>
        <text x="132" y="366" fill="#7E8A7F" fontSize="10">{sealed ? "recirculating on positive pressure" : "drawing outside air"}</text>
      </Area>
      <Area x={297} y={292} w={166} h={84} title="COMMS">
        {/* directionality: bunker → mast → remote station */}
        <path d="M314 356 h16 v-32" stroke="#84A78C" strokeWidth="2" fill="none"/><path d="M330 324 l10 -9" stroke="#84A78C" strokeWidth="2"/>
        {[0, 1, 2].map(i => <path key={i} d={"M" + (342 + i * 9) + " " + (318 + i * 2) + " q" + (7 + i * 3) + " " + (12 + i * 4) + " 0 " + (24 + i * 8)} fill="none" stroke={linked ? "#77D695" : "#3E4A40"} opacity={linked ? 1 - i * .22 : .5}/>)}
        <rect x="424" y="330" width="22" height="16" rx="2" fill="#141A13" stroke={linked ? "#77D695" : "#5C6659"}/><text x="435" y="360" textAnchor="middle" fill="#7E8A7F" fontSize="9">STATION</text>
        <text x="314" y="313" fill="#CED5CA" fontSize="11" fontWeight="800">{decimal(model.frequency, 2)} MHz {transmitting ? "· TX" : linked ? "· RX" : ""}</text>
        <text x="314" y="374" fill="#7E8A7F" fontSize="10">{linked ? "signal " + signal : "monitoring"} · {integer(model.contactsToday)} contacts today</text>
      </Area>
      <Area x={477} y={292} w={166} h={84} title="SUPPLIES">
        <text x="497" y="337" fill="#D0D5CC" fontSize="19" fontWeight="850">{integer(model.foodDays)}d</text><text x="565" y="337" fill="#D0D5CC" fontSize="19" fontWeight="850">{integer(model.waterDays)}d</text>
        <text x="497" y="355" fill="#7E8A7F" fontSize="10">food</text><text x="565" y="355" fill="#7E8A7F" fontSize="10">water</text>
        <text x="497" y="372" fill="#7E8A7F" fontSize="10">for {integer(occupants)} at current draw</text>
      </Area>
      <text x="14" y="402" fill="#7E8A7F" fontSize="11">BUILT FOR THE REAL WORLD. AND THE UNDEAD ONE.</text></svg></div></div>;
}
