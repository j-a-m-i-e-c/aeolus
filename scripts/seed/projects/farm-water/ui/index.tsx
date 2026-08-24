import { useEffect, useState } from "react";
import type { CustomComponentProps } from "./types";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function useSmooth(value: number) {
  const [display, setDisplay] = useState(value);
  useEffect(() => {
    let frame = 0;
    const from = display;
    const id = setInterval(() => {
      frame += 1;
      const t = Math.min(1, frame / 18);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (value - from) * eased);
      if (t >= 1) clearInterval(id);
    }, 45);
    return () => clearInterval(id);
  }, [value]);
  return display;
}

export default function WaterManagement(aeolus: CustomComponentProps) {
  const damTarget = clamp(Number(aeolus.read("damPct") ?? 82), 0, 100);
  const headerTarget = clamp(Number(aeolus.read("headerPct") ?? 65), 0, 100);
  const shedTarget = clamp(Number(aeolus.read("shedPct") ?? 72), 0, 100);
  const houseTarget = clamp(Number(aeolus.read("housePct") ?? 64), 0, 100);
  const dam = useSmooth(damTarget);
  const header = useSmooth(headerTarget);
  const shed = useSmooth(shedTarget);
  const house = useSmooth(houseTarget);
  const pumpOn = Boolean(aeolus.read("pumpOn"));
  const flow = Math.max(0, Number(aeolus.read("flowLpm") ?? 0));
  const batterySoc = clamp(Number(aeolus.read("batterySoc") ?? 78), 0, 100);
  const energyAllowed = aeolus.read("energyAllowed") !== false && batterySoc >= 30;
  const distributionActive = Boolean(aeolus.read("distributionActive"));
  const houseRefill = Boolean(aeolus.read("houseRefillActive"));
  const shedRefill = Boolean(aeolus.read("shedRefillActive"));
  const transferActive = Boolean(aeolus.read("transferActive"));
  const transferStopping = Boolean(aeolus.read("transferStopping"));
  const transferMode = String(aeolus.read("transferMode") ?? "idle");
  const transferTarget = Math.max(0, Number(aeolus.read("transferTargetLitres") ?? 0));
  const transferProgress = Math.max(0, Number(aeolus.read("transferProgressLitres") ?? 0));
  const totalizer = Math.max(0, Number(aeolus.read("flowTotalLitres") ?? 0));
  const lastTransfer = Math.max(0, Number(aeolus.read("lastTransferLitres") ?? 0));
  const demoScenarioPending = String(aeolus.read("demoScenarioPending") ?? "");
  const lastAction = aeolus.read("lastAction") as any;
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setPhase((value) => (value + 1) % 100000), 90);
    return () => clearInterval(id);
  }, []);

  const moving = pumpOn && flow > 0;
  const batchPct = transferTarget > 0 ? Math.max(0, Math.min(100, transferProgress / transferTarget * 100)) : 0;
  const operatorBusy = pumpOn || transferActive || transferStopping;
  const demoBusy = operatorBusy || distributionActive || houseRefill || shedRefill || demoScenarioPending.length > 0;
  const actionLabel = lastAction?.label ? String(lastAction.label) : "Water system online";

  function Tank(props: { x: number; y: number; w: number; h: number; label: string; value: number; litresPerPct: number; accent?: string }) {
    const fill = Math.max(5, (props.h - 10) * props.value / 100);
    const accent = props.accent || "#42C9EA";
    return <g transform={"translate(" + props.x + " " + props.y + ")"}>
      <rect width={props.w} height={props.h} rx="10" fill="#0A171A" stroke="#405E64" strokeWidth="1.2" />
      <rect x="5" y={props.h - 5 - fill} width={props.w - 10} height={fill} rx="6" fill={accent} opacity=".58" />
      <line x1="7" x2={props.w - 7} y1={props.h * .35} y2={props.h * .35} stroke="#6A8388" strokeOpacity=".22" strokeDasharray="3 4" />
      <text x={props.w / 2} y="-7" textAnchor="middle" fill="#7C9297" fontSize="10" letterSpacing="1">{props.label}</text>
      <text x={props.w / 2} y={props.h / 2 + 4} textAnchor="middle" fill="#E9FAFE" fontSize={props.w > 75 ? "18" : "13"} fontFamily="monospace" fontWeight="800">{Math.round(props.value)}%</text>
      <text x={props.w / 2} y={props.h / 2 + 18} textAnchor="middle" fill="#68878E" fontSize="10">{Math.round(props.value * props.litresPerPct).toLocaleString()} L</text>
    </g>;
  }

  function PulseLine(props: { path: string; active: boolean; color?: string }) {
    const color = props.color || "#4BD9F6";
    return <g>
      <path d={props.path} fill="none" stroke="#243A3F" strokeWidth="7" strokeLinecap="round" />
      <path d={props.path} fill="none" stroke={props.active ? color : "#40585D"} strokeWidth="2.2" strokeLinecap="round" />
      {props.active && Array.from({ length: 5 }).map((_, i) => {
        const offset = ((phase * 4 + i * 19) % 100);
        return <path key={i} d={props.path} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeDasharray="1 99" strokeDashoffset={-offset} opacity=".9" />;
      })}
    </g>;
  }

  return (
    <div style={{ padding: 12, minHeight: "100%", color: "#E8EEF2", background: "linear-gradient(180deg,#081315,#071012 58%,#070C0D)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 850 }}>WATER MANAGEMENT</div>
          <div style={{ color: "#657A7F", fontSize:11, marginTop: 2 }}>Dam transfer · header reserve · house & shed distribution</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: moving ? "#78E6FF" : pumpOn ? "#F1C06B" : "#7C8F91", fontSize:11, fontWeight: 800 }}>{transferStopping ? "STOPPING" : moving ? (transferMode === "automatic" ? "AUTO RECOVERY" : "BATCH TRANSFER") : pumpOn ? "PUMP ON · WAITING FLOW" : distributionActive ? "DISTRIBUTING" : "SYSTEM BALANCED"}</div>
          <div style={{ color: "#596D70", fontSize:11, marginTop: 2 }}>{flow.toFixed(0)} L/min · totalizer {Math.round(totalizer).toLocaleString()} L</div>
        </div>
      </div>

      <div style={{ border: "1px solid #243B40", borderRadius: 12, overflow: "hidden", background: "#071114" }}>
        <svg width="100%" height="278" viewBox="0 0 620 278" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="water-ground" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#0D211B"/><stop offset="1" stopColor="#10271F"/></linearGradient>
            <filter id="water-glow"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          </defs>
          <rect width="620" height="278" fill="#071114" />
          <path d="M0 208 C120 170 214 180 300 142 C390 103 485 116 620 86 L620 278 L0 278 Z" fill="url(#water-ground)" />

          <Tank x={30} y={156} w={128} h={82} label="LOWER DAM" value={dam} litresPerPct={600} accent="#268FB3" />
          <PulseLine path="M158 199 C215 194 236 169 276 126 C310 90 345 82 386 82" active={moving} />
          <g transform="translate(220 174)">
            <circle r="23" fill="#09181B" stroke={pumpOn ? "#51D5F5" : "#3D5358"} strokeWidth="2" />
            <g style={{ transform: "rotate(" + (moving ? phase * 10 : 0) + "deg)", transformOrigin: "0px 0px" }}><path d="M0 -12 L4 -3 L12 0 L4 3 L0 12 L-4 3 L-12 0 L-4 -3 Z" fill={pumpOn ? "#70E2F7" : "#52666B"}/></g>
            <text x="0" y="36" textAnchor="middle" fill="#70868A" fontSize="10">TRANSFER</text>
          </g>

          <Tank x={366} y={38} w={102} h={128} label="HEADER" value={header} litresPerPct={50} accent="#38BFE4" />
          <PulseLine path="M417 166 C432 190 470 192 495 201" active={shedRefill} color="#66DCF5" />
          <PulseLine path="M417 166 C455 179 536 169 563 184" active={houseRefill} color="#66DCF5" />
          <Tank x={470} y={190} w={62} h={62} label="SHED" value={shed} litresPerPct={80} accent="#318CAC" />
          <Tank x={544} y={176} w={62} h={76} label="HOUSE" value={house} litresPerPct={40} accent="#318CAC" />

          <g transform="translate(483 170)"><circle r="7" fill={shedRefill ? "#4ED8F4" : "#18292D"} stroke="#4B676D"/><text x="0" y="2.5" textAnchor="middle" fill="#D9F8FE" fontSize="10">V</text></g>
          <g transform="translate(551 158)"><circle r="7" fill={houseRefill ? "#4ED8F4" : "#18292D"} stroke="#4B676D"/><text x="0" y="2.5" textAnchor="middle" fill="#D9F8FE" fontSize="10">V</text></g>

          {moving && Array.from({ length: 5 }).map((_, i) => <circle key={i} cx={178 + ((phase * 3 + i * 39) % 185)} cy={190 - ((phase * 3 + i * 39) % 185) * .48} r="2.1" fill="#9AF0FF" opacity=".9" filter="url(#water-glow)" />)}

          <text x="309" y="269" textAnchor="middle" fill="#50666B" fontSize="10">Header gravity feeds local storage · each refill is verified against the destination tank sensor</text>
        </svg>
      </div>

      {transferTarget > 0 && <div style={{ marginTop: 8, padding: "7px 9px", border: "1px solid #234651", borderRadius: 8, background: "#09191E" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize:11, color: "#718B91", marginBottom: 5 }}>
          <span>{transferMode === "automatic" ? "AUTOMATIC HEADER RECOVERY" : "OPERATOR BATCH"}</span>
          <span>{Math.min(transferTarget, transferProgress).toFixed(0)} / {transferTarget.toFixed(0)} L</span>
        </div>
        <div style={{ height: 5, borderRadius: 5, background: "#173038", overflow: "hidden" }}><div style={{ width: batchPct + "%", height: "100%", background: "#55D6F3" }} /></div>
      </div>}

      <div style={{ marginTop: 8, padding: 8, border: "1px solid #244650", borderRadius: 9, background: "#0A171B" }}>
        <div style={{ color: "#6E858B", fontSize:11, fontWeight: 800, letterSpacing: 1, marginBottom: 6 }}>OPERATOR CONTROLS</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 5 }}>
          <button onClick={() => aeolus.fire("transfer-500")} disabled={operatorBusy || !energyAllowed} style={{ borderRadius: 7, padding: "7px 4px", border: "1px solid " + (!operatorBusy && energyAllowed ? "#27586A" : "#2C393D"), background: !operatorBusy && energyAllowed ? "#0C2630" : "#12191B", color: !operatorBusy && energyAllowed ? "#79DDF5" : "#5B686C", fontSize:11, fontWeight: 750, cursor: !operatorBusy && energyAllowed ? "pointer" : "not-allowed" }}>Transfer 500 L</button>
          <button onClick={() => aeolus.fire("transfer-1000")} disabled={operatorBusy || !energyAllowed} style={{ borderRadius: 7, padding: "7px 4px", border: "1px solid " + (!operatorBusy && energyAllowed ? "#27586A" : "#2C393D"), background: !operatorBusy && energyAllowed ? "#0C2630" : "#12191B", color: !operatorBusy && energyAllowed ? "#79DDF5" : "#5B686C", fontSize:11, fontWeight: 750, cursor: !operatorBusy && energyAllowed ? "pointer" : "not-allowed" }}>Transfer 1000 L</button>
          <button onClick={() => aeolus.fire("pump-stop")} disabled={!pumpOn || transferStopping} style={{ borderRadius: 7, padding: "7px 4px", border: "1px solid " + (pumpOn ? "#6A3B34" : "#2C3638"), background: pumpOn ? "#281713" : "#111718", color: pumpOn ? "#F39B8C" : "#566366", fontSize:11, cursor: pumpOn && !transferStopping ? "pointer" : "not-allowed" }}>{transferStopping ? "Stopping…" : "Stop transfer"}</button>
        </div>
      </div>

      <div style={{ marginTop: 7, padding: 8, border: "1px dashed #5B4E2F", borderRadius: 9, background: "#17150D" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div><div style={{ color: "#C8AA62", fontSize:11, fontWeight: 850, letterSpacing: 1 }}>DEMO SCENARIO</div><div style={{ color: "#766D54", fontSize:11, marginTop: 2 }}>Injects external physical conditions. These are not normal operator controls.</div></div>
          {demoScenarioPending && <div style={{ color: "#D7B968", fontSize:11 }}>INJECTING…</div>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr .7fr", gap: 5 }}>
          <button onClick={() => aeolus.fire("simulate-header-low")} disabled={demoBusy} style={{ borderRadius: 7, padding: "7px 4px", border: "1px solid #5C4D2A", background: "#221C0E", color: demoBusy ? "#756C50" : "#D8BD6B", fontSize:11, cursor: demoBusy ? "not-allowed" : "pointer" }}>Header drawdown</button>
          <button onClick={() => aeolus.fire("simulate-property-demand")} disabled={demoBusy} style={{ borderRadius: 7, padding: "7px 4px", border: "1px solid #4D5630", background: "#19200E", color: demoBusy ? "#687052" : "#BACE78", fontSize:11, cursor: demoBusy ? "not-allowed" : "pointer" }}>Morning demand</button>
          <button onClick={() => aeolus.fire("reset-water")} style={{ borderRadius: 7, padding: "7px 4px", border: "1px solid #3D3A30", background: "#171713", color: "#8D8878", fontSize:11, cursor: "pointer" }}>Reset demo</button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center", marginTop: 7 }}>
        <div style={{ color: "#677A7E", fontSize:11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{actionLabel}{lastTransfer > 0 && !operatorBusy ? " · last batch " + Math.round(lastTransfer) + " L" : ""}</div>
        <div style={{ borderRadius: 999, padding: "2px 7px", border: "1px solid " + (energyAllowed ? "#31533A" : "#69462F"), background: energyAllowed ? "#102118" : "#25170F", color: energyAllowed ? "#78D890" : "#E6A16B", fontSize:11 }}>ENERGY {energyAllowed ? "PERMITTED" : "HELD"} · {Math.round(batterySoc)}%</div>
      </div>
    </div>
  );
}