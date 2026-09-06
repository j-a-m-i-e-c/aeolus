// farm-water — visual implementation behind ui/index.tsx
import { useEffect, useState } from "react";
import { commandLadder, commandVerdict, control, rungProps, verdictProps } from "@aeolus/ui";
import { clamp, useSmooth } from "./hooks";
import { WaterSchematic } from "./WaterSchematic";
export default function WaterManagementDashboard({ model, actions }: {
    model: Record<string, any>;
    actions: Record<string, (...args: any[]) => void>;
}) {
    const sourceTarget = clamp(Number(model.sourcePct ?? 82), 0, 100);
    const headerTarget = clamp(Number(model.headerPct ?? 65), 0, 100);
    const officeTarget = clamp(Number(model.officePct ?? 72), 0, 100);
    const houseTarget = clamp(Number(model.housePct ?? 64), 0, 100);
    const source = useSmooth(sourceTarget);
    const header = useSmooth(headerTarget);
    const office = useSmooth(officeTarget);
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
    const verdict = commandVerdict(model.lastCommand);
    const rungs = commandLadder(model.lastCommand);
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
    // A batch cannot start while the pump is already committed or while the site
    // battery is holding energy, and the stop only exists while it is running.
    const batchVisual = control({ disabled: operatorBusy || !energyAllowed });
    const stopVisual = control({ pending: transferStopping, disabled: !pumpOn });
    return (<div style={{ padding: 12, minHeight: "100%", color: "#E8EEF2", background: "linear-gradient(180deg,#081315,#071012 58%,#070C0D)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 850 }}>WATER MANAGEMENT</div>
          <div style={{ color: "#789095", fontSize: 11, marginTop: 2 }}>Shed rainwater catchment · pumped header reserve · gravity-fed house + office</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: moving ? "#78E6FF" : pumpOn ? "#F1C06B" : "#7C8F91", fontSize: 11, fontWeight: 800 }}>{transferStopping ? "STOPPING" : moving ? (transferMode === "automatic" ? "AUTO RECOVERY" : "BATCH TRANSFER") : pumpOn ? "PUMP ON · WAITING FLOW" : distributionActive ? "DISTRIBUTING" : "SYSTEM BALANCED"}</div>
          <div style={{ color: "#596D70", fontSize: 11, marginTop: 2 }}>{flow.toFixed(0)} L/min · totalizer {Math.round(totalizer).toLocaleString()} L</div>
        </div>
      </div>

      <WaterSchematic source={source} header={header} office={office} house={house} moving={moving} pumpOn={pumpOn} officeRefill={shedRefill} houseRefill={houseRefill} phase={phase}/>

      {transferTarget > 0 && <div style={{ marginTop: 8, padding: "7px 9px", border: "1px solid #234651", borderRadius: 8, background: "#09191E" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#718B91", marginBottom: 5 }}>
          <span>{transferMode === "automatic" ? "AUTOMATIC HEADER RECOVERY" : "OPERATOR BATCH"}</span>
          <span>{Math.min(transferTarget, transferProgress).toFixed(0)} / {transferTarget.toFixed(0)} L</span>
        </div>
        <div style={{ height: 5, borderRadius: 5, background: "#173038", overflow: "hidden" }}><div style={{ width: batchPct + "%", height: "100%", background: "#55D6F3" }}/></div>
      </div>}

      <div style={{ marginTop: 11, padding: 9, border: "1px solid #2B515C", borderRadius: 10, background: "#0A171B" }}>
        <div style={{ color: "#6E858B", fontSize: 11, fontWeight: 800, letterSpacing: 1, marginBottom: 6 }}>OPERATOR CONTROLS</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 5 }}>
          <button {...batchVisual} style={{ ...batchVisual.style, padding: "7px 4px" }} onClick={() => actions.transfer500()}>Transfer 500 L</button>
          <button {...batchVisual} style={{ ...batchVisual.style, padding: "7px 4px" }} onClick={() => actions.transfer1000()}>Transfer 1000 L</button>
          <button {...stopVisual} style={{ ...stopVisual.style, padding: "7px 4px" }} onClick={() => actions.pumpStop()}>{transferStopping ? "Stopping pump…" : "Stop transfer"}</button>
        </div>
      </div>

      {/* What the last pump command actually proved. Every rung is a durable record
          the runtime wrote, not a step this pane inferred from the outcome. */}
      {verdict && <div style={{ marginTop: 9, padding: 9, border: "1px solid #2B515C", borderRadius: 10, background: "#0A171B" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 5 }}>
          <div style={{ color: "#6E858B", fontSize: 11, fontWeight: 800, letterSpacing: 1 }}>COMMAND EVIDENCE</div>
          <div style={verdictProps(verdict)}>{verdict.headline}</div>
        </div>
        {rungs.map((rung) => { const visual = rungProps(rung); return <div key={rung.state} style={visual.style}>
          <span>{visual.mark}</span><span>{rung.label}</span>
          {rung.detail && <span style={{ color: "#607478" }}>{rung.detail}</span>}
        </div>; })}
        <div style={{ color: "#607478", fontSize: 11, marginTop: 5 }}>{verdict.clampNote || verdict.detail}</div>
      </div>}

      <div style={{ marginTop: 18, padding: 10, border: "1px dashed #6A5935", borderRadius: 10, background: "#17150D" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div><div style={{ color: "#C8AA62", fontSize: 11, fontWeight: 850, letterSpacing: 1 }}>DEMO SCENARIO</div><div style={{ color: "#766D54", fontSize: 11, marginTop: 2 }}>Inject outside conditions into the simulated property. These controls belong to the demo, not the real operator UI.</div></div>
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
