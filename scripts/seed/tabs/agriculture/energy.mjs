const logic = `automation({
  actions: [
    function siteEnergy(context) {
      var topic = String(context.topic || "");
      var evt = topic.split("/").pop();

      function setAction(label) {
        state.set("lastAction", { label: label, at: Date.now() });
      }

      if (topic.indexOf("ui/") === 0) {
        if (evt === "simulate-low-battery") {
          events.emit("farm/sim/energy-low", {});
          setAction("Simulating low site-energy reserve");
        } else if (evt === "restore-battery") {
          events.emit("farm/sim/energy-restore", {});
          setAction("Restoring site-energy reserve");
        } else if (evt === "reset-energy") {
          events.emit("farm/sim/energy-reset", {});
          setAction("Resetting energy system to nominal");
        }
        return;
      }

      if (topic !== "sensor/farm/energy/battery") return;
      var soc = Number(context.state && context.state.soc);
      var solarKw = Number(context.state && context.state.solarKw);
      var loadKw = Number(context.state && context.state.loadKw);
      var allowed = context.state && context.state.available !== false && (isNaN(soc) || soc >= 30);
      var previous = state.get("allowed");
      state.set("allowed", allowed);

      if (allowed === false && previous !== false) {
        setAction("Reserve protection active · discretionary loads constrained");
      } else if (allowed === true && previous === false) {
        setAction("Energy reserve restored · discretionary loads available");
      } else if (previous === undefined) {
        setAction("Energy telemetry online");
      }

      // This is a real domain event on the Aeolus event bus, available to other
      // automations that genuinely choose to consume it. Nothing in this Farm
      // demo reaches into another automation directly or shares its state.
      events.emit("farm/energy/permission", {
        allowed: allowed,
        soc: isNaN(soc) ? null : soc,
        solarKw: isNaN(solarKw) ? null : solarKw,
        loadKw: isNaN(loadKw) ? null : loadKw,
      });
    },
  ],
});`;

const ui = `import { useEffect, useState } from "react";
import type { CustomComponentProps } from "./types";

export default function SiteEnergy(aeolus: CustomComponentProps) {
  const battery = aeolus.devices.find((device: any) => device.topic === "sensor/farm/energy/battery") as any;
  const soc = Math.max(0, Math.min(100, Number(battery?.state?.soc ?? 78)));
  const solar = Math.max(0, Number(battery?.state?.solarKw ?? 2.8));
  const load = Math.max(0, Number(battery?.state?.loadKw ?? 1.2));
  const available = battery?.state?.available !== false && soc >= 30;
  const lastAction = aeolus.read("lastAction") as any;
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setPhase((v) => (v + 1) % 100000), 100);
    return () => clearInterval(id);
  }, []);

  const batteryHeight = Math.max(4, soc * 1.1);
  const net = solar - load;

  return (
    <div style={{ padding: 12, minHeight: "100%", background: "linear-gradient(180deg,#10120C,#0B0E0A)", color: "#EDEFE8" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 850 }}>SITE ENERGY</div>
          <div style={{ color: "#777B68", fontSize: 8, marginTop: 2 }}>Solar generation · battery reserve · load permission</div>
        </div>
        <div style={{ color: available ? "#86DF98" : "#F2A05F", fontSize: 10, fontWeight: 800 }}>{available ? "LOADS PERMITTED" : "RESERVE PROTECTION"}</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.1fr 1fr", gap: 10, alignItems: "center", border: "1px solid #363823", background: "#10120C", borderRadius: 11, padding: 12 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ color: "#777B68", fontSize: 7, letterSpacing: ".12em" }}>SOLAR</div>
          <div style={{ color: "#F2D36F", fontSize: 20, fontFamily: "monospace", fontWeight: 800, marginTop: 4 }}>{solar.toFixed(1)} kW</div>
          <div style={{ height: 4, borderRadius: 4, background: "#302B15", marginTop: 8, overflow: "hidden" }}><div style={{ width: Math.min(100, solar / 5 * 100) + "%", height: "100%", background: "#D6B94C" }} /></div>
        </div>

        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 12 }}>
          <div style={{ position: "relative", width: 54, height: 122, borderRadius: 10, border: "2px solid " + (available ? "#6FA978" : "#B66A3B"), background: "#121813", overflow: "hidden" }}>
            <div style={{ position: "absolute", left: 4, right: 4, bottom: 4, height: batteryHeight, borderRadius: 5, background: available ? "linear-gradient(180deg,#8BE79B,#3F9D60)" : "linear-gradient(180deg,#F4B06F,#B85C39)" }} />
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#F3F5EF", fontSize: 16, fontFamily: "monospace", fontWeight: 850 }}>{Math.round(soc)}%</div>
          </div>
          <div>
            <div style={{ color: net >= 0 ? "#80D692" : "#E6A164", fontSize: 9, fontWeight: 750 }}>{net >= 0 ? "+" : ""}{net.toFixed(1)} kW net</div>
            <div style={{ color: "#667064", fontSize: 7, marginTop: 4 }}>Local energy guard publishes<br/>permission over Aeolus events</div>
            <div style={{ display: "flex", gap: 3, marginTop: 9 }}>
              {Array.from({ length: 6 }).map((_, i) => <span key={i} style={{ width: 6, height: 6, borderRadius: 999, background: ((phase + i * 5) % 18) < 7 ? "#D6C85A" : "#303225" }} />)}
            </div>
          </div>
        </div>

        <div style={{ textAlign: "center" }}>
          <div style={{ color: "#777B68", fontSize: 7, letterSpacing: ".12em" }}>SITE LOAD</div>
          <div style={{ color: "#D9E0D6", fontSize: 20, fontFamily: "monospace", fontWeight: 800, marginTop: 4 }}>{load.toFixed(1)} kW</div>
          <div style={{ height: 4, borderRadius: 4, background: "#252A25", marginTop: 8, overflow: "hidden" }}><div style={{ width: Math.min(100, load / 5 * 100) + "%", height: "100%", background: "#76887A" }} /></div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 7, marginTop: 8 }}>
        <button onClick={() => aeolus.fire(available ? "simulate-low-battery" : "restore-battery")} style={{ flex: 1, borderRadius: 8, padding: "8px", border: "1px solid " + (available ? "#6C4A2F" : "#315B3C"), background: available ? "#25180F" : "#102319", color: available ? "#E5A268" : "#83D99A", fontSize: 9, fontWeight: 750, cursor: "pointer" }}>{available ? "Simulate low reserve" : "Restore reserve"}</button>
        <button onClick={() => aeolus.fire("reset-energy")} style={{ borderRadius: 8, padding: "8px 12px", border: "1px solid #353A32", background: "#161A15", color: "#879083", fontSize: 9, cursor: "pointer" }}>Reset</button>
      </div>
      <div style={{ color: "#6D756A", fontSize: 8, marginTop: 7 }}>{lastAction?.label ? String(lastAction.label) : "Energy telemetry online"}</div>
    </div>
  );
}`;

export const energyAutomation = {
  key: "farm-energy",
  name: "Site Energy",
  triggerTopic: "sensor/farm/energy/#",
  scriptSource: logic,
  uiSource: ui,
  demoAccess: {
    fireEvents: ["simulate-low-battery", "restore-battery", "reset-energy"],
  },
};
