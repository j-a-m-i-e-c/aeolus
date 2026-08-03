// scripts/seed/tabs/wildlife.mjs — Conservation waterhole camera (simulated).
// Flagship: a motion-activated wildlife camera. The visitor arms/disarms it and
// toggles night IR (real MQTT publish to the camera device), and confirms
// sightings which the engine tallies + records to the Data Store.

const tab = { id: "tab-wildlife", name: "Wildlife", icon: "bird" };

const devices = [
  { topic: "sensor/reserve/camera", payload: { armed: false, night: false } },
  { topic: "sensor/reserve/waterhole", payload: { value: 64 } },
];

const logic = `automation({
  actions: [
    function camera(context) {
      var evt = String(context.topic || "").split("/").pop();
      var publishCam = function () {
        mqtt.publish("sensor/reserve/camera", JSON.stringify({ armed: !!state.get("armed"), night: !!state.get("night") }));
      };
      if (evt === "arm") { state.set("armed", true); publishCam(); log.info("Waterhole camera armed"); }
      else if (evt === "disarm") { state.set("armed", false); publishCam(); log.info("Waterhole camera disarmed"); }
      else if (evt === "night") { state.set("night", !state.get("night")); publishCam(); }
      else if (evt === "log-sighting") {
        var sp = String((context.state && context.state.species) || "unknown");
        var tally = state.get("tally") || {};
        tally[sp] = (Number(tally[sp]) || 0) + 1;
        state.set("tally", tally);
        state.set("lastSighting", { species: sp, at: Date.now() });
        log.info("Sighting logged: " + sp);
        if (db) db.write("sightings", { species: sp });
      }
    },
  ],
});`;

const ui = `import type { CustomComponentProps } from "./types";

const SPECIES = [
  { name: "Elephant", emoji: "🐘" },
  { name: "Zebra", emoji: "🦓" },
  { name: "Giraffe", emoji: "🦒" },
  { name: "Lion", emoji: "🦁" },
];

export default function WaterholeCamera(aeolus: CustomComponentProps) {
  const armed = Boolean(aeolus.read("armed"));
  const night = Boolean(aeolus.read("night"));
  const tally = (aeolus.read("tally") as Record<string, number>) ?? {};
  const last = aeolus.read("lastSighting") as any;
  const total = Object.values(tally).reduce((a, b) => a + Number(b), 0);

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">📷 Waterhole Camera</div>
        <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: armed ? "#22C55E20" : "#6B778520", color: armed ? "#22C55E" : "#9AA6B2" }}>{armed ? "● Armed" : "Disarmed"}</span>
      </div>

      <div className="rounded-xl border border-[#2A3441] overflow-hidden" style={{ background: night ? "#0A140A" : "#0B0F14" }}>
        <div className="aspect-[16/9] relative flex items-center justify-center" style={{ filter: night ? "sepia(1) hue-rotate(60deg) brightness(0.8)" : "none" }}>
          <div className="text-5xl opacity-80">{last ? (SPECIES.find((s) => s.name === last.species)?.emoji ?? "🐾") : "🌅"}</div>
          <div className="absolute top-1.5 left-2 text-[8px] font-mono" style={{ color: armed ? "#EF4444" : "#6B7785" }}>{armed ? "● REC" : "○ STANDBY"}</div>
          <div className="absolute top-1.5 right-2 text-[8px] font-mono text-[#9AA6B2]">{night ? "IR NIGHT" : "DAY"}</div>
          <div className="absolute bottom-1.5 left-2 text-[8px] font-mono text-[#9AA6B2]">{last ? "Last: " + last.species : "No sightings yet"}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <button onClick={() => aeolus.fire(armed ? "disarm" : "arm")} className="py-1.5 rounded-md text-[10px] font-medium border transition-all" style={{ background: armed ? "#EF444415" : "#22C55E15", color: armed ? "#EF4444" : "#22C55E", borderColor: armed ? "#EF44444D" : "#22C55E4D" }}>{armed ? "■ Disarm" : "▶ Arm"}</button>
        <button onClick={() => aeolus.fire("night")} className="py-1.5 rounded-md text-[10px] font-medium border transition-all" style={{ background: night ? "#3BA4FF20" : "#0B0F14", color: night ? "#3BA4FF" : "#9AA6B2", borderColor: night ? "#3BA4FF4D" : "#2A3441" }}>🌙 Night IR {night ? "On" : "Off"}</button>
      </div>

      <div>
        <div className="text-[10px] font-semibold text-[#9AA6B2] mb-1.5">Confirm a sighting</div>
        <div className="grid grid-cols-4 gap-1.5">
          {SPECIES.map((s) => (
            <button key={s.name} onClick={() => aeolus.fire("log-sighting", { species: s.name })} className="py-2 rounded-lg bg-[#0B0F14] border border-[#2A3441] hover:border-[#3BA4FF]/40 transition-all flex flex-col items-center gap-0.5">
              <span className="text-lg">{s.emoji}</span>
              <span className="text-[8px] text-[#9AA6B2]">{s.name}</span>
              <span className="text-[9px] font-mono font-bold text-[#3BA4FF]">{tally[s.name] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="text-[8px] text-[#6B7785] text-center">{total} sightings recorded to the Data Store this session · camera state published over MQTT</div>
    </div>
  );
}`;

const automations = [
  {
    key: "camera",
    name: "Waterhole Camera",
    triggerTopic: "none",
    scriptSource: logic,
    uiSource: ui,
    demoAccess: { fireEvents: ["arm", "disarm", "night", "log-sighting"] },
  },
];

const panes = [
  { kind: "automation", ref: "camera", x: 0, y: 0, w: 12, h: 15 },
  { kind: "device-grid", x: 0, y: 15, w: 12, h: 6 },
];

const dataStore = [];

export default { tab, devices, automations, panes, dataStore };
