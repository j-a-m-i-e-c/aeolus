// scripts/seed/tabs/escape-room.mjs — Commercial escape room control demo.
//
// Escape-room control software is a real product category; makers already build
// rigs on Raspberry Pi + relays + MQTT. A dev could run Aeolus here today.

import { genSeries } from "../lib.mjs";

const tab = { id: "tab-escape-room", name: "Escape Room", icon: "puzzle" };

const devices = [
  { topic: "sensor/escape/puzzle1", payload: { solved: true, attempts: 3 } },
  { topic: "sensor/escape/puzzle2", payload: { solved: false, beamsBroken: 2 } },
  { topic: "sensor/escape/puzzle3", payload: { solved: false, weight: 2.4, target: 3.1 } },
  { topic: "switch/escape/maglock-1", payload: { locked: false } },
  { topic: "switch/escape/maglock-exit", payload: { locked: true } },
  { topic: "switch/escape/hint-screen", payload: { on: true, hintsSent: 1 } },
  { topic: "switch/escape/smoke", payload: { on: false } },
];

// ─── Puzzle Sequencer — prop state machine + sequential maglocks ─────────────
const puzzleLogic = `automation({
  conditions: [
    function hasPuzzle(context) {
      return context.state && context.state.solved !== undefined;
    },
  ],
  actions: [
    function sequence(context) {
      var topic = context.topic || "";
      var s = context.state;
      var n = topic.indexOf("puzzle1") >= 0 ? 1 : topic.indexOf("puzzle2") >= 0 ? 2 : topic.indexOf("puzzle3") >= 0 ? 3 : 0;
      if (n) state.set("p" + n + "_solved", s.solved);

      var p1 = state.get("p1_solved");
      var p2 = state.get("p2_solved");
      var p3 = state.get("p3_solved");
      if (p1 === undefined) p1 = true;
      if (p2 === undefined) p2 = false;
      if (p3 === undefined) p3 = false;

      var solvedCount = (p1 ? 1 : 0) + (p2 ? 1 : 0) + (p3 ? 1 : 0);
      state.set("solvedCount", solvedCount);
      state.set("progress", Math.round((solvedCount / 3) * 100));

      if (p1) mqtt.publish("switch/escape/maglock-1/command", JSON.stringify({ locked: false }));
      var exitOpen = p1 && p2 && p3;
      state.set("exitUnlocked", exitOpen);
      if (exitOpen) {
        mqtt.publish("switch/escape/maglock-exit/command", JSON.stringify({ locked: false }));
        log.info("All puzzles solved — exit unlocked!");
      }
      state.set("lastUpdate", Date.now());
    },
  ],
});`;

const puzzleUi = `import type { CustomComponentProps } from "./types";

export default function PuzzleSequencer(aeolus: CustomComponentProps) {
  const p1 = aeolus.read("p1_solved") as boolean ?? true;
  const p2 = aeolus.read("p2_solved") as boolean ?? false;
  const p3 = aeolus.read("p3_solved") as boolean ?? false;
  const progress = aeolus.read("progress") as number ?? 33;
  const exitUnlocked = aeolus.read("exitUnlocked") as boolean ?? false;

  const stages = [
    { label: "Cipher Lock", solved: p1 },
    { label: "Laser Grid", solved: p2 },
    { label: "Weight Scale", solved: p3 },
  ];
  // active = first unsolved
  const activeIdx = stages.findIndex((s) => !s.solved);

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🧩 Puzzle Sequencer</div>
        <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold bg-[#4B0082]/30 text-[#C8A2FF]">{progress}%</span>
      </div>

      <div className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-4">
        <div className="flex items-center justify-between">
          {stages.map((st, i) => {
            const isActive = i === activeIdx;
            const color = st.solved ? "#22C55E" : isActive ? "#F59E0B" : "#6B7785";
            return (
              <div key={st.label} className="flex items-center flex-1 last:flex-none">
                <div className="flex flex-col items-center">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center border-2 transition-all duration-500" style={{ borderColor: color, background: color + "20" }}>
                    <span className="text-[13px]">{st.solved ? "✓" : isActive ? "◐" : "🔒"}</span>
                  </div>
                  <span className="text-[8px] mt-1 text-center w-14" style={{ color }}>{st.label}</span>
                </div>
                {i < stages.length - 1 && (
                  <div className="flex-1 h-0.5 mx-1" style={{ background: st.solved ? "#22C55E" : "#2A3441" }} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between rounded-lg border px-3 py-2.5" style={{ background: exitUnlocked ? "#22C55E15" : "#0B0F14", borderColor: exitUnlocked ? "#22C55E4D" : "#2A3441" }}>
        <span className="text-[11px] font-medium" style={{ color: exitUnlocked ? "#22C55E" : "#9AA6B2" }}>
          {exitUnlocked ? "🚪 Exit Unlocked" : "🔒 Final Exit Locked"}
        </span>
        <span className="text-[9px] font-mono" style={{ color: exitUnlocked ? "#22C55E" : "#6B7785" }}>
          {stages.filter((s) => s.solved).length}/3 solved
        </span>
      </div>
    </div>
  );
}`;

// ─── Game Master Console ⭐ — master timer + transport controls ──────────────
const gmLogic = `automation({
  conditions: [
    function ready(context) {
      return true;
    },
  ],
  actions: [
    function gm(context) {
      var s = context.state || {};
      var t = context.topic || "";
      if (s.remaining !== undefined) state.set("remaining", s.remaining);

      var current = state.get("remaining");
      if (current === undefined) current = 2340;

      if (t.indexOf("add-time") >= 0) { state.set("remaining", current + 60); log.info("GM +60s"); }
      else if (t.indexOf("sub-time") >= 0) { state.set("remaining", Math.max(0, current - 60)); log.info("GM -60s"); }
      else if (t.indexOf("pause") >= 0) { state.set("paused", !state.get("paused")); }
      else if (t.indexOf("reset") >= 0) { state.set("remaining", 3600); state.set("paused", false); log.info("Room reset — 60:00"); }

      var rem = state.get("remaining") || 0;
      state.set("danger", rem < 300);
      state.set("lastUpdate", Date.now());
    },
  ],
});`;

const gmUi = `import type { CustomComponentProps } from "./types";

export default function GameMasterConsole(aeolus: CustomComponentProps) {
  const remaining = aeolus.read("remaining") as number ?? 2340;
  const paused = aeolus.read("paused") as boolean ?? false;
  const danger = aeolus.read("danger") as boolean ?? false;
  const solvedCount = aeolus.read("solvedCount") as number ?? 1;

  const mm = Math.floor(remaining / 60);
  const ss = remaining % 60;
  const clock = (mm < 10 ? "0" : "") + mm + ":" + (ss < 10 ? "0" : "") + ss;
  const timeColor = danger ? "#EF4444" : remaining < 600 ? "#F59E0B" : "#22C55E";
  const total = 3600;
  const pct = Math.max(0, Math.min(100, (remaining / total) * 100));

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🎮 Game Master Console</div>
        <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: paused ? "#F59E0B20" : "#22C55E20", color: paused ? "#F59E0B" : "#22C55E" }}>
          {paused ? "⏸ Paused" : "● Running"}
        </span>
      </div>

      {/* Big countdown */}
      <div className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-4 flex flex-col items-center">
        <div className="text-5xl font-mono font-bold tracking-wider" style={{ color: timeColor }}>{clock}</div>
        <div className="w-full h-1.5 bg-[#1A2330] rounded-full overflow-hidden mt-3">
          <div className="h-full rounded-full transition-all duration-700" style={{ width: pct + "%", background: timeColor }} />
        </div>
        <div className="text-[9px] text-[#6B7785] mt-1.5">{solvedCount}/3 puzzles solved</div>
      </div>

      {/* Transport controls */}
      <div className="grid grid-cols-4 gap-1.5">
        <button onClick={() => aeolus.fire("add-time", {})} className="py-2 rounded-lg text-[11px] font-medium bg-[#22C55E]/15 text-[#22C55E] border border-[#22C55E]/30 hover:bg-[#22C55E]/25 transition-all">+1:00</button>
        <button onClick={() => aeolus.fire("sub-time", {})} className="py-2 rounded-lg text-[11px] font-medium bg-[#F59E0B]/15 text-[#F59E0B] border border-[#F59E0B]/30 hover:bg-[#F59E0B]/25 transition-all">−1:00</button>
        <button onClick={() => aeolus.fire("pause", {})} className="py-2 rounded-lg text-[11px] font-medium bg-[#3BA4FF]/15 text-[#3BA4FF] border border-[#3BA4FF]/30 hover:bg-[#3BA4FF]/25 transition-all">{paused ? "Resume" : "Pause"}</button>
        <button onClick={() => aeolus.fire("reset", {})} className="py-2 rounded-lg text-[11px] font-medium bg-[#EF4444]/15 text-[#EF4444] border border-[#EF4444]/30 hover:bg-[#EF4444]/25 transition-all">Reset</button>
      </div>
    </div>
  );
}`;

// ─── Hint System — deliver hints to in-room screen, track budget ─────────────
const hintLogic = `automation({
  conditions: [
    function ready(context) {
      return true;
    },
  ],
  actions: [
    function hint(context) {
      var t = context.topic || "";
      if (t.indexOf("send-hint") >= 0) {
        var count = (state.get("hintsSent") || 0) + 1;
        state.set("hintsSent", count);
        var msg = (context.state && context.state.text) ? context.state.text : "Look closer at the bookshelf.";
        state.set("lastHint", msg);
        state.set("lastHintAt", Date.now());
        mqtt.publish("switch/escape/hint-screen/command", JSON.stringify({ message: msg }));
        log.info("Hint #" + count + " sent: " + msg);
      }
      state.set("lastUpdate", Date.now());
    },
  ],
});`;

const hintUi = `import type { CustomComponentProps } from "./types";

export default function HintSystem(aeolus: CustomComponentProps) {
  const hintsSent = aeolus.read("hintsSent") as number ?? 1;
  const lastHint = aeolus.read("lastHint") as string || "—";

  const presets = [
    "Look closer at the bookshelf.",
    "The painting hides something.",
    "Combine the two halves.",
    "Check under the rug.",
  ];
  const budget = 3;
  const overBudget = hintsSent > budget;

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">💡 Hint System</div>
        <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: overBudget ? "#EF444420" : "#3BA4FF20", color: overBudget ? "#EF4444" : "#3BA4FF" }}>
          {hintsSent} sent
        </span>
      </div>

      {/* Last hint on screen */}
      <div className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-3">
        <div className="text-[9px] text-[#6B7785] mb-1">On Room Screen</div>
        <div className="text-[11px] text-[#E6EDF3] font-medium min-h-[16px]">{lastHint}</div>
      </div>

      {/* Hint budget dots */}
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] text-[#6B7785]">Budget</span>
        {[0, 1, 2].map((i) => (
          <span key={i} className="w-2.5 h-2.5 rounded-full" style={{ background: i < (budget - Math.min(hintsSent, budget)) ? "#22C55E" : "#2A3441" }} />
        ))}
        <span className="text-[9px] text-[#6B7785] ml-auto">{Math.max(0, budget - hintsSent)} free left</span>
      </div>

      {/* Preset hint buttons */}
      <div className="space-y-1.5">
        {presets.map((p) => (
          <button
            key={p}
            onClick={() => aeolus.fire("send-hint", { text: p })}
            className="w-full text-left px-3 py-2 rounded-lg text-[10px] text-[#9AA6B2] bg-[#0B0F14] border border-[#2A3441] hover:border-[#3BA4FF]/40 hover:text-[#E6EDF3] transition-all"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}`;

// ─── Effects & Lighting — DMX scene control synced to game phase ─────────────
const fxLogic = `automation({
  conditions: [
    function ready(context) {
      return true;
    },
  ],
  actions: [
    function effects(context) {
      var s = context.state || {};
      var t = context.topic || "";
      if (s.scene !== undefined) state.set("scene", s.scene);

      if (t.indexOf("scene") >= 0 && s.name) {
        state.set("scene", s.name);
        mqtt.publish("light/escape/dmx/command", JSON.stringify({ scene: s.name }));
        log.info("DMX scene → " + s.name);
      }
      if (t.indexOf("smoke") >= 0) {
        var on = !state.get("smoke");
        state.set("smoke", on);
        mqtt.publish("switch/escape/smoke/command", JSON.stringify({ on: on }));
      }
      state.set("lastUpdate", Date.now());
    },
  ],
});`;

const fxUi = `import type { CustomComponentProps } from "./types";

export default function EffectsLighting(aeolus: CustomComponentProps) {
  const scene = aeolus.read("scene") as string || "puzzle";
  const smoke = aeolus.read("smoke") as boolean ?? false;

  const scenes = [
    { name: "calm", label: "Calm", colour: "#3BA4FF" },
    { name: "puzzle", label: "Puzzle", colour: "#4B0082" },
    { name: "tension", label: "Tension", colour: "#EF4444" },
    { name: "victory", label: "Victory", colour: "#22C55E" },
    { name: "blackout", label: "Blackout", colour: "#1A2330" },
    { name: "strobe", label: "Strobe", colour: "#F59E0B" },
  ];

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🎭 Effects & Lighting</div>
        <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold capitalize bg-[#4B0082]/30 text-[#C8A2FF]">{scene}</span>
      </div>

      {/* Scene selector grid */}
      <div className="grid grid-cols-3 gap-2">
        {scenes.map((sc) => {
          const active = sc.name === scene;
          return (
            <button
              key={sc.name}
              onClick={() => aeolus.fire("scene", { name: sc.name })}
              className="flex flex-col items-center gap-1.5 py-3 rounded-xl border transition-all"
              style={{ background: active ? sc.colour + "25" : "#0B0F14", borderColor: active ? sc.colour : "#2A3441" }}
            >
              <span className="w-6 h-6 rounded-full border" style={{ background: sc.colour, borderColor: active ? "#E6EDF3" : "transparent" }} />
              <span className="text-[9px]" style={{ color: active ? "#E6EDF3" : "#9AA6B2" }}>{sc.label}</span>
            </button>
          );
        })}
      </div>

      <button
        onClick={() => aeolus.fire("smoke", {})}
        className="w-full py-2.5 rounded-lg text-xs font-medium border transition-all"
        style={{ background: smoke ? "#9AA6B225" : "#0B0F14", color: smoke ? "#E6EDF3" : "#9AA6B2", borderColor: "#2A3441" }}
      >
        {smoke ? "💨 Smoke Machine ON" : "Smoke Machine OFF"}
      </button>
    </div>
  );
}`;

// ─── Assembly ────────────────────────────────────────────────────────────────
const automations = [
  { key: "puzzle", name: "Puzzle Sequencer", triggerTopic: "sensor/escape/puzzle+", scriptSource: puzzleLogic, uiSource: puzzleUi },
  { key: "gm", name: "Game Master Console", triggerTopic: "none", scriptSource: gmLogic, uiSource: gmUi },
  { key: "hint", name: "Hint System", triggerTopic: "none", scriptSource: hintLogic, uiSource: hintUi },
  { key: "fx", name: "Effects & Lighting", triggerTopic: "none", scriptSource: fxLogic, uiSource: fxUi },
];

const panes = [
  { kind: "automation", ref: "gm", x: 0, y: 0, w: 6, h: 10 },
  { kind: "automation", ref: "puzzle", x: 6, y: 0, w: 6, h: 8 },
  { kind: "automation", ref: "hint", x: 0, y: 10, w: 6, h: 11 },
  { kind: "automation", ref: "fx", x: 6, y: 8, w: 6, h: 11 },
];

const dataStore = [
  {
    name: "game-sessions",
    description: "Past escape-room sessions: completion time, puzzles, hints",
    retentionDays: 365,
    records: genSeries({
      count: 24,
      intervalMs: 75 * 60_000,
      fields: {
        durationSec: () => Math.round(2400 + Math.random() * 1100),
        puzzlesSolved: () => (Math.random() > 0.25 ? 3 : 2),
        hintsUsed: () => Math.round(Math.random() * 4),
        escaped: () => (Math.random() > 0.3 ? 1 : 0),
      },
    }),
  },
];

export default { tab, devices, automations, panes, dataStore };
