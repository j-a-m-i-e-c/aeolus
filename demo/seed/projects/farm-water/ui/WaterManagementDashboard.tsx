// farm-water — visual implementation behind ui/index.tsx
import { useEffect, useState } from "react";
import { clamp, useSmooth } from "./hooks";
import { WaterSchematic } from "./WaterSchematic";
export default function WaterManagementDashboard({ model, actions }: {
    model: Record<string, any>;
    actions: Record<string, (...args: any[]) => void>;
}) {
    const damTarget = clamp(Number(model.damPct ?? 82), 0, 100);
    const headerTarget = clamp(Number(model.headerPct ?? 65), 0, 100);
    const shedTarget = clamp(Number(model.shedPct ?? 72), 0, 100);
    const houseTarget = clamp(Number(model.housePct ?? 64), 0, 100);
    const dam = useSmooth(damTarget);
    const header = useSmooth(headerTarget);
    const shed = useSmooth(shedTarget);
    const house = useSmooth(houseTarget);
    const pumpOn = Boolean(model.pumpOn);
    const flow = Math.max(0, Number(model.flowLpm ?? 0));
    const batterySoc = clamp(Number(model.batterySoc ?? 78), 0, 100);
    const energyAllowed = model.energyAllowed !== false && batterySoc >= 30;
    const distributionActive = Boolean(model.distributionActive);
    const houseRefill = Boolean(model.houseRefillActive);
    const shedRefill = Boolean(model.shedRefillActive);
    const transferActive = Boolean(model.transferActive);
    const transferStopping = Boolean(model.transferStopping);
    const transferMode = String(model.transferMode ?? "idle");
    const transferTarget = Math.max(0, Number(model.transferTargetLitres ?? 0));
    const transferProgress = Math.max(0, Number(model.transferProgressLitres ?? 0));
    const totalizer = Math.max(0, Number(model.flowTotalLitres ?? 0));
    const lastTransfer = Math.max(0, Number(model.lastTransferLitres ?? 0));
    const demoScenarioPending = String(model.demoScenarioPending ?? "");
    const lastAction = model.lastAction as any;
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
    return (<div style={{ padding: 12, minHeight: "100%", color: "#E8EEF2", background: "linear-gradient(180deg,#081315,#071012 58%,#070C0D)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 850 }}>WATER MANAGEMENT</div>
          <div style={{ color: "#657A7F", fontSize: 11, marginTop: 2 }}>Dam transfer · header reserve · house & shed distribution</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: moving ? "#78E6FF" : pumpOn ? "#F1C06B" : "#7C8F91", fontSize: 11, fontWeight: 800 }}>{transferStopping ? "STOPPING" : moving ? (transferMode === "automatic" ? "AUTO RECOVERY" : "BATCH TRANSFER") : pumpOn ? "PUMP ON · WAITING FLOW" : distributionActive ? "DISTRIBUTING" : "SYSTEM BALANCED"}</div>
          <div style={{ color: "#596D70", fontSize: 11, marginTop: 2 }}>{flow.toFixed(0)} L/min · totalizer {Math.round(totalizer).toLocaleString()} L</div>
        </div>
      </div>

      <WaterSchematic dam={dam} header={header} shed={shed} house={house} moving={moving} pumpOn={pumpOn} shedRefill={shedRefill} houseRefill={houseRefill} phase={phase}/>

      {transferTarget > 0 && <div style={{ marginTop: 8, padding: "7px 9px", border: "1px solid #234651", borderRadius: 8, background: "#09191E" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#718B91", marginBottom: 5 }}>
          <span>{transferMode === "automatic" ? "AUTOMATIC HEADER RECOVERY" : "OPERATOR BATCH"}</span>
          <span>{Math.min(transferTarget, transferProgress).toFixed(0)} / {transferTarget.toFixed(0)} L</span>
        </div>
        <div style={{ height: 5, borderRadius: 5, background: "#173038", overflow: "hidden" }}><div style={{ width: batchPct + "%", height: "100%", background: "#55D6F3" }}/></div>
      </div>}

      <div style={{ marginTop: 8, padding: 8, border: "1px solid #244650", borderRadius: 9, background: "#0A171B" }}>
        <div style={{ color: "#6E858B", fontSize: 11, fontWeight: 800, letterSpacing: 1, marginBottom: 6 }}>OPERATOR CONTROLS</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 5 }}>
          <button onClick={() => actions.transfer500()} disabled={operatorBusy || !energyAllowed} style={{ borderRadius: 7, padding: "7px 4px", border: "1px solid " + (!operatorBusy && energyAllowed ? "#27586A" : "#2C393D"), background: !operatorBusy && energyAllowed ? "#0C2630" : "#12191B", color: !operatorBusy && energyAllowed ? "#79DDF5" : "#5B686C", fontSize: 11, fontWeight: 750, cursor: !operatorBusy && energyAllowed ? "pointer" : "not-allowed" }}>Transfer 500 L</button>
          <button onClick={() => actions.transfer1000()} disabled={operatorBusy || !energyAllowed} style={{ borderRadius: 7, padding: "7px 4px", border: "1px solid " + (!operatorBusy && energyAllowed ? "#27586A" : "#2C393D"), background: !operatorBusy && energyAllowed ? "#0C2630" : "#12191B", color: !operatorBusy && energyAllowed ? "#79DDF5" : "#5B686C", fontSize: 11, fontWeight: 750, cursor: !operatorBusy && energyAllowed ? "pointer" : "not-allowed" }}>Transfer 1000 L</button>
          <button onClick={() => actions.pumpStop()} disabled={!pumpOn || transferStopping} style={{ borderRadius: 7, padding: "7px 4px", border: "1px solid " + (pumpOn ? "#6A3B34" : "#2C3638"), background: pumpOn ? "#281713" : "#111718", color: pumpOn ? "#F39B8C" : "#566366", fontSize: 11, cursor: pumpOn && !transferStopping ? "pointer" : "not-allowed" }}>{transferStopping ? "Stopping…" : "Stop transfer"}</button>
        </div>
      </div>

      <div style={{ marginTop: 7, padding: 8, border: "1px dashed #5B4E2F", borderRadius: 9, background: "#17150D" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div><div style={{ color: "#C8AA62", fontSize: 11, fontWeight: 850, letterSpacing: 1 }}>DEMO SCENARIO</div><div style={{ color: "#766D54", fontSize: 11, marginTop: 2 }}>Injects external physical conditions. These are not normal operator controls.</div></div>
          {demoScenarioPending && <div style={{ color: "#D7B968", fontSize: 11 }}>INJECTING…</div>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr .7fr", gap: 5 }}>
          <button onClick={() => actions.simulateHeaderLow()} disabled={demoBusy} style={{ borderRadius: 7, padding: "7px 4px", border: "1px solid #5C4D2A", background: "#221C0E", color: demoBusy ? "#756C50" : "#D8BD6B", fontSize: 11, cursor: demoBusy ? "not-allowed" : "pointer" }}>Header drawdown</button>
          <button onClick={() => actions.simulatePropertyDemand()} disabled={demoBusy} style={{ borderRadius: 7, padding: "7px 4px", border: "1px solid #4D5630", background: "#19200E", color: demoBusy ? "#687052" : "#BACE78", fontSize: 11, cursor: demoBusy ? "not-allowed" : "pointer" }}>Morning demand</button>
          <button onClick={() => actions.resetWater()} style={{ borderRadius: 7, padding: "7px 4px", border: "1px solid #3D3A30", background: "#171713", color: "#8D8878", fontSize: 11, cursor: "pointer" }}>Reset demo</button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center", marginTop: 7 }}>
        <div style={{ color: "#677A7E", fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{actionLabel}{lastTransfer > 0 && !operatorBusy ? " · last batch " + Math.round(lastTransfer) + " L" : ""}</div>
        <div style={{ borderRadius: 999, padding: "2px 7px", border: "1px solid " + (energyAllowed ? "#31533A" : "#69462F"), background: energyAllowed ? "#102118" : "#25170F", color: energyAllowed ? "#78D890" : "#E6A16B", fontSize: 11 }}>ENERGY {energyAllowed ? "PERMITTED" : "HELD"} · {Math.round(batterySoc)}%</div>
      </div>
    </div>);
}
