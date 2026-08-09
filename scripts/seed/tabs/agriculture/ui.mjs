export const ui = `import { useEffect, useMemo, useState } from "react";
import type { CustomComponentProps } from "./types";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export default function PropertyOperations(aeolus: CustomComponentProps) {
  function physical(topic: string): any {
    return aeolus.devices.find((device: any) => device.topic === topic);
  }

  const damDevice = physical("sensor/farm/dam");
  const headerDevice = physical("sensor/farm/header-tank");
  const collarsDevice = physical("sensor/fence/collars");
  const troughDevice = physical("sensor/farm/troughs");
  const pumpDevice = physical("switch/farm/dam-pump/state");
  const flowDevice = physical("sensor/farm/transfer-flow");
  const batteryDevice = physical("sensor/farm/energy/battery");

  // Physical truth comes from the Device Registry. Automation-local state is
  // intentionally used only for presentation/status such as lastAction.
  const sharedDam = clamp(Number(damDevice?.state?.value ?? 82), 0, 100);
  const sharedHeader = clamp(Number(headerDevice?.state?.value ?? 65), 0, 100);
  const strays = clamp(Number(collarsDevice?.state?.strays ?? 2), 0, 30);
  const troughAverage = clamp(Number(troughDevice?.state?.average ?? 71), 0, 100);
  const troughLow = clamp(Number(troughDevice?.state?.low ?? 3), 0, 20);
  const troughRefilling = clamp(Number(troughDevice?.state?.refilling ?? 2), 0, 20);
  const pumpOn = Boolean(pumpDevice?.state?.on);
  const flow = Number(flowDevice?.state?.litresPerMinute ?? 0);
  const batterySoc = clamp(Number(batteryDevice?.state?.soc ?? 78), 0, 100);
  const energyAllowed = batteryDevice?.state?.available !== false && batterySoc >= 30;
  const lastAction = aeolus.read("lastAction") as any;

  const [dam, setDam] = useState(sharedDam);
  const [header, setHeader] = useState(sharedHeader);
  const [phase, setPhase] = useState(0);
  const [selectedCow, setSelectedCow] = useState<number | null>(null);

  useEffect(() => {
    let frame = 0;
    const fromDam = dam;
    const fromHeader = header;
    const id = setInterval(() => {
      frame += 1;
      const t = Math.min(1, frame / 24);
      const eased = 1 - Math.pow(1 - t, 3);
      setDam(lerp(fromDam, sharedDam, eased));
      setHeader(lerp(fromHeader, sharedHeader, eased));
      if (t >= 1) clearInterval(id);
    }, 45);
    return () => clearInterval(id);
  }, [sharedDam, sharedHeader]);

  useEffect(() => {
    const id = setInterval(() => setPhase((v) => (v + 1) % 100000), 90);
    return () => clearInterval(id);
  }, []);

  const cattle = useMemo(() => {
    const list: Array<{ x: number; y: number; r: number; p: number }> = [];
    for (let i = 0; i < 30; i++) {
      const col = i % 6;
      const row = Math.floor(i / 6);
      list.push({ x: 210 + col * 35 + (row % 2) * 10, y: 118 + row * 22, r: 2.8 + (i % 3) * 0.25, p: i * 0.74 });
    }
    return list;
  }, []);

  const actionLabel = lastAction && lastAction.label ? String(lastAction.label) : "Property online";
  const fenceAlert = strays > 0;
  const headerY = 112 + (1 - header / 100) * 63;
  const damY = 244 + (1 - dam / 100) * 54;
  const pumpGlow = pumpOn ? "#48C6FF" : "#485563";

  return (
    <div style={{ padding: 14, minHeight: "100%", color: "#E8EEF5", background: "linear-gradient(180deg,#0B1110 0%,#09100D 54%,#080C0A 100%)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 10 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontWeight: 850, fontSize: 15, letterSpacing: "0.02em" }}>PROPERTY OPERATIONS</span>
            <span style={{ border: "1px solid #284031", background: "#122319", color: "#78D99A", borderRadius: 999, padding: "2px 7px", fontSize: 8, letterSpacing: "0.1em" }}>EDGE ONLINE</span>
          </div>
          <div style={{ color: "#718077", fontSize: 9, marginTop: 3 }}>Water · livestock · distributed infrastructure · local-first control</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: fenceAlert ? "#FF7A6A" : "#77E69B", fontSize: 10, fontWeight: 800 }}>{fenceAlert ? strays + " COLLARS OUTSIDE" : "HERD CONTAINED"}</div>
          <div style={{ color: "#657269", fontSize: 8, marginTop: 2 }}>{actionLabel}</div>
        </div>
      </div>

      <div style={{ border: "1px solid #25352B", borderRadius: 14, overflow: "hidden", background: "#07100B", boxShadow: "inset 0 0 60px rgba(30,80,45,.08)" }}>
        <svg width="100%" height="390" viewBox="0 0 720 390" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="field" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#19371E" />
              <stop offset="1" stopColor="#0D2113" />
            </linearGradient>
            <linearGradient id="water" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#4DD7FF" />
              <stop offset="1" stopColor="#1767C7" />
            </linearGradient>
            <linearGradient id="tankFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#66DEFF" stopOpacity="0.85" />
              <stop offset="1" stopColor="#237BC8" stopOpacity="0.65" />
            </linearGradient>
            <filter id="glow"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          </defs>

          <rect width="720" height="390" fill="#09130D" />
          <path d="M0 205 C105 165 170 176 251 155 C350 129 430 111 520 126 C610 141 659 101 720 82 L720 390 L0 390 Z" fill="url(#field)" />
          <path d="M0 251 C120 214 176 232 284 205 C398 176 512 170 720 145" fill="none" stroke="#31543B" strokeWidth="1" strokeOpacity="0.55" />
          <path d="M0 292 C123 256 199 277 322 246 C454 213 582 220 720 187" fill="none" stroke="#31543B" strokeWidth="1" strokeOpacity="0.4" />
          <path d="M10 339 C128 311 219 320 324 300 C486 270 591 274 710 244" fill="none" stroke="#31543B" strokeWidth="1" strokeOpacity="0.26" />

          {/* Virtual paddock */}
          <path d="M175 87 L463 74 L500 221 L190 236 Z" fill="#112A17" fillOpacity="0.45" stroke={fenceAlert ? "#FF7A6A" : "#62DB84"} strokeWidth="1.4" strokeDasharray="7 5" />
          <text x="186" y="81" fill={fenceAlert ? "#FF8B7E" : "#73E494"} fontSize="8" letterSpacing="1.3">VIRTUAL PADDOCK A</text>

          {/* Cattle: deterministic base positions with local organic motion. */}
          {cattle.map((cow, i) => {
            const isStray = i < strays;
            const wanderX = Math.sin(phase * 0.07 + cow.p) * 5 + Math.sin(phase * 0.021 + cow.p * 2) * 3;
            const wanderY = Math.cos(phase * 0.052 + cow.p) * 3;
            const x = isStray ? 155 - i * 15 + wanderX : cow.x + wanderX;
            const y = isStray ? 143 + i * 38 + wanderY : cow.y + wanderY;
            const selected = selectedCow === i;
            return (
              <g key={i} onClick={() => setSelectedCow(selected ? null : i)} style={{ cursor: "pointer" }}>
                {isStray && <circle cx={x} cy={y} r="10" fill="none" stroke="#FF6659" strokeOpacity={0.35 + (Math.sin(phase * 0.15 + i) * 0.5 + 0.5) * 0.5} />}
                {selected && <circle cx={x} cy={y} r="8" fill="none" stroke="#77E9FF" strokeWidth="1.2" />}
                <ellipse cx={x} cy={y} rx={cow.r * 1.6} ry={cow.r} fill={isStray ? "#FF7467" : "#D3BE8D"} />
                <circle cx={x + cow.r * 1.5} cy={y - 0.4} r={cow.r * 0.62} fill={isStray ? "#FF7467" : "#D3BE8D"} />
                <line x1={x - 2} y1={y + 2} x2={x - 2} y2={y + 5} stroke="#8A7B59" strokeWidth="1" />
                <line x1={x + 2} y1={y + 2} x2={x + 2} y2={y + 5} stroke="#8A7B59" strokeWidth="1" />
              </g>
            );
          })}

          {/* Dam */}
          <path d="M30 280 C55 249 129 240 174 270 C184 286 171 320 126 329 C76 337 34 321 30 280 Z" fill="#0A2F43" stroke="#327BA2" strokeWidth="1.3" />
          <path d={"M34 " + damY + " C67 " + (damY - 14) + " 130 " + (damY - 18) + " 170 " + (damY + 2) + " L169 313 C124 331 61 329 38 310 Z"} fill="url(#water)" opacity="0.8" />
          <text x="96" y="272" textAnchor="middle" fill="#B4DFF3" fontSize="8" letterSpacing="1">LOWER DAM</text>
          <text x="96" y="291" textAnchor="middle" fill="#FFFFFF" fontSize="18" fontFamily="monospace" fontWeight="700">{Math.round(dam)}%</text>
          <text x="96" y="305" textAnchor="middle" fill="#79A5B9" fontSize="7">{Math.round(dam * 600).toLocaleString()} L</text>

          {/* Pump and rising main */}
          <path d="M171 281 C218 273 243 256 271 227 C310 187 343 167 410 153 C465 142 494 120 540 98" fill="none" stroke="#24373B" strokeWidth="8" strokeLinecap="round" />
          <path d="M171 281 C218 273 243 256 271 227 C310 187 343 167 410 153 C465 142 494 120 540 98" fill="none" stroke={pumpOn ? "#41BFEA" : "#36525D"} strokeWidth="2.5" strokeLinecap="round" />
          {pumpOn && Array.from({ length: 8 }).map((_, i) => {
            const t = ((phase * 0.012 + i / 8) % 1);
            const x = 171 + t * 369;
            const y = 281 - t * 183 - Math.sin(t * Math.PI) * 24;
            return <circle key={i} cx={x} cy={y} r="2.2" fill="#7EE6FF" filter="url(#glow)" />;
          })}
          <circle cx="184" cy="272" r="15" fill="#0C1B20" stroke={pumpGlow} strokeWidth="1.6" />
          <g transform="translate(184 272)" style={{ transform: "rotate(" + (pumpOn ? phase * 12 : 0) + "deg)", transformOrigin: "184px 272px" }}>
            <path d="M0 -9 L3 -2 L9 0 L3 2 L0 9 L-3 2 L-9 0 L-3 -2 Z" fill={pumpGlow} />
          </g>
          <text x="184" y="296" textAnchor="middle" fill="#6F8790" fontSize="7">TRANSFER PUMP</text>

          {/* Header tank on hill */}
          <rect x="526" y="64" width="70" height="112" rx="10" fill="#111B1F" stroke="#78939D" strokeWidth="1.1" />
          <rect x="530" y={headerY} width="62" height={172 - headerY} rx="6" fill="url(#tankFill)" />
          <ellipse cx="561" cy="65" rx="35" ry="8" fill="#19252A" stroke="#78939D" strokeWidth="1" />
          <text x="561" y="91" textAnchor="middle" fill="#AFC2CA" fontSize="8" letterSpacing="1">HEADER</text>
          <text x="561" y="116" textAnchor="middle" fill="#FFFFFF" fontSize="20" fontFamily="monospace" fontWeight="700">{Math.round(header)}%</text>
          <text x="561" y="132" textAnchor="middle" fill="#8BABB8" fontSize="7">{Math.round(header * 50).toLocaleString()} L</text>

          {/* Shed and house */}
          <path d="M531 228 L568 207 L606 228 V267 H531 Z" fill="#16211E" stroke="#526960" strokeWidth="1" />
          <rect x="547" y="239" width="15" height="28" fill="#0B1311" />
          <rect x="575" y="236" width="15" height="12" fill="#3A686A" opacity="0.75" />
          <text x="568" y="282" textAnchor="middle" fill="#788A82" fontSize="7">SHED / SOLAR</text>

          <path d="M621 199 L650 181 L680 199 V236 H621 Z" fill="#17201C" stroke="#66786F" strokeWidth="1" />
          <rect x="644" y="215" width="11" height="21" fill="#0B1311" />
          <text x="650" y="250" textAnchor="middle" fill="#788A82" fontSize="7">HOUSE</text>

          {/* Trough line */}
          <path d="M425 235 C472 259 504 278 548 307" fill="none" stroke="#294A56" strokeWidth="2" strokeDasharray="5 5" />
          {Array.from({ length: 5 }).map((_, i) => {
            const x = 444 + i * 29;
            const y = 248 + i * 14;
            const low = i < Math.min(5, troughLow);
            return <g key={i}><ellipse cx={x} cy={y} rx="10" ry="4" fill="#10191A" stroke={low ? "#F6A84B" : "#4AAFD0"} strokeWidth="1"/><ellipse cx={x} cy={y} rx="7" ry="2.2" fill={low ? "#6D4821" : "#227598"}/></g>;
          })}
          <text x="499" y="333" textAnchor="middle" fill="#71837B" fontSize="7">20 NETWORKED TROUGHS</text>

          {/* Status chips inside scene */}
          <g transform="translate(23 18)">
            <rect width="160" height="32" rx="7" fill="#0B1410" stroke="#294234" />
            <text x="12" y="12" fill="#6E8177" fontSize="7">FENCE ENERGISER</text>
            <text x="12" y="24" fill="#7CEB9B" fontSize="11" fontFamily="monospace" fontWeight="700">7.2 kV</text>
            <text x="90" y="24" fill={fenceAlert ? "#FF7165" : "#7CEB9B"} fontSize="8">{fenceAlert ? strays + " stray" : "contained"}</text>
          </g>
          <g transform="translate(542 18)">
            <rect width="155" height="32" rx="7" fill="#0B1410" stroke="#294234" />
            <text x="12" y="12" fill="#6E8177" fontSize="7">TROUGHS</text>
            <text x="12" y="24" fill="#55CAE8" fontSize="11" fontFamily="monospace" fontWeight="700">{Math.round(troughAverage)}%</text>
            <text x="64" y="24" fill={troughLow > 0 ? "#F6A84B" : "#7CEB9B"} fontSize="8">{troughLow} low · {troughRefilling} filling</text>
          </g>

          {selectedCow !== null && (
            <g transform="translate(238 250)">
              <rect width="180" height="44" rx="8" fill="#08110D" stroke="#4B7560" />
              <text x="12" y="16" fill="#E4EEE8" fontSize="9" fontWeight="700">Collar #{String(1001 + selectedCow).slice(1)}</text>
              <text x="12" y="30" fill={selectedCow < strays ? "#FF776B" : "#7BDD98"} fontSize="8">{selectedCow < strays ? "Outside virtual fence" : "Grazing in Paddock A"}</text>
              <text x="128" y="30" fill="#769087" fontSize="7">battery {68 + (selectedCow % 23)}%</text>
            </g>
          )}
        </svg>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.35fr 1fr 1fr", gap: 8, marginTop: 9 }}>
        <div style={{ border: "1px solid #24362B", borderRadius: 11, background: "#0B120E", padding: 10 }}>
          <div style={{ color: "#718077", fontSize: 8, letterSpacing: "0.12em", marginBottom: 7 }}>WATER TRANSFER</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button onClick={() => aeolus.fire("transfer-500")} style={{ background: "#0E2A34", color: "#78DEFF", border: "1px solid #245F72", borderRadius: 7, padding: "7px 10px", fontSize: 9, cursor: "pointer" }}>+500 L uphill</button>
            <button onClick={() => aeolus.fire("transfer-1000")} style={{ background: "#10313B", color: "#84E5FF", border: "1px solid #2B7186", borderRadius: 7, padding: "7px 10px", fontSize: 9, cursor: "pointer", fontWeight: 700 }}>+1000 L</button>
            <button onClick={() => aeolus.fire("pump-stop")} style={{ background: "#171B19", color: "#87948D", border: "1px solid #313A35", borderRadius: 7, padding: "7px 9px", fontSize: 9, cursor: "pointer" }}>Stop</button>
            <button onClick={() => aeolus.fire("simulate-header-low")} style={{ background: "#16150F", color: "#D8B76C", border: "1px solid #51462A", borderRadius: 7, padding: "7px 9px", fontSize: 9, cursor: "pointer" }}>Simulate drawdown</button>
          </div>
          <div style={{ color: "#60706A", fontSize: 8, marginTop: 7 }}>{pumpOn ? "Pump running · " + flow + " L/min" : "Pump idle · local automation available without cloud"}</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 5 }}>
            <span style={{ color: energyAllowed ? "#72C98B" : "#F0A064", fontSize: 8 }}>Battery {Math.round(batterySoc)}% · {energyAllowed ? "transfer permitted" : "reserve protecting load"}</span>
            <button onClick={() => aeolus.fire(energyAllowed ? "simulate-low-battery" : "restore-battery")} style={{ background: "transparent", color: "#6F8177", border: 0, padding: 0, fontSize: 7, cursor: "pointer" }}>{energyAllowed ? "simulate low reserve" : "restore reserve"}</button>
          </div>
        </div>

        <div style={{ border: "1px solid " + (fenceAlert ? "#6B342F" : "#24422D"), borderRadius: 11, background: fenceAlert ? "#17100E" : "#0B120E", padding: 10 }}>
          <div style={{ color: fenceAlert ? "#F38C7E" : "#7BDC98", fontSize: 8, letterSpacing: "0.12em", marginBottom: 7 }}>VIRTUAL FENCE</div>
          <button onClick={() => aeolus.fire(fenceAlert ? "recall-strays" : "simulate-strays")} style={{ width: "100%", background: fenceAlert ? "#2A1714" : "#11241A", color: fenceAlert ? "#FF9588" : "#8DE9A8", border: "1px solid " + (fenceAlert ? "#713B34" : "#31573C"), borderRadius: 7, padding: "7px 8px", fontSize: 9, cursor: "pointer", fontWeight: 700 }}>{fenceAlert ? "Recall 2 strays" : "Simulate boundary breach"}</button>
          <div style={{ color: "#60706A", fontSize: 8, marginTop: 7 }}>30 / 30 collars tracked</div>
        </div>

        <div style={{ border: "1px solid #24362B", borderRadius: 11, background: "#0B120E", padding: 10 }}>
          <div style={{ color: "#73BBD0", fontSize: 8, letterSpacing: "0.12em", marginBottom: 7 }}>TROUGHS</div>
          <button onClick={() => aeolus.fire(troughLow > 0 ? "refill-troughs" : "simulate-low-troughs")} style={{ width: "100%", background: "#10262D", color: "#7BDAF2", border: "1px solid #2A5965", borderRadius: 7, padding: "7px 8px", fontSize: 9, cursor: "pointer", fontWeight: 700 }}>{troughLow > 0 ? "Start refill cycle" : "Simulate low troughs"}</button>
          <div style={{ color: "#60706A", fontSize: 8, marginTop: 7 }}>Avg {Math.round(troughAverage)}% · {troughLow} low</div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 9, color: "#59675F", fontSize: 8 }}>
        <span>Simulated property · physical state arrives over MQTT · motion rendered locally</span>
        <button onClick={() => aeolus.fire("reset-farm")} style={{ background: "transparent", border: 0, color: "#708078", fontSize: 8, cursor: "pointer" }}>Reset property</button>
      </div>
    </div>
  );
}`;
