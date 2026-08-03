// scripts/seed/tabs/stage-show.mjs — Live stage lighting & FX console (simulated).
// Flagship: a show-control desk. The visitor sets the master intensity (bounded
// save), arms the effects interlock, and fires fog/strobe (engine gates FX behind
// the interlock, drives the hazer over MQTT, records cues); the UI is a light bar.

const tab = { id: "tab-stage-show", name: "Stage & Show", icon: "sparkles" };

const devices = [
  { topic: "switch/stage/hazer", payload: { on: false } },
  { topic: "sensor/stage/dmx", payload: { master: 0 } },
];

const logic = `automation({
  actions: [
    function showcontrol(context) {
      var evt = String(context.topic || "").split("/").pop();
      if (evt === "arm") { state.set("armed", true); log.info("FX armed"); }
      else if (evt === "disarm") { state.set("armed", false); log.info("FX disarmed"); }
      else if (evt === "fog") {
        if (!state.get("armed")) { log.warn("Fog blocked — FX disarmed"); return; }
        state.set("lastFx", { fx: "fog", at: Date.now() });
        mqtt.publish("switch/stage/hazer", JSON.stringify({ on: true }));
        log.info("Fog burst fired");
        if (db) db.write("show-cues", { fx: "fog" });
      } else if (evt === "strobe") {
        if (!state.get("armed")) { log.warn("Strobe blocked — FX disarmed"); return; }
        state.set("lastFx", { fx: "strobe", at: Date.now() });
        log.info("Strobe fired");
        if (db) db.write("show-cues", { fx: "strobe" });
      }
    },
  ],
});`;

const ui = `import { useState, useEffect } from "react";
import type { CustomComponentProps } from "./types";

export default function ShowControl(aeolus: CustomComponentProps) {
  const armed = Boolean(aeolus.read("armed"));
  const lastFx = aeolus.read("lastFx") as any;
  const [master, setMaster] = useState<number>(() => Number(aeolus.read("master") ?? 60));
  const [flash, setFlash] = useState(false);

  // Visual flash when a strobe cue lands.
  useEffect(() => {
    if (lastFx && lastFx.fx === "strobe") {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 400);
      return () => clearTimeout(t);
    }
  }, [lastFx]);

  const m = master / 100;
  const lampColors = ["#EF4444", "#F59E0B", "#3BA4FF", "#22C55E", "#A855F7", "#5CE1E6"];

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🎭 Show Control</div>
        <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: armed ? "#EF444420" : "#6B778520", color: armed ? "#EF4444" : "#9AA6B2" }}>{armed ? "● FX armed" : "FX safe"}</span>
      </div>

      <div className="rounded-xl border border-[#2A3441] p-4 flex justify-around items-end" style={{ background: flash ? "#E6EDF3" : "#070A0E", transition: "background 60ms" }}>
        {lampColors.map((c, i) => (
          <div key={i} className="flex flex-col items-center gap-1">
            <div style={{ width: 26, height: 26, borderRadius: "50%", background: c, opacity: 0.25 + m * 0.75, boxShadow: "0 0 " + Math.round(m * 20) + "px " + c }} className="transition-all duration-200" />
            <div style={{ width: 2, height: 14, background: "#2A3441" }} />
          </div>
        ))}
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-[#9AA6B2]">Master intensity</span>
          <span className="text-[10px] font-mono text-[#E6EDF3]">{master}%</span>
        </div>
        <input
          type="range" min={0} max={100} value={master}
          onChange={(e) => setMaster(Number(e.target.value))}
          onMouseUp={(e) => aeolus.save("master", Number((e.target as HTMLInputElement).value))}
          onTouchEnd={(e) => aeolus.save("master", Number((e.target as HTMLInputElement).value))}
          className="w-full accent-[#A855F7] h-1"
        />
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <button onClick={() => aeolus.fire(armed ? "disarm" : "arm")} className="py-2 rounded-md text-[11px] font-medium border transition-all" style={{ background: armed ? "#EF444415" : "#22C55E15", color: armed ? "#EF4444" : "#22C55E", borderColor: armed ? "#EF44444D" : "#22C55E4D" }}>{armed ? "🔓 Disarm FX" : "🔒 Arm FX"}</button>
        <button onClick={() => aeolus.fire("fog")} disabled={!armed} className="py-2 rounded-md text-[11px] font-medium border transition-all disabled:opacity-40 bg-[#3BA4FF]/15 text-[#3BA4FF] border-[#3BA4FF]/30">💨 Fog</button>
        <button onClick={() => aeolus.fire("strobe")} disabled={!armed} className="py-2 rounded-md text-[11px] font-medium border transition-all disabled:opacity-40 bg-[#A855F7]/15 text-[#A855F7] border-[#A855F7]/30">⚡ Strobe</button>
      </div>
      <div className="text-[8px] text-[#6B7785] text-center">Effects are gated by the engine's arm interlock · hazer driven over MQTT</div>
    </div>
  );
}`;

const automations = [
  {
    key: "show",
    name: "Show Control",
    triggerTopic: "none",
    scriptSource: logic,
    uiSource: ui,
    demoAccess: { writableStateKeys: ["master"], fireEvents: ["arm", "disarm", "fog", "strobe"] },
  },
];

const panes = [
  { kind: "automation", ref: "show", x: 0, y: 0, w: 12, h: 14 },
  { kind: "device-grid", x: 0, y: 14, w: 12, h: 6 },
];

const dataStore = [];

export default { tab, devices, automations, panes, dataStore };
