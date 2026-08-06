// scripts/seed/tabs/escape-room.mjs — Commercial escape-room operations demo.
//
// Public-demo flagship: a top-down room schematic makes puzzle state, maglocks,
// timer, hints and effects spatially understandable. All public interactions are
// bounded named events; no free-text or arbitrary scene payloads are accepted.

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
  { topic: "light/escape/dmx", payload: { scene: "puzzle" } },
];

const logic = `automation({
  actions: [
    function roomcontrol(context) {
      function init(key, value) {
        if (state.get(key) === undefined) state.set(key, value);
      }

      init("p1", true);
      init("p2", false);
      init("p3", false);
      init("remaining", 2340);
      init("timerStartedAt", Date.now());
      init("paused", false);
      init("scene", "puzzle");
      init("smoke", false);
      init("hintsSent", 1);
      init("lastHint", "Look closer at the bookshelf.");
      init("lastAction", { label: "Game in progress", at: Date.now() });

      var evt = String(context.topic || "").split("/").pop();

      function syncPuzzleDevices() {
        var p1 = Boolean(state.get("p1"));
        var p2 = Boolean(state.get("p2"));
        var p3 = Boolean(state.get("p3"));
        mqtt.publish("sensor/escape/puzzle1", JSON.stringify({ solved: p1, attempts: 3 }));
        mqtt.publish("sensor/escape/puzzle2", JSON.stringify({ solved: p2, beamsBroken: p2 ? 0 : 2 }));
        mqtt.publish("sensor/escape/puzzle3", JSON.stringify({ solved: p3, weight: p3 ? 3.1 : 2.4, target: 3.1 }));
        mqtt.publish("switch/escape/maglock-exit", JSON.stringify({ locked: !(p1 && p2 && p3) }));
      }

      function setHint(id, text) {
        var count = Number(state.get("hintsSent") || 0) + 1;
        state.set("hintsSent", count);
        state.set("lastHint", text);
        state.set("lastAction", { label: "Hint " + id + " delivered to room", at: Date.now() });
        mqtt.publish("switch/escape/hint-screen", JSON.stringify({ on: true, hintId: id, message: text, hintsSent: count }));
        log.info("Escape room preset hint " + id + " sent");
      }

      function setScene(name) {
        state.set("scene", name);
        state.set("lastAction", { label: "Lighting scene: " + name, at: Date.now() });
        mqtt.publish("light/escape/dmx", JSON.stringify({ scene: name }));
      }

      if (evt === "solve-next") {
        if (!state.get("p1")) state.set("p1", true);
        else if (!state.get("p2")) state.set("p2", true);
        else if (!state.get("p3")) state.set("p3", true);
        var solved = (state.get("p1") ? 1 : 0) + (state.get("p2") ? 1 : 0) + (state.get("p3") ? 1 : 0);
        state.set("lastAction", { label: solved === 3 ? "All puzzles solved — exit unlocked" : "Puzzle " + solved + " solved", at: Date.now() });
        syncPuzzleDevices();
      } else if (evt === "add-time" || evt === "sub-time" || evt === "pause") {
        var current = Number(context.state && context.state.remaining);
        if (isNaN(current)) current = Number(state.get("remaining") || 0);
        current = Math.min(7200, Math.max(0, Math.round(current)));
        if (evt === "add-time") current = Math.min(7200, current + 60);
        if (evt === "sub-time") current = Math.max(0, current - 60);
        state.set("remaining", current);
        state.set("timerStartedAt", Date.now());
        if (evt === "pause") {
          var nextPaused = !Boolean(state.get("paused"));
          state.set("paused", nextPaused);
          state.set("lastAction", { label: nextPaused ? "Game timer paused" : "Game timer resumed", at: Date.now() });
        } else {
          state.set("lastAction", { label: evt === "add-time" ? "Game master added one minute" : "Game master removed one minute", at: Date.now() });
        }
      } else if (evt === "hint-1") {
        setHint(1, "Look closer at the bookshelf.");
      } else if (evt === "hint-2") {
        setHint(2, "The portrait frame is not fixed to the wall.");
      } else if (evt === "hint-3") {
        setHint(3, "The three brass weights must balance the scale.");
      } else if (evt === "scene-calm") {
        setScene("calm");
      } else if (evt === "scene-puzzle") {
        setScene("puzzle");
      } else if (evt === "scene-tension") {
        setScene("tension");
      } else if (evt === "scene-victory") {
        setScene("victory");
      } else if (evt === "smoke") {
        var on = !Boolean(state.get("smoke"));
        state.set("smoke", on);
        state.set("lastAction", { label: on ? "Atmospheric effect enabled" : "Atmospheric effect cleared", at: Date.now() });
        mqtt.publish("switch/escape/smoke", JSON.stringify({ on: on }));
      } else if (evt === "reset-room") {
        state.set("p1", true);
        state.set("p2", false);
        state.set("p3", false);
        state.set("remaining", 2340);
        state.set("timerStartedAt", Date.now());
        state.set("paused", false);
        state.set("scene", "puzzle");
        state.set("smoke", false);
        state.set("hintsSent", 1);
        state.set("lastHint", "Look closer at the bookshelf.");
        state.set("lastAction", { label: "Room reset for next team", at: Date.now() });
        syncPuzzleDevices();
        mqtt.publish("switch/escape/smoke", JSON.stringify({ on: false }));
        mqtt.publish("light/escape/dmx", JSON.stringify({ scene: "puzzle" }));
      }
    },
  ],
});`;

const ui = `import { useEffect, useState } from "react";
import type { CustomComponentProps } from "./types";

function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }

const SCENE_COLORS: Record<string, { room: string; accent: string; glow: string }> = {
  calm: { room: "#132333", accent: "#4BB8FF", glow: "rgba(75,184,255,.19)" },
  puzzle: { room: "#21162C", accent: "#B26BFF", glow: "rgba(178,107,255,.20)" },
  tension: { room: "#2A1213", accent: "#FF625C", glow: "rgba(255,98,92,.22)" },
  victory: { room: "#12261A", accent: "#63DF8B", glow: "rgba(99,223,139,.22)" },
};

export default function GameMaster(aeolus: CustomComponentProps) {
  const p1 = Boolean(aeolus.read("p1") ?? true);
  const p2 = Boolean(aeolus.read("p2") ?? false);
  const p3 = Boolean(aeolus.read("p3") ?? false);
  const baseRemaining = clamp(Number(aeolus.read("remaining") ?? 2340), 0, 7200);
  const startedAt = Number(aeolus.read("timerStartedAt") ?? Date.now());
  const paused = Boolean(aeolus.read("paused"));
  const scene = String(aeolus.read("scene") || "puzzle");
  const smoke = Boolean(aeolus.read("smoke"));
  const hintsSent = Number(aeolus.read("hintsSent") ?? 1);
  const lastHint = String(aeolus.read("lastHint") || "Look closer at the bookshelf.");
  const lastAction = aeolus.read("lastAction") as any;

  const [now, setNow] = useState(Date.now());
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const id = setInterval(() => { setNow(Date.now()); setPhase((v) => (v + 1) % 100000); }, 200);
    return () => clearInterval(id);
  }, []);

  const elapsed = paused ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000));
  const remaining = Math.max(0, baseRemaining - elapsed);
  const mm = Math.floor(remaining / 60);
  const ss = remaining % 60;
  const clock = String(mm).padStart(2, "0") + ":" + String(ss).padStart(2, "0");
  const solved = [p1, p2, p3].filter(Boolean).length;
  const exitUnlocked = p1 && p2 && p3;
  const active = !p1 ? 1 : !p2 ? 2 : !p3 ? 3 : 4;
  const palette = SCENE_COLORS[scene] || SCENE_COLORS.puzzle;
  const timeColor = remaining < 300 ? "#FF665D" : remaining < 600 ? "#F0B351" : "#76E29B";
  const actionLabel = lastAction && lastAction.label ? String(lastAction.label) : "Game in progress";

  const fireWithTime = (evt: string) => aeolus.fire(evt, { remaining });

  return (
    <div style={{ minHeight: "100%", padding: 14, color: "#ECE9F2", background: "linear-gradient(180deg,#0D0B10 0%,#09080B 100%)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 10 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 850, letterSpacing: "0.02em" }}>GAME MASTER</span>
            <span style={{ color: palette.accent, border: "1px solid " + palette.accent + "55", background: palette.glow, borderRadius: 999, padding: "2px 7px", fontSize: 8, letterSpacing: "0.1em" }}>{scene.toUpperCase()}</span>
          </div>
          <div style={{ color: "#766D7C", fontSize: 9, marginTop: 3 }}>Puzzle state · room effects · hints · physical locks</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: exitUnlocked ? "#72E298" : timeColor, fontSize: 20, fontWeight: 850, fontFamily: "monospace", letterSpacing: "0.05em" }}>{clock}</div>
          <div style={{ color: "#6C6571", fontSize: 8 }}>{paused ? "PAUSED" : solved + "/3 puzzles solved"} · {actionLabel}</div>
        </div>
      </div>

      <div style={{ border: "1px solid #302A34", borderRadius: 14, overflow: "hidden", background: "#0A090B" }}>
        <svg width="100%" height="395" viewBox="0 0 720 395" preserveAspectRatio="xMidYMid meet">
          <defs>
            <filter id="roomGlow"><feGaussianBlur stdDeviation="7"/></filter>
            <linearGradient id="floor" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={palette.room}/><stop offset="1" stopColor="#0C0B0E"/></linearGradient>
            <radialGradient id="hintGlow"><stop offset="0" stopColor={palette.accent} stopOpacity="0.18"/><stop offset="1" stopColor={palette.accent} stopOpacity="0"/></radialGradient>
          </defs>

          <rect width="720" height="395" fill="#09080A" />
          <rect x="42" y="35" width="504" height="322" rx="5" fill="url(#floor)" stroke="#4B424E" strokeWidth="2" />
          <rect x="42" y="35" width="504" height="322" fill={palette.glow} opacity="0.45" />

          {/* Bookshelf / cipher puzzle */}
          <g>
            <rect x="63" y="61" width="128" height="55" rx="4" fill="#251B18" stroke={p1 ? "#5ACB7D" : active === 1 ? palette.accent : "#5B453A"} strokeWidth={active === 1 ? 2 : 1} />
            {Array.from({ length: 11 }).map((_, i) => <rect key={i} x={70 + i * 10} y={72 + (i % 3) * 3} width="6" height={30 - (i % 3) * 3} fill={["#8F5E46","#5F7892","#8D7450","#6E4A74"][i % 4]} opacity="0.8" />)}
            <circle cx="175" cy="91" r="8" fill="#111" stroke={p1 ? "#5ACB7D" : palette.accent} />
            <text x="127" y="130" textAnchor="middle" fill={p1 ? "#6EDC8C" : "#A99DAA"} fontSize="8">1 · CIPHER BOOKCASE {p1 ? "✓" : ""}</text>
          </g>

          {/* Laser grid */}
          <g>
            <rect x="231" y="63" width="133" height="112" rx="5" fill="#0D1012" stroke={p2 ? "#5ACB7D" : active === 2 ? palette.accent : "#3B4045"} strokeWidth={active === 2 ? 2 : 1} />
            {!p2 && Array.from({ length: 7 }).map((_, i) => {
              const y = 76 + i * 14;
              const wobble = Math.sin(phase * .08 + i) * 2;
              return <line key={i} x1="239" y1={y} x2="356" y2={y + wobble} stroke={i % 2 ? "#FF3E50" : "#F34B64"} strokeWidth="1" opacity={0.58 + Math.sin(phase * .07 + i) * .16} />;
            })}
            {p2 && <path d="M248 116 L283 145 L346 84" fill="none" stroke="#5ACB7D" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}
            <text x="297" y="189" textAnchor="middle" fill={p2 ? "#6EDC8C" : "#A99DAA"} fontSize="8">2 · LASER GRID {p2 ? "✓" : ""}</text>
          </g>

          {/* Weight table */}
          <g>
            <rect x="386" y="73" width="121" height="88" rx="6" fill="#171519" stroke={p3 ? "#5ACB7D" : active === 3 ? palette.accent : "#454048"} strokeWidth={active === 3 ? 2 : 1} />
            <ellipse cx="447" cy="111" rx="38" ry="12" fill="#232026" stroke="#5D5661" />
            {[0,1,2].map((i) => <rect key={i} x={426 + i * 18} y={91 - (p3 ? 0 : i * 4)} width="12" height={18 + i * 4} rx="2" fill="#A77842" stroke="#D0A05C" />)}
            <line x1="447" y1="123" x2="447" y2="139" stroke="#766C77" strokeWidth="2" />
            <path d="M420 141 H474" stroke={p3 ? "#5ACB7D" : "#766C77"} strokeWidth="3" />
            <text x="447" y="176" textAnchor="middle" fill={p3 ? "#6EDC8C" : "#A99DAA"} fontSize="8">3 · BALANCE SCALE {p3 ? "✓" : ""}</text>
          </g>

          {/* Central table / prop */}
          <ellipse cx="281" cy="256" rx="67" ry="35" fill="#171319" stroke="#3E3741" />
          <ellipse cx="281" cy="251" rx="52" ry="25" fill="#211A24" />
          <circle cx="281" cy="247" r="8" fill={palette.accent} opacity={0.25 + Math.sin(phase * .06) * .1} />
          <text x="281" y="315" textAnchor="middle" fill="#615967" fontSize="7">CENTRAL PROP TABLE</text>

          {/* Hint screen */}
          <rect x="63" y="218" width="126" height="77" rx="5" fill="#070A0C" stroke="#394852" />
          <rect x="70" y="225" width="112" height="58" rx="2" fill="#0E1A20" />
          <text x="126" y="239" textAnchor="middle" fill="#5F9AAC" fontSize="6">HINT DISPLAY</text>
          <foreignObject x="76" y="245" width="100" height="32"><div style={{ color: "#B9DCE5", fontSize: 7, lineHeight: 1.25, textAlign: "center" }}>{lastHint}</div></foreignObject>

          {/* Exit door */}
          <g transform="translate(507 224)">
            <rect x="0" y="0" width="39" height="91" fill="#111" stroke={exitUnlocked ? "#67DA8C" : "#6B3E42"} strokeWidth="2" />
            <g style={{ transform: exitUnlocked ? "perspective(100px) rotateY(-48deg)" : "none", transformOrigin: "0px 45px", transition: "transform .7s ease" }}>
              <rect x="2" y="3" width="35" height="85" fill={exitUnlocked ? "#183824" : "#27171A"} stroke={exitUnlocked ? "#67DA8C" : "#75464B"} />
              <circle cx="30" cy="47" r="2" fill="#D6B45D" />
            </g>
            <text x="20" y="106" textAnchor="middle" fill={exitUnlocked ? "#75E298" : "#A47176"} fontSize="8">{exitUnlocked ? "EXIT OPEN" : "MAGLOCKED"}</text>
          </g>

          {/* Smoke */}
          {smoke && Array.from({ length: 8 }).map((_, i) => {
            const x = 380 + ((phase * 2 + i * 53) % 145);
            const y = 314 - ((phase * .8 + i * 19) % 75);
            return <ellipse key={i} cx={x} cy={y} rx={18 + i % 3 * 7} ry={8 + i % 2 * 4} fill="#DCE2E8" opacity={0.035 + (i % 3) * .018} />;
          })}

          {/* Game flow line */}
          <path d="M190 90 C210 90 218 100 231 115 M364 116 C378 116 382 113 386 113 M507 115 C532 126 542 162 526 224" fill="none" stroke={palette.accent} strokeWidth="1.3" strokeDasharray="4 5" opacity="0.45" />

          {/* GM-side status rail */}
          <rect x="570" y="35" width="127" height="322" rx="7" fill="#0D0B0F" stroke="#302A34" />
          <text x="585" y="57" fill="#706777" fontSize="7" letterSpacing="1.2">ROOM STATE</text>
          <text x="585" y="87" fill={timeColor} fontSize="25" fontFamily="monospace" fontWeight="800">{clock}</text>
          <text x="585" y="102" fill="#675F6B" fontSize="7">{paused ? "timer paused" : "countdown running"}</text>

          {[{ n: 1, ok: p1, label: "Cipher" }, { n: 2, ok: p2, label: "Lasers" }, { n: 3, ok: p3, label: "Scale" }].map((p, i) => <g key={p.n} transform={"translate(585 " + (129 + i * 32) + ")"}><circle cx="7" cy="7" r="6" fill={p.ok ? "#183A23" : active === p.n ? palette.glow : "#18151A"} stroke={p.ok ? "#63D986" : active === p.n ? palette.accent : "#39333D"}/><text x="7" y="10" textAnchor="middle" fill={p.ok ? "#72E394" : "#847A87"} fontSize="7">{p.ok ? "✓" : p.n}</text><text x="21" y="10" fill={p.ok ? "#86C697" : "#8E8492"} fontSize="8">{p.label}</text></g>)}

          <line x1="585" y1="230" x2="682" y2="230" stroke="#2C2730" />
          <text x="585" y="248" fill="#706777" fontSize="7">HINTS SENT</text>
          <text x="672" y="248" textAnchor="end" fill="#C6A6EA" fontSize="12" fontFamily="monospace" fontWeight="700">{hintsSent}</text>
          <text x="585" y="277" fill="#706777" fontSize="7">EXIT</text>
          <text x="672" y="277" textAnchor="end" fill={exitUnlocked ? "#72E394" : "#CB7777"} fontSize="9" fontWeight="700">{exitUnlocked ? "UNLOCKED" : "LOCKED"}</text>
          <text x="585" y="309" fill="#706777" fontSize="7">ATMOSPHERE</text>
          <text x="672" y="309" textAnchor="end" fill={smoke ? "#CFD6DA" : "#7A737C"} fontSize="9">{smoke ? "SMOKE ON" : "CLEAR"}</text>
          <text x="585" y="339" fill="#706777" fontSize="7">SCENE</text>
          <text x="672" y="339" textAnchor="end" fill={palette.accent} fontSize="9" fontWeight="700">{scene.toUpperCase()}</text>
        </svg>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: 8, marginTop: 9 }}>
        <div style={{ border: "1px solid #302A34", background: "#0E0C10", borderRadius: 11, padding: 10 }}>
          <div style={{ color: palette.accent, fontSize: 8, letterSpacing: "0.12em", marginBottom: 7 }}>GAME CONTROL</div>
          <div style={{ display: "grid", gridTemplateColumns: "1.25fr repeat(3,.75fr)", gap: 5 }}>
            <button onClick={() => aeolus.fire("solve-next")} disabled={exitUnlocked} style={{ background: exitUnlocked ? "#151318" : palette.glow, color: exitUnlocked ? "#5E5961" : palette.accent, border: "1px solid " + (exitUnlocked ? "#302C33" : palette.accent + "77"), borderRadius: 7, padding: "7px", fontSize: 9, cursor: exitUnlocked ? "default" : "pointer", fontWeight: 750 }}>{exitUnlocked ? "Room solved" : "Solve next"}</button>
            <button onClick={() => fireWithTime("add-time")} style={{ background: "#102018", color: "#78DA96", border: "1px solid #31503B", borderRadius: 7, fontSize: 9, cursor: "pointer" }}>+1m</button>
            <button onClick={() => fireWithTime("sub-time")} style={{ background: "#241C10", color: "#E3B55B", border: "1px solid #564321", borderRadius: 7, fontSize: 9, cursor: "pointer" }}>−1m</button>
            <button onClick={() => fireWithTime("pause")} style={{ background: "#111A23", color: "#71BCEB", border: "1px solid #2C4A5F", borderRadius: 7, fontSize: 9, cursor: "pointer" }}>{paused ? "Resume" : "Pause"}</button>
          </div>
          <div style={{ color: "#665F69", fontSize: 8, marginTop: 7 }}>All controls are bounded demo events driving trusted room Logic.</div>
        </div>

        <div style={{ border: "1px solid #302A34", background: "#0E0C10", borderRadius: 11, padding: 10 }}>
          <div style={{ color: "#B99AD8", fontSize: 8, letterSpacing: "0.12em", marginBottom: 7 }}>PRESET HINTS</div>
          <div style={{ display: "flex", gap: 5 }}>
            {[1,2,3].map((id) => <button key={id} onClick={() => aeolus.fire("hint-" + id)} style={{ flex: 1, background: "#17121D", color: "#BFA8D4", border: "1px solid #3D3048", borderRadius: 7, padding: "7px 4px", fontSize: 9, cursor: "pointer" }}>Hint {id}</button>)}
          </div>
          <div style={{ color: "#665F69", fontSize: 8, marginTop: 7, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Screen: {lastHint}</div>
        </div>

        <div style={{ border: "1px solid #302A34", background: "#0E0C10", borderRadius: 11, padding: 10 }}>
          <div style={{ color: palette.accent, fontSize: 8, letterSpacing: "0.12em", marginBottom: 7 }}>ROOM LOOK</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 4 }}>
            {[{e:"scene-calm",l:"Calm",c:"#4BB8FF"},{e:"scene-puzzle",l:"Puzzle",c:"#B26BFF"},{e:"scene-tension",l:"Tension",c:"#FF625C"},{e:"scene-victory",l:"Victory",c:"#63DF8B"}].map((s) => <button key={s.e} onClick={() => aeolus.fire(s.e)} title={s.l} style={{ height: 27, background: s.c + (scene === s.l.toLowerCase() ? "44" : "18"), border: "1px solid " + s.c + (scene === s.l.toLowerCase() ? "AA" : "44"), borderRadius: 6, cursor: "pointer" }} />)}
          </div>
          <button onClick={() => aeolus.fire("smoke")} style={{ width: "100%", marginTop: 6, background: smoke ? "#24272A" : "#151519", color: smoke ? "#E1E5E7" : "#918B94", border: "1px solid #37363A", borderRadius: 7, padding: "5px", fontSize: 8, cursor: "pointer" }}>{smoke ? "Clear smoke" : "Atmosphere"}</button>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", color: "#625C65", fontSize: 8, marginTop: 9 }}>
        <span>Simulated commercial room · shared game state · no free-form public inputs</span>
        <button onClick={() => aeolus.fire("reset-room")} style={{ background: "transparent", border: 0, color: "#7B737D", fontSize: 8, cursor: "pointer" }}>Reset room</button>
      </div>
    </div>
  );
}`;

const automations = [
  {
    key: "room-ops",
    name: "Game Master",
    triggerTopic: "none",
    scriptSource: logic,
    uiSource: ui,
    demoAccess: {
      fireEvents: [
        "solve-next", "add-time", "sub-time", "pause",
        "hint-1", "hint-2", "hint-3",
        "scene-calm", "scene-puzzle", "scene-tension", "scene-victory",
        "smoke", "reset-room",
      ],
    },
  },
];

const panes = [
  { kind: "automation", ref: "room-ops", x: 0, y: 0, w: 12, h: 17 },
  { kind: "device-grid", x: 0, y: 17, w: 12, h: 6 },
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
