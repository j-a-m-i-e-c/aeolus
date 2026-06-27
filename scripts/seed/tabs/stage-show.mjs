// scripts/seed/tabs/stage-show.mjs — Live stage / show control over DMX.
//
// Theatre/concert production: a digital lighting board, a cue stack, atmospherics
// (haze/fog/CO₂), and safety-interlocked effects/pyro. DMX-native — a Pi running
// Open Lighting Architecture (OLA) can drive Art-Net/sACN → DMX directly.

import { genSeries } from "../lib.mjs";

const tab = { id: "tab-stage", name: "Stage & Show Control", icon: "drama" };

const devices = [
  { topic: "fx/stage/hazer", payload: { on: true, density: 40, fluid: 65 } },
  { topic: "fx/stage/fogger", payload: { on: false, fluid: 80 } },
  { topic: "fx/stage/co2", payload: { on: false, pressure: 90 } },
];

// ─── Lighting Board ⭐ — operator console (manual; UI writes via aeolus.save) ──
const boardLogic = `automation({
  conditions: [
    function ready(context) {
      return true;
    },
  ],
  actions: [
    function board(context) {
      // Operator-driven console — fader/toggle state is written directly from
      // the UI via aeolus.save(). Nothing to compute on trigger.
      state.set("lastUpdate", Date.now());
    },
  ],
});`;

const boardUi = `import { useState, useEffect } from "react";
import type { CustomComponentProps } from "./types";

export default function LightingBoard(aeolus: CustomComponentProps) {
  const fixtures = [
    { key: "front-wash", label: "Front Wash", color: "#FF6B00", cx: 78, ry: 42, def: 80 },
    { key: "moving-head-1", label: "Moving Head 1", color: "#A855F7", cx: 150, ry: 28, def: 100 },
    { key: "moving-head-2", label: "Moving Head 2", color: "#22C55E", cx: 250, ry: 28, def: 90 },
    { key: "back-wash", label: "Back Wash", color: "#3BA4FF", cx: 322, ry: 42, def: 60 },
  ];

  // Operator console — fader/toggle state lives in React state for instant
  // response and is persisted via aeolus.save(). Seeded from the state store.
  const seed: Record<string, number> = {};
  fixtures.forEach((f) => { seed[f.key] = (aeolus.read(f.key + "_level") as number) ?? f.def; });
  const [levels, setLevels] = useState<Record<string, number>>(seed);
  const [master, setMaster] = useState<number>((aeolus.read("master") as number) ?? 75);
  const [spot, setSpot] = useState<number>((aeolus.read("spot") as number) ?? 90);
  const [tracking, setTracking] = useState<boolean>((aeolus.read("tracking") as boolean) ?? true);
  const [strobeL, setStrobeL] = useState<boolean>((aeolus.read("strobeL") as boolean) ?? false);
  const [strobeR, setStrobeR] = useState<boolean>((aeolus.read("strobeR") as boolean) ?? false);
  const [pos, setPos] = useState<number>(0.5);

  // Follow-spot tracking — sweep the spot across the stage while enabled.
  useEffect(() => {
    if (!tracking) return;
    const start = Date.now();
    let timer: any;
    const tick = () => {
      setPos(0.5 + 0.42 * Math.sin(((Date.now() - start) / 1000) * 0.9));
      timer = setTimeout(tick, 60);
    };
    tick();
    return () => clearTimeout(timer);
  }, [tracking]);

  const m = master / 100;
  const setLevel = (key: string, v: number) => { setLevels((prev) => ({ ...prev, [key]: v })); aeolus.save(key + "_level", v); };
  const setMasterLevel = (v: number) => { setMaster(v); aeolus.save("master", v); };
  const setSpotLevel = (v: number) => { setSpot(v); aeolus.save("spot", v); };
  const toggle = (key: string, v: boolean, setter: (b: boolean) => void) => { setter(v); aeolus.save(key, v); };
  const spotX = 40 + (tracking ? pos : 0.5) * 320;
  const spotOp = (spot / 100) * m;

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🎭 Lighting Board</div>
        <span className="text-[9px] text-[#6B7785]">DMX · {fixtures.length} fixtures</span>
      </div>

      {/* Stage preview — driven live by the faders */}
      <div className="bg-[#070A0E] rounded-xl border border-[#2A3441] p-2">
        <svg width="100%" height="210" viewBox="0 0 400 210" preserveAspectRatio="xMidYMid meet">
          <rect x="0" y="0" width="400" height="210" rx="6" fill="#05070A" />
          <rect x="10" y="8" width="380" height="6" rx="2" fill="#1A2330" stroke="#2A3441" strokeWidth="0.5" />

          {fixtures.map((f) => {
            const level = levels[f.key] ?? 0;
            const op = (level / 100) * m;
            return (
              <g key={f.key}>
                <polygon points={f.cx + ",16 " + (f.cx - f.ry) + ",176 " + (f.cx + f.ry) + ",176"} fill={f.color} opacity={op * 0.32} />
                <ellipse cx={f.cx} cy="178" rx={f.ry} ry="11" fill={f.color} opacity={op * 0.5} />
                <circle cx={f.cx} cy="11" r="4" fill={f.color} opacity={0.25 + (level / 100) * 0.75} />
              </g>
            );
          })}

          {/* centre follow-spot */}
          <polygon points={"200,16 " + (spotX - 24) + ",176 " + (spotX + 24) + ",176"} fill="#FFFCEA" opacity={spotOp * 0.4} />
          <ellipse cx={spotX} cy="178" rx="26" ry="10" fill="#FFFCEA" opacity={spotOp * 0.6} />
          <circle cx="200" cy="11" r="4.5" fill="#FFFCEA" opacity={0.3 + (spot / 100) * 0.7} />
          <circle cx={spotX} cy="174" r="5" fill="#0B0F14" stroke="#E6EDF3" strokeWidth="1" />
          {tracking && <text x={spotX} y="196" textAnchor="middle" fill="#5CE1E6" fontSize="7">● tracking</text>}

          {/* strobes */}
          {strobeL && <rect x="6" y="44" width="14" height="120" rx="3" fill="#FFFFFF" opacity="0.85" className="animate-pulse" />}
          {strobeR && <rect x="380" y="44" width="14" height="120" rx="3" fill="#FFFFFF" opacity="0.85" className="animate-pulse" />}

          <rect x="10" y="184" width="380" height="16" rx="2" fill="#121821" stroke="#2A3441" strokeWidth="0.5" />
        </svg>
      </div>

      {/* Fader bank — interactive */}
      <div className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-3 space-y-2">
        {fixtures.map((f) => (
          <div key={f.key} className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: f.color }} />
            <span className="text-[9px] text-[#9AA6B2] w-24 shrink-0">{f.label}</span>
            <input
              type="range" min={0} max={100} value={levels[f.key] ?? 0}
              onChange={(e) => setLevel(f.key, Number(e.target.value))}
              className="flex-1 h-1.5 cursor-pointer" style={{ accentColor: f.color }}
            />
            <span className="text-[9px] font-mono w-8 text-right" style={{ color: f.color }}>{levels[f.key] ?? 0}</span>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: "#FFFCEA" }} />
          <span className="text-[9px] text-[#9AA6B2] w-24 shrink-0">Centre Spot</span>
          <input
            type="range" min={0} max={100} value={spot}
            onChange={(e) => setSpotLevel(Number(e.target.value))}
            className="flex-1 h-1.5 cursor-pointer" style={{ accentColor: "#FFFCEA" }}
          />
          <span className="text-[9px] font-mono w-8 text-right text-[#E6EDF3]">{spot}</span>
        </div>
        <div className="flex items-center gap-2 pt-2 border-t border-[#2A3441]">
          <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: "#5CE1E6" }} />
          <span className="text-[9px] font-semibold text-[#5CE1E6] w-24 shrink-0">MASTER</span>
          <input
            type="range" min={0} max={100} value={master}
            onChange={(e) => setMasterLevel(Number(e.target.value))}
            className="flex-1 h-1.5 cursor-pointer" style={{ accentColor: "#5CE1E6" }}
          />
          <span className="text-[9px] font-mono w-8 text-right text-[#5CE1E6]">{master}</span>
        </div>
      </div>

      {/* Follow-spot tracking + strobes */}
      <div className="grid grid-cols-3 gap-2">
        <button onClick={() => toggle("tracking", !tracking, setTracking)} className="py-2 rounded-lg text-[10px] font-medium border transition-all" style={{ background: tracking ? "#5CE1E620" : "#0B0F14", color: tracking ? "#5CE1E6" : "#6B7785", borderColor: tracking ? "#5CE1E64D" : "#2A3441" }}>
          🎯 Track {tracking ? "On" : "Off"}
        </button>
        <button onClick={() => toggle("strobeL", !strobeL, setStrobeL)} className="py-2 rounded-lg text-[10px] font-medium border transition-all" style={{ background: strobeL ? "#E6EDF320" : "#0B0F14", color: strobeL ? "#E6EDF3" : "#6B7785", borderColor: strobeL ? "#E6EDF34D" : "#2A3441" }}>
          ⚡ Strobe L
        </button>
        <button onClick={() => toggle("strobeR", !strobeR, setStrobeR)} className="py-2 rounded-lg text-[10px] font-medium border transition-all" style={{ background: strobeR ? "#E6EDF320" : "#0B0F14", color: strobeR ? "#E6EDF3" : "#6B7785", borderColor: strobeR ? "#E6EDF34D" : "#2A3441" }}>
          ⚡ Strobe R
        </button>
      </div>
    </div>
  );
}`;

// ─── Cue Stack — sequenced show control (GO / BACK) ──────────────────────────
const cueLogic = `automation({
  conditions: [
    function ready(context) {
      return true;
    },
  ],
  actions: [
    function cue(context) {
      var cues = ["Preset", "Act 1 — Open", "Ballad Wash", "Act 2 — Storm", "Strobe Hit", "Lightning", "Blackout", "Act 3 — Dawn", "Crowd Wash", "Encore", "Finale", "Bows"];
      var s = context.state || {}, t = context.topic || "";
      if (s.current !== undefined) state.set("idx", s.current);

      var idx = state.get("idx");
      if (idx === undefined) idx = 3;
      if (t.indexOf("go") >= 0) idx = Math.min(cues.length - 1, idx + 1);
      else if (t.indexOf("back") >= 0) idx = Math.max(0, idx - 1);

      state.set("idx", idx);
      state.set("cueName", cues[idx]);
      state.set("total", cues.length);
      state.set("nextName", cues[idx + 1] || "— end —");
      state.set("lastUpdate", Date.now());
      if (t.indexOf("go") >= 0) log.info("GO → cue " + (idx + 1) + ": " + cues[idx]);
    },
  ],
});`;

const cueUi = `import type { CustomComponentProps } from "./types";

export default function CueStack(aeolus: CustomComponentProps) {
  const cues = ["Preset", "Act 1 — Open", "Ballad Wash", "Act 2 — Storm", "Strobe Hit", "Lightning", "Blackout", "Act 3 — Dawn", "Crowd Wash", "Encore", "Finale", "Bows"];
  const idx = aeolus.read("idx") as number ?? 3;
  const total = aeolus.read("total") as number ?? cues.length;

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🎬 Cue Stack</div>
        <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold bg-[#22C55E]/15 text-[#22C55E] animate-pulse">● LIVE</span>
      </div>

      {/* Cue list */}
      <div className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-1.5 max-h-40 overflow-auto">
        {cues.map((c, i) => {
          const isCurrent = i === idx;
          const isNext = i === idx + 1;
          return (
            <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded-md" style={{ background: isCurrent ? "#22C55E20" : isNext ? "#3BA4FF10" : "transparent" }}>
              <span className="text-[9px] font-mono w-5" style={{ color: isCurrent ? "#22C55E" : "#6B7785" }}>{i + 1}</span>
              <span className="text-[10px] flex-1" style={{ color: isCurrent ? "#E6EDF3" : isNext ? "#9AA6B2" : "#6B7785" }}>{c}</span>
              {isCurrent && <span className="text-[7px] text-[#22C55E] font-semibold">LIVE</span>}
              {isNext && <span className="text-[7px] text-[#3BA4FF]">NEXT</span>}
            </div>
          );
        })}
      </div>

      {/* Transport */}
      <div className="grid grid-cols-3 gap-2">
        <button onClick={() => aeolus.fire("back", {})} className="py-2.5 rounded-lg text-[11px] font-medium bg-[#0B0F14] text-[#9AA6B2] border border-[#2A3441] hover:text-[#E6EDF3] transition-all">◀ Back</button>
        <button onClick={() => aeolus.fire("go", {})} className="col-span-2 py-2.5 rounded-lg text-sm font-bold bg-[#22C55E]/20 text-[#22C55E] border border-[#22C55E]/40 hover:bg-[#22C55E]/30 transition-all">GO ▶</button>
      </div>
      <div className="text-center text-[9px] text-[#6B7785]">Cue {idx + 1} of {total}</div>
    </div>
  );
}`;

// ─── Atmospherics — haze / fog / CO₂ ─────────────────────────────────────────
const atmosLogic = `automation({
  conditions: [
    function has(context) {
      return context.state !== undefined;
    },
  ],
  actions: [
    function atmos(context) {
      var s = context.state, t = context.topic || "";
      if (t.indexOf("hazer") >= 0) { state.set("hazeOn", s.on); state.set("density", s.density); state.set("hazeFluid", s.fluid); }
      else if (t.indexOf("fogger") >= 0) { state.set("fogFluid", s.fluid); }
      else if (t.indexOf("co2") >= 0) { state.set("co2Pressure", s.pressure); }

      if (t.indexOf("fog-blast") >= 0) { state.set("fogActive", true); state.set("fogAt", Date.now()); mqtt.publish("fx/stage/fogger/command", JSON.stringify({ blast: true })); log.info("Fog blast"); }
      if (t.indexOf("co2-blast") >= 0) { state.set("co2Active", true); mqtt.publish("fx/stage/co2/command", JSON.stringify({ blast: true })); log.info("CO2 jet"); }
      if (t.indexOf("haze") >= 0 && s.density !== undefined) { state.set("density", s.density); mqtt.publish("fx/stage/hazer/command", JSON.stringify({ density: s.density })); }
      state.set("lastUpdate", Date.now());
    },
  ],
});`;

const atmosUi = `import type { CustomComponentProps } from "./types";

export default function Atmospherics(aeolus: CustomComponentProps) {
  const density = aeolus.read("density") as number ?? 40;
  const hazeFluid = aeolus.read("hazeFluid") as number ?? 65;
  const fogFluid = aeolus.read("fogFluid") as number ?? 80;
  const co2Pressure = aeolus.read("co2Pressure") as number ?? 90;

  const tank = (label: string, val: number, unit: string, color: string) => (
    <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[9px] text-[#9AA6B2]">{label}</span>
        <span className="text-[9px] font-mono font-bold" style={{ color: val < 25 ? "#EF4444" : color }}>{val}{unit}</span>
      </div>
      <div className="h-1.5 bg-[#1A2330] rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: val + "%", background: val < 25 ? "#EF4444" : color }} />
      </div>
    </div>
  );

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🌫️ Atmospherics</div>
        <span className="text-[9px] text-[#6B7785]">haze {density}%</span>
      </div>

      {/* Haze density visual */}
      <div className="rounded-xl border border-[#2A3441] p-3 relative overflow-hidden" style={{ background: "#0B0F14" }}>
        <div className="absolute inset-0" style={{ background: "#9AA6B2", opacity: density / 250 }} />
        <div className="relative text-center">
          <div className="text-2xl font-mono font-bold text-[#E6EDF3]">{density}%</div>
          <div className="text-[8px] text-[#6B7785]">haze density</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        {tank("Haze Fluid", hazeFluid, "%", "#5CE1E6")}
        {tank("Fog Fluid", fogFluid, "%", "#3BA4FF")}
        {tank("CO₂", co2Pressure, "%", "#A855F7")}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => aeolus.fire("fog-blast", {})} className="py-2 rounded-lg text-[11px] font-medium bg-[#3BA4FF]/15 text-[#3BA4FF] border border-[#3BA4FF]/30 hover:bg-[#3BA4FF]/25 transition-all">💨 Fog Blast</button>
        <button onClick={() => aeolus.fire("co2-blast", {})} className="py-2 rounded-lg text-[11px] font-medium bg-[#A855F7]/15 text-[#A855F7] border border-[#A855F7]/30 hover:bg-[#A855F7]/25 transition-all">❄️ CO₂ Jet</button>
      </div>
    </div>
  );
}`;

// ─── Effects & Pyro — armed-interlock theatrical effects ─────────────────────
const pyroLogic = `automation({
  conditions: [
    function ready(context) {
      return true;
    },
  ],
  actions: [
    function pyro(context) {
      var s = context.state || {}, t = context.topic || "";
      if (s.armed !== undefined) state.set("armed", s.armed);

      if (t.indexOf("arm-toggle") >= 0) {
        var armed = !state.get("armed");
        state.set("armed", armed);
        mqtt.publish("pyro/stage/main/command", JSON.stringify({ armed: armed }));
        log.warn(armed ? "PYRO ARMED — effects live" : "Pyro DISARMED — effects locked");
      }

      // Effects only fire when armed (safety interlock).
      if (t.indexOf("fire-") >= 0) {
        if (!state.get("armed")) {
          log.warn("Effect blocked — system DISARMED");
        } else {
          var effect = t.split("fire-")[1] || "effect";
          state.set("lastFired", effect);
          state.set("lastFiredAt", Date.now());
          mqtt.publish("pyro/stage/main/command", JSON.stringify({ fire: effect }));
          log.info("FIRED: " + effect);
        }
      }
      state.set("lastUpdate", Date.now());
    },
  ],
});`;

const pyroUi = `import type { CustomComponentProps } from "./types";

export default function EffectsPyro(aeolus: CustomComponentProps) {
  const armed = aeolus.read("armed") as boolean ?? false;
  const lastFired = aeolus.read("lastFired") as string || "";

  const effects = [
    { key: "flame", label: "🔥 Flame", color: "#EF4444" },
    { key: "sparks", label: "✨ Sparks", color: "#F59E0B" },
    { key: "confetti", label: "🎊 Confetti", color: "#A855F7" },
    { key: "streamers", label: "🎉 Streamers", color: "#22C55E" },
  ];

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🎆 Effects & Pyro</div>
        <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: armed ? "#EF444420" : "#6B778520", color: armed ? "#EF4444" : "#9AA6B2" }}>
          {armed ? "● ARMED" : "🔒 DISARMED"}
        </span>
      </div>

      {/* Arm key-switch */}
      <button
        onClick={() => aeolus.fire("arm-toggle", {})}
        className="w-full py-3 rounded-xl text-sm font-bold border-2 transition-all"
        style={{ background: armed ? "#EF444420" : "#0B0F14", color: armed ? "#EF4444" : "#9AA6B2", borderColor: armed ? "#EF4444" : "#2A3441" }}
      >
        {armed ? "🔓 ARMED — tap to disarm" : "🔒 DISARMED — tap to arm"}
      </button>

      {/* Effect buttons (locked unless armed) */}
      <div className="grid grid-cols-2 gap-2">
        {effects.map((e) => (
          <button
            key={e.key}
            disabled={!armed}
            onClick={() => aeolus.fire("fire-" + e.key, {})}
            className="py-2.5 rounded-lg text-[11px] font-medium border transition-all"
            style={{
              background: armed ? e.color + "15" : "#0B0F14",
              color: armed ? e.color : "#3A4452",
              borderColor: armed ? e.color + "4D" : "#1A2330",
              cursor: armed ? "pointer" : "not-allowed",
            }}
          >
            {e.label}
          </button>
        ))}
      </div>

      <div className="text-center text-[9px] text-[#6B7785]">
        {lastFired ? "Last fired: " + lastFired : "Safety interlock active — arm to enable"}
      </div>
    </div>
  );
}`;

// ─── Assembly ────────────────────────────────────────────────────────────────
const automations = [
  { key: "board", name: "Lighting Board", triggerTopic: "none", scriptSource: boardLogic, uiSource: boardUi },
  { key: "cue", name: "Cue Stack", triggerTopic: "none", scriptSource: cueLogic, uiSource: cueUi },
  { key: "atmos", name: "Atmospherics", triggerTopic: "fx/stage/+", scriptSource: atmosLogic, uiSource: atmosUi },
  { key: "pyro", name: "Effects & Pyro", triggerTopic: "none", scriptSource: pyroLogic, uiSource: pyroUi },
];

const panes = [
  { kind: "automation", ref: "board", x: 0, y: 0, w: 6, h: 16 },
  { kind: "automation", ref: "cue", x: 6, y: 0, w: 6, h: 11 },
  { kind: "automation", ref: "atmos", x: 0, y: 16, w: 6, h: 10 },
  { kind: "automation", ref: "pyro", x: 6, y: 11, w: 6, h: 10 },
];

const dataStore = [
  {
    name: "show-log",
    description: "Cue + effect fire events for the session",
    retentionDays: 90,
    records: genSeries({
      count: 30,
      intervalMs: 4 * 60_000,
      fields: {
        cue: (i) => (i % 12),
        effect: () => Math.floor(Math.random() * 4),
      },
    }),
  },
];

export default { tab, devices, automations, panes, dataStore };
