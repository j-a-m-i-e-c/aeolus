// scripts/seed/tabs/stage-show.mjs — Live stage / show control over DMX.
//
// Theatre/concert production: a digital lighting board, a cue stack, atmospherics
// (haze/fog/CO₂), and safety-interlocked effects/pyro. DMX-native — a Pi running
// Open Lighting Architecture (OLA) can drive Art-Net/sACN → DMX directly.

import { genSeries } from "../lib.mjs";

const tab = { id: "tab-stage", name: "Stage & Show Control", icon: "drama" };

const devices = [
  { topic: "light/stage/front-wash", payload: { level: 80, color: "#FF6B00" } },
  { topic: "light/stage/back-wash", payload: { level: 60, color: "#3BA4FF" } },
  { topic: "light/stage/moving-head-1", payload: { level: 100, pan: 120, tilt: 45, color: "#A855F7" } },
  { topic: "light/stage/moving-head-2", payload: { level: 90, pan: 200, tilt: 60, color: "#22C55E" } },
  { topic: "light/stage/master", payload: { level: 75 } },
  { topic: "fx/stage/hazer", payload: { on: true, density: 40, fluid: 65 } },
  { topic: "fx/stage/fogger", payload: { on: false, fluid: 80 } },
  { topic: "fx/stage/co2", payload: { on: false, pressure: 90 } },
  { topic: "pyro/stage/main", payload: { armed: false, cuesLoaded: 4 } },
  { topic: "show/stage/cue", payload: { current: 3, total: 12, name: "Act 2 — Storm" } },
];

// ─── Lighting Board ⭐ — DMX fixtures scaled by master fader ──────────────────
const boardLogic = `automation({
  conditions: [
    function has(context) {
      return context.state !== undefined;
    },
  ],
  actions: [
    function board(context) {
      var s = context.state, t = context.topic || "";
      var fx = t.split("light/stage/")[1] || "";
      if (fx === "master") {
        state.set("master", s.level);
      } else if (fx) {
        state.set(fx + "_level", s.level);
        if (s.color) state.set(fx + "_color", s.color);
        if (s.pan !== undefined) state.set(fx + "_pan", s.pan);
        if (s.tilt !== undefined) state.set(fx + "_tilt", s.tilt);
      }
      state.set("lastUpdate", Date.now());
    },
  ],
});`;

const boardUi = `import type { CustomComponentProps } from "./types";

export default function LightingBoard(aeolus: CustomComponentProps) {
  const master = aeolus.read("master") as number ?? 75;
  const fixtures = [
    { key: "front-wash", label: "Front", color: "#FF6B00", beam: { cx: 70, ry: 26 } },
    { key: "moving-head-1", label: "MH1", color: "#A855F7", beam: { cx: 130, ry: 18 } },
    { key: "moving-head-2", label: "MH2", color: "#22C55E", beam: { cx: 190, ry: 18 } },
    { key: "back-wash", label: "Back", color: "#3BA4FF", beam: { cx: 250, ry: 26 } },
  ];
  const lvl = (k: string, d: number) => (aeolus.read(k + "_level") as number ?? d);
  const col = (k: string, d: string) => (aeolus.read(k + "_color") as string || d);
  const m = master / 100;

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🎭 Lighting Board</div>
        <span className="text-[9px] text-[#6B7785]">DMX · {fixtures.length} fixtures</span>
      </div>

      {/* Stage preview */}
      <div className="bg-[#070A0E] rounded-xl border border-[#2A3441] p-2">
        <svg width="100%" height="120" viewBox="0 0 320 120" preserveAspectRatio="xMidYMid meet">
          <rect x="0" y="0" width="320" height="120" rx="6" fill="#05070A" />
          {/* beam pools */}
          {fixtures.map((f) => {
            const level = lvl(f.key, 80);
            const c = col(f.key, f.color);
            const op = (level / 100) * m * 0.55;
            return (
              <g key={f.key}>
                <ellipse cx={f.beam.cx} cy="92" rx={f.beam.ry + 10} ry="16" fill={c} opacity={op} />
                <polygon points={f.beam.cx + ",10 " + (f.beam.cx - f.beam.ry) + ",92 " + (f.beam.cx + f.beam.ry) + ",92"} fill={c} opacity={op * 0.6} />
                <circle cx={f.beam.cx} cy="8" r="3" fill={c} opacity={0.4 + (level / 100) * 0.6} />
              </g>
            );
          })}
          {/* stage deck */}
          <rect x="10" y="100" width="300" height="14" rx="2" fill="#121821" stroke="#2A3441" strokeWidth="0.5" />
        </svg>
      </div>

      {/* Fader bank */}
      <div className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-3 flex justify-around items-end">
        {fixtures.map((f) => {
          const level = lvl(f.key, 80);
          const c = col(f.key, f.color);
          return (
            <div key={f.key} className="flex flex-col items-center gap-1">
              <span className="text-[8px] font-mono text-[#E6EDF3]">{level}</span>
              <div className="w-3 h-20 bg-[#1A2330] rounded-full overflow-hidden flex flex-col-reverse">
                <div className="w-full rounded-full transition-all duration-500" style={{ height: level + "%", background: c }} />
              </div>
              <span className="w-3 h-3 rounded-sm" style={{ background: c }} />
              <span className="text-[7px] text-[#6B7785]">{f.label}</span>
            </div>
          );
        })}
        {/* Master */}
        <div className="flex flex-col items-center gap-1 pl-2 border-l border-[#2A3441]">
          <span className="text-[8px] font-mono font-bold text-[#5CE1E6]">{master}</span>
          <div className="w-3.5 h-20 bg-[#1A2330] rounded-full overflow-hidden flex flex-col-reverse">
            <div className="w-full rounded-full transition-all duration-500" style={{ height: master + "%", background: "linear-gradient(180deg,#5CE1E6,#3BA4FF)" }} />
          </div>
          <span className="text-[7px] text-[#5CE1E6] font-semibold">MASTER</span>
        </div>
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
  { key: "board", name: "Lighting Board", triggerTopic: "light/stage/+", scriptSource: boardLogic, uiSource: boardUi },
  { key: "cue", name: "Cue Stack", triggerTopic: "show/stage/cue", scriptSource: cueLogic, uiSource: cueUi },
  { key: "atmos", name: "Atmospherics", triggerTopic: "fx/stage/+", scriptSource: atmosLogic, uiSource: atmosUi },
  { key: "pyro", name: "Effects & Pyro", triggerTopic: "pyro/stage/+", scriptSource: pyroLogic, uiSource: pyroUi },
];

const panes = [
  { kind: "device-grid", x: 0, y: 0, w: 12, h: 5 },
  { kind: "automation", ref: "board", x: 0, y: 5, w: 6, h: 13 },
  { kind: "automation", ref: "cue", x: 6, y: 5, w: 6, h: 11 },
  { kind: "automation", ref: "atmos", x: 0, y: 18, w: 6, h: 10 },
  { kind: "automation", ref: "pyro", x: 6, y: 16, w: 6, h: 10 },
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
