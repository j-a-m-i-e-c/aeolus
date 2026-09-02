// farm-troughs — visual implementation behind ui/index.tsx
import { useEffect, useMemo, useState } from "react";
import { control, toggleProps } from "@aeolus/ui";
export default function TroughWateringDashboard({ model, actions }: {
    model: Record<string, any>;
    actions: Record<string, (...args: any[]) => void>;
}) {
    const average = Math.max(0, Math.min(100, Number(model.troughAverage ?? 83)));
    const low = Math.max(0, Math.min(20, Number(model.troughLow ?? 0)));
    const refilling = Math.max(0, Math.min(20, Number(model.troughRefilling ?? 0)));
    const levelsRaw = model.troughLevels as number[] | undefined;
    const levels = Array.isArray(levelsRaw) && levelsRaw.length === 20 ? levelsRaw : [86, 78, 91, 82, 74, 88, 79, 93, 84, 76, 90, 81, 87, 77, 92, 85, 73, 89, 80, 94];
    const lowIds = (model.lowIds as string[] | undefined) || [];
    const refillTargets = (model.refillTargets as string[] | undefined) || [];
    const drinkingIds = (model.drinkingIds as string[] | undefined) || [];
    const drinkingHead = Math.max(0, Number(model.drinkingHead ?? 0));
    const drinkingActive = Boolean(model.drinkingActive);
    const drinkingProgress = Math.max(0, Math.min(100, Number(model.drinkingProgress ?? 0)));
    const drinkScenarioRequested = Boolean(model.drinkScenarioRequested);
    const consumptionToday = Math.max(0, Number(model.consumptionTodayLitres ?? 1240));
    const lastDrink = Math.max(0, Number(model.lastDrinkLitres ?? 0));
    const refillFlow = Math.max(0, Number(model.refillFlowLpm ?? 0));
    const auto = model.autoRefill !== false;
    const refillCommandActive = Boolean(model.refillCommandActive);
    const lastAction = model.lastAction as any;
    const [phase, setPhase] = useState(0);
    useEffect(() => {
        const id = setInterval(() => setPhase((v) => (v + 1) % 100000), 110);
        return () => clearInterval(id);
    }, []);
    const positions = useMemo(() => Array.from({ length: 20 }).map((_, i) => ({
        x: 82 + (i % 5) * 88,
        y: 52 + Math.floor(i / 5) * 47,
    })), []);
    const scenarioBusy = drinkingActive || drinkScenarioRequested;
    const status = scenarioBusy ? "HERD WATERING " + Math.round(drinkingProgress) + "%" : refilling > 0 || refillCommandActive ? "REFILLING " + Math.max(refilling, refillTargets.length) : low > 0 ? low + " LOW" : "NETWORK HEALTHY";
    const statusColor = scenarioBusy ? "#E9C66D" : refilling > 0 || refillCommandActive ? "#76DDF4" : low > 0 ? "#F4A45A" : "#74DDA0";
    const actionLabel = lastAction?.label ? String(lastAction.label) : "Distributed trough telemetry online";
    // The refill control states its own reason: a manifold command already in
    // flight, cattle still at the troughs, or nothing below the threshold.
    const refillVisual = control({ pending: refillCommandActive, disabled: drinkingActive || low === 0 });
    const refillLabel = refillCommandActive
        ? "Refilling…"
        : drinkingActive
            ? "Waiting for herd to clear"
            : low === 0
                ? "No troughs below threshold"
                : "Refill " + low + " low trough" + (low === 1 ? "" : "s");
    const autoVisual = toggleProps(auto, { pending: refillCommandActive });
    function Trough(props: {
        index: number;
        x: number;
        y: number;
    }) {
        const id = "T" + (props.index + 1);
        const level = Math.max(0, Math.min(100, Number(levels[props.index]) || 0));
        const isLow = lowIds.includes(id) || level < 45;
        const isRefilling = refillTargets.includes(id);
        const isDrinking = drinkingIds.includes(id);
        const waterWidth = Math.max(3, 27 * level / 100);
        return <g transform={"translate(" + props.x + " " + props.y + ")"}>
      <line x1="-34" y1="0" x2="-13" y2="0" stroke={isRefilling ? "#4ECDED" : "#254451"} strokeWidth={isRefilling ? "2.2" : "1.2"}/>
      {isRefilling && <line x1="-31" y1="0" x2="-15" y2="0" stroke="#9CEFFF" strokeWidth="2.6" strokeLinecap="round" opacity={.45 + (Math.sin(phase * .16 + props.index) + 1) * .22}/>}
      <rect x="-13" y="-8" width="32" height="16" rx="5" fill="#0D191D" stroke={isLow ? "#9B6234" : isRefilling ? "#3F91A7" : "#345660"}/>
      <rect x="-10" y="1" width={waterWidth} height="4" rx="2" fill={isLow ? "#B27638" : "#43C7EA"} opacity=".85"/>
      <text x="3" y="-13" textAnchor="middle" fill="#6C828A" fontSize="10">{id}</text>
      <text x="3" y="20" textAnchor="middle" fill={isLow ? "#E4A767" : "#7E949A"} fontSize="10">{Math.round(level)}%</text>
      {isDrinking && <g transform="translate(25 -2)">
        <ellipse rx="6" ry="3.4" fill="#C9B27E"/>
        <circle cx="5" cy="-1" r="2.3" fill="#C9B27E"/>
        <line x1="7" y1="0" x2="11" y2="5" stroke="#C9B27E" strokeWidth="1.2"/>
        <circle cx="12" cy={7 + Math.sin(phase * .3 + props.index) * 2} r="1.5" fill="#72DCF5" opacity=".8"/>
      </g>}
    </g>;
    }
    return (<div style={{ padding: 12, minHeight: "100%", background: "linear-gradient(180deg,#091116,#080D10)", color: "#E8EEF2" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 850 }}>TROUGH WATERING</div>
          <div style={{ color: "#687982", fontSize: 11, marginTop: 2 }}>20 local level sensors · cattle demand · targeted refill manifold</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: statusColor, fontSize: 11, fontWeight: 800 }}>{status}</div>
          <div style={{ color: "#62737B", fontSize: 11 }}>{Math.round(average)}% average · {refillFlow.toFixed(0)} L/min refill</div>
        </div>
      </div>

      <div style={{ border: "1px solid #263B43", borderRadius: 11, background: "#071116", overflow: "hidden" }}>
        <svg width="100%" height="242" viewBox="0 0 520 242">
          <rect width="520" height="242" fill="#071116"/>
          <path d="M25 28 L25 216" stroke="#2A6273" strokeWidth="6" strokeLinecap="round"/>
          <path d="M25 28 L25 216" stroke="#55CAE9" strokeWidth="1.7" strokeLinecap="round" opacity={refilling > 0 ? .95 : .45}/>
          {[52, 99, 146, 193].map((y, row) => <g key={row}>
            <line x1="25" y1={y} x2="475" y2={y} stroke="#213D48" strokeWidth="2"/>
            <text x="34" y={y - 9} fill="#536971" fontSize="10">PADDOCK {String.fromCharCode(65 + row)}</text>
          </g>)}
          {positions.map((pos, i) => <Trough key={i} index={i} x={pos.x} y={pos.y}/>)}
          <g transform="translate(372 13)">
            <rect width="132" height="30" rx="7" fill="#0A171B" stroke="#28444D"/>
            <text x="9" y="12" fill="#677B82" fontSize="10">HERD WATER USE TODAY</text>
            <text x="9" y="24" fill="#86E3F7" fontSize="10" fontFamily="monospace" fontWeight="700">{Math.round(consumptionToday).toLocaleString()} L</text>
            {lastDrink > 0 && <text x="82" y="24" fill="#A79062" fontSize="10">last drink {Math.round(lastDrink)} L</text>}
          </g>
          {drinkingHead > 0 && <text x="34" y="231" fill="#BDA66C" fontSize="10">{drinkingHead} head currently drinking · {Math.round(drinkingProgress)}% through simulated visit</text>}
        </svg>
      </div>

      <div style={{ marginTop: 8, padding: 8, border: "1px solid #27424A", borderRadius: 9, background: "#0A161A" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", marginBottom: 6 }}>
          <div><div style={{ color: "#70838A", fontSize: 11, fontWeight: 850, letterSpacing: 1 }}>OPERATOR CONTROLS</div><div style={{ color: "#596A70", fontSize: 11, marginTop: 2 }}>Auto refill waits until cattle leave, then restores troughs below 45%.</div></div>
          <div style={{ color: auto ? "#83DFA0" : "#8A9291", fontSize: 11, fontWeight: 800 }}>AUTO REFILL {auto ? "ON" : "OFF"}</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <button {...refillVisual} style={{ ...refillVisual.style, padding: "8px 5px" }} onClick={() => actions.refillTroughs()}>{refillLabel}</button>
          <button {...autoVisual} style={{ ...autoVisual.style, padding: "8px 5px" }} onClick={() => actions.toggleAuto()}>Automatic refill {auto ? "ON" : "OFF"}</button>
        </div>
      </div>

      <div style={{ marginTop: 16, padding: 8, border: "1px dashed #5D5331", borderRadius: 9, background: "#17150D" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div><div style={{ color: "#C8AE66", fontSize: 11, fontWeight: 850, letterSpacing: 1 }}>DEMO SCENARIO</div><div style={{ color: "#766E55", fontSize: 11, marginTop: 2 }}>Injects a herd visit into the simulated physical world.</div></div>
          {scenarioBusy && <div style={{ color: "#D8BC72", fontSize: 11 }}>HERD VISIT {Math.round(drinkingProgress)}%</div>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1.35fr .65fr", gap: 6 }}>
          <button onClick={() => actions.simulateDrinking()} disabled={scenarioBusy || refilling > 0 || refillCommandActive} style={{ borderRadius: 8, padding: "8px 5px", border: "1px solid #5E5631", background: "#211D0F", color: scenarioBusy || refilling > 0 ? "#756D50" : "#DAC175", fontSize: 11, fontWeight: 750, cursor: scenarioBusy || refilling > 0 ? "not-allowed" : "pointer" }}>{scenarioBusy ? "Herd drinking…" : "Herd visits troughs"}</button>
          <button onClick={() => actions.resetTroughs()} style={{ borderRadius: 8, padding: "8px 5px", border: "1px solid #3D3A30", background: "#171713", color: "#8D8878", fontSize: 11, cursor: "pointer" }}>Reset demo</button>
        </div>
      </div>
      <div style={{ color: "#63727A", fontSize: 11, marginTop: 7, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{actionLabel}</div>
    </div>);
}
