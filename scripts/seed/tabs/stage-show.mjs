// scripts/seed/tabs/stage-show.mjs — Live stage lighting & FX console (simulated).
//
// Public-demo flagship: this is intentionally designed as a small purpose-built
// show-control application rather than a generic IoT dashboard. Shared state
// (scene, master, haze, FX interlock and cue history) lives in Aeolus. Smooth
// beam motion, haze drift and strobe presentation remain browser-side so the UI
// can animate fluidly without turning the backend into a rendering loop.

const tab = { id: "tab-stage-show", name: "Stage & Show", icon: "sparkles" };

const devices = [
  { topic: "switch/stage/hazer", payload: { on: false } },
  { topic: "sensor/stage/dmx", payload: { master: 72, universe: 1, fixturesOnline: 8 } },
  { topic: "sensor/stage/safety", payload: { estop: false, fxLoopHealthy: true } },
];

const logic = `automation({
  actions: [
    function showcontrol(context) {
      // Seed sensible shared defaults the first time the rule runs. The demo
      // seeder fires every rule, so visitors arrive to a complete shared scene.
      if (state.get("armed") === undefined) state.set("armed", false);
      if (state.get("scene") === undefined) state.set("scene", "wash");
      if (state.get("master") === undefined) state.set("master", 72);
      if (state.get("haze") === undefined) state.set("haze", 34);
      if (state.get("lastCue") === undefined) {
        state.set("lastCue", { id: "wash", label: "Open Wash", at: Date.now() });
      }

      var evt = String(context.topic || "").split("/").pop();

      function setCue(id, label) {
        state.set("scene", id);
        state.set("lastCue", { id: id, label: label, at: Date.now() });
        mqtt.publish("sensor/stage/dmx", JSON.stringify({
          master: Number(state.get("master") || 0),
          scene: id,
          universe: 1,
          fixturesOnline: 8
        }));
        log.info("Show cue: " + label);
        if (db) db.write("show-cues", { type: "scene", cue: id, label: label });
      }

      if (evt === "arm") {
        state.set("armed", true);
        log.info("Stage FX interlock armed");
      } else if (evt === "disarm") {
        state.set("armed", false);
        log.info("Stage FX interlock disarmed");
      } else if (evt === "cue-wash") {
        setCue("wash", "Open Wash");
      } else if (evt === "cue-verse") {
        setCue("verse", "Verse");
      } else if (evt === "cue-chorus") {
        setCue("chorus", "Chorus");
      } else if (evt === "cue-red") {
        setCue("red", "Red Hit");
      } else if (evt === "cue-blackout") {
        setCue("blackout", "Blackout");
      } else if (evt === "set-master") {
        var requestedMaster = Number(context.state && context.state.value);
        if (!isNaN(requestedMaster)) {
          var safeMaster = Math.min(100, Math.max(0, Math.round(requestedMaster)));
          state.set("master", safeMaster);
          mqtt.publish("sensor/stage/dmx", JSON.stringify({
            master: safeMaster,
            scene: String(state.get("scene") || "wash"),
            universe: 1,
            fixturesOnline: 8
          }));
        }
      } else if (evt === "set-haze") {
        var requestedHaze = Number(context.state && context.state.value);
        if (!isNaN(requestedHaze)) {
          var safeHaze = Math.min(100, Math.max(0, Math.round(requestedHaze)));
          state.set("haze", safeHaze);
          mqtt.publish("switch/stage/hazer", JSON.stringify({ on: safeHaze > 0, level: safeHaze }));
        }
      } else if (evt === "fog") {
        if (!state.get("armed")) {
          log.warn("Fog blocked — FX interlock disarmed");
          return;
        }
        var currentHaze = Number(state.get("haze") || 0);
        var burstHaze = Math.min(100, Math.max(0, currentHaze) + 22);
        state.set("haze", burstHaze);
        state.set("lastFx", { fx: "fog", at: Date.now() });
        mqtt.publish("switch/stage/hazer", JSON.stringify({ on: true, level: burstHaze, burst: true }));
        log.info("Haze burst fired");
        if (db) db.write("show-cues", { type: "fx", fx: "fog" });
      } else if (evt === "strobe") {
        if (!state.get("armed")) {
          log.warn("Strobe blocked — FX interlock disarmed");
          return;
        }
        state.set("lastFx", { fx: "strobe", at: Date.now() });
        log.info("Strobe hit fired");
        if (db) db.write("show-cues", { type: "fx", fx: "strobe" });
      }
    },
  ],
});`;

const ui = `import { useState, useEffect } from "react";
import type { CustomComponentProps } from "./types";

type SceneId = "wash" | "verse" | "chorus" | "red" | "blackout";

type Scene = {
  id: SceneId;
  label: string;
  short: string;
  primary: string;
  secondary: string;
  accent: string;
  angles: number[];
  levels: number[];
  floor: string;
};

const SCENES: Record<SceneId, Scene> = {
  wash: {
    id: "wash",
    label: "Open Wash",
    short: "WASH",
    primary: "#52D8FF",
    secondary: "#8B5CF6",
    accent: "#F5C451",
    angles: [-13, -8, -3, 3, 8, 13],
    levels: [0.68, 0.74, 0.82, 0.82, 0.74, 0.68],
    floor: "#456FFF",
  },
  verse: {
    id: "verse",
    label: "Verse",
    short: "VERSE",
    primary: "#2D6DFF",
    secondary: "#F2A33A",
    accent: "#78E7FF",
    angles: [-22, -11, -3, 3, 11, 22],
    levels: [0.34, 0.54, 0.68, 0.68, 0.54, 0.34],
    floor: "#133A91",
  },
  chorus: {
    id: "chorus",
    label: "Chorus",
    short: "CHORUS",
    primary: "#F34CC7",
    secondary: "#42D8FF",
    accent: "#C9FF4A",
    angles: [-31, -18, -7, 7, 18, 31],
    levels: [0.86, 0.92, 1, 1, 0.92, 0.86],
    floor: "#8C2F93",
  },
  red: {
    id: "red",
    label: "Red Hit",
    short: "RED HIT",
    primary: "#FF3434",
    secondary: "#FF6A3D",
    accent: "#FFF4DC",
    angles: [-7, -4, -1, 1, 4, 7],
    levels: [0.84, 0.94, 1, 1, 0.94, 0.84],
    floor: "#B01218",
  },
  blackout: {
    id: "blackout",
    label: "Blackout",
    short: "BLACKOUT",
    primary: "#334155",
    secondary: "#1E293B",
    accent: "#64748B",
    angles: [-8, -4, -1, 1, 4, 8],
    levels: [0, 0, 0, 0, 0, 0],
    floor: "#05070A",
  },
};

const CUES: Array<{ id: SceneId; event: string }> = [
  { id: "wash", event: "cue-wash" },
  { id: "verse", event: "cue-verse" },
  { id: "chorus", event: "cue-chorus" },
  { id: "red", event: "cue-red" },
  { id: "blackout", event: "cue-blackout" },
];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export default function ShowControl(aeolus: CustomComponentProps) {
  const rawScene = String(aeolus.read("scene") || "wash") as SceneId;
  const sceneId: SceneId = SCENES[rawScene] ? rawScene : "wash";
  const scene = SCENES[sceneId];
  const armed = Boolean(aeolus.read("armed"));
  const sharedMaster = clamp(Number(aeolus.read("master") ?? 72), 0, 100);
  const sharedHaze = clamp(Number(aeolus.read("haze") ?? 34), 0, 100);
  const lastFx = aeolus.read("lastFx") as any;
  const lastCue = aeolus.read("lastCue") as any;

  const [master, setMaster] = useState(sharedMaster);
  const [haze, setHaze] = useState(sharedHaze);
  const [phase, setPhase] = useState(0);
  const [strobe, setStrobe] = useState(false);
  const [cuePulse, setCuePulse] = useState(false);

  useEffect(() => setMaster(sharedMaster), [sharedMaster]);
  useEffect(() => setHaze(sharedHaze), [sharedHaze]);

  // Browser-side presentation only. Shared operational state stays in Aeolus;
  // this loop just interpolates movement so every state change feels physical.
  useEffect(() => {
    const id = setInterval(() => setPhase((v) => (v + 1) % 10000), 90);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!lastFx || lastFx.fx !== "strobe") return;
    setStrobe(true);
    const t = setTimeout(() => setStrobe(false), 520);
    return () => clearTimeout(t);
  }, [lastFx && lastFx.at]);

  useEffect(() => {
    if (!lastCue || !lastCue.at) return;
    setCuePulse(true);
    const t = setTimeout(() => setCuePulse(false), 620);
    return () => clearTimeout(t);
  }, [lastCue && lastCue.at]);

  const masterFactor = sceneId === "blackout" ? 0 : master / 100;
  const hazeFactor = haze / 100;
  const beat = Math.sin(phase * 0.42) * 0.5 + 0.5;
  const showLive = master > 0 && sceneId !== "blackout";
  const fixtureX = [58, 108, 158, 202, 252, 302];

  function commitMaster(value: number) {
    const v = clamp(Math.round(value), 0, 100);
    setMaster(v);
    aeolus.fire("set-master", { value: v });
  }

  function commitHaze(value: number) {
    const v = clamp(Math.round(value), 0, 100);
    setHaze(v);
    aeolus.fire("set-haze", { value: v });
  }

  return (
    <div style={{ padding: 14, background: "linear-gradient(180deg,#0D1118 0%,#090C11 100%)", color: "#E6EDF3", minHeight: "100%" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.02em" }}>STAGE CONTROL</span>
            <span style={{ fontSize: 8, color: "#788697", border: "1px solid #263140", borderRadius: 999, padding: "2px 6px", letterSpacing: "0.12em" }}>UNIVERSE 1</span>
          </div>
          <div style={{ fontSize: 9, color: "#6F7D8D", marginTop: 3 }}>Purpose-built show operator surface · shared Aeolus state</div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 8, padding: "4px 7px", borderRadius: 999, border: "1px solid " + (showLive ? "#22C55E55" : "#334155"), color: showLive ? "#6BEA94" : "#788697", background: showLive ? "#22C55E12" : "#10151D", letterSpacing: "0.08em" }}>{showLive ? "● SHOW LIVE" : "SHOW DARK"}</span>
          <span style={{ fontSize: 8, padding: "4px 7px", borderRadius: 999, border: "1px solid " + (armed ? "#EF444455" : "#334155"), color: armed ? "#FF7171" : "#8B98A8", background: armed ? "#EF444412" : "#10151D" }}>{armed ? "FX ARMED" : "FX SAFE"}</span>
        </div>
      </div>

      <div style={{ position: "relative", overflow: "hidden", border: "1px solid #263140", borderRadius: 14, background: "#030509", boxShadow: cuePulse ? "0 0 0 1px " + scene.primary + "66, 0 0 28px " + scene.primary + "20" : "0 16px 34px #00000045", transition: "box-shadow 250ms" }}>
        <svg width="100%" height="300" viewBox="0 0 360 300" preserveAspectRatio="xMidYMid meet" style={{ display: "block" }}>
          <defs>
            <linearGradient id="stageBg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#050812" />
              <stop offset="58%" stopColor="#080914" />
              <stop offset="100%" stopColor="#050609" />
            </linearGradient>
            <radialGradient id="floorGlow">
              <stop offset="0%" stopColor={scene.floor} stopOpacity={0.72 * masterFactor} />
              <stop offset="60%" stopColor={scene.floor} stopOpacity={0.20 * masterFactor} />
              <stop offset="100%" stopColor={scene.floor} stopOpacity="0" />
            </radialGradient>
            <linearGradient id="beamA" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={scene.primary} stopOpacity="0.62" />
              <stop offset="100%" stopColor={scene.primary} stopOpacity="0.02" />
            </linearGradient>
            <linearGradient id="beamB" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={scene.secondary} stopOpacity="0.60" />
              <stop offset="100%" stopColor={scene.secondary} stopOpacity="0.02" />
            </linearGradient>
          </defs>

          <rect x="0" y="0" width="360" height="300" fill="url(#stageBg)" />

          {/* Far wall / LED backdrop. */}
          <rect x="42" y="72" width="276" height="126" rx="5" fill="#070A10" stroke="#151D28" />
          <rect x="49" y="79" width="262" height="112" rx="3" fill={scene.floor} opacity={0.055 + masterFactor * 0.11} style={{ transition: "fill 600ms, opacity 500ms" }} />
          {[0, 1, 2, 3, 4, 5, 6].map((n) => (
            <line key={"led-v-" + n} x1={49 + n * 43.7} y1="79" x2={49 + n * 43.7} y2="191" stroke="#FFFFFF" opacity="0.025" />
          ))}
          {[0, 1, 2, 3].map((n) => (
            <line key={"led-h-" + n} x1="49" y1={79 + n * 28} x2="311" y2={79 + n * 28} stroke="#FFFFFF" opacity="0.025" />
          ))}

          {/* Truss. */}
          <line x1="32" y1="38" x2="328" y2="38" stroke="#344151" strokeWidth="4" />
          <line x1="32" y1="46" x2="328" y2="46" stroke="#18222E" strokeWidth="2" />
          {[42, 72, 102, 132, 162, 192, 222, 252, 282, 312].map((x, i) => (
            <line key={"brace-" + i} x1={x} y1="36" x2={x + (i % 2 === 0 ? 10 : -10)} y2="48" stroke="#263443" strokeWidth="1" />
          ))}

          {/* Moving heads + beams. The angle is scene state; small sinusoidal drift is presentation only. */}
          {fixtureX.map((x, i) => {
            const base = scene.angles[i];
            const drift = sceneId === "chorus" ? Math.sin(phase * 0.13 + i * 1.4) * 4.2 : sceneId === "verse" ? Math.sin(phase * 0.08 + i) * 1.8 : 0;
            const angle = base + drift;
            const level = scene.levels[i] * masterFactor;
            const beam = i % 2 === 0 ? "url(#beamA)" : "url(#beamB)";
            return (
              <g key={"fixture-" + i}>
                <g transform={"rotate(" + angle + " " + x + " 60)"} style={{ transition: sceneId === "chorus" ? "none" : "transform 700ms cubic-bezier(.2,.75,.2,1)" }}>
                  <path d={"M " + (x - 5) + " 64 L " + (x - 38) + " 240 L " + (x + 38) + " 240 L " + (x + 5) + " 64 Z"} fill={beam} opacity={0.08 + level * (0.28 + hazeFactor * 0.48)} />
                  <ellipse cx={x} cy="61" rx="8" ry="6" fill="#121B26" stroke="#46576B" strokeWidth="1" />
                  <circle cx={x} cy="62" r="4.6" fill={i % 2 === 0 ? scene.primary : scene.secondary} opacity={0.28 + level * 0.72} />
                  <circle cx={x} cy="62" r="2" fill="#F8FBFF" opacity={level > 0 ? 0.55 + beat * 0.25 : 0.08} />
                </g>
                <rect x={x - 6} y="48" width="12" height="7" rx="2" fill="#17212D" stroke="#364657" />
              </g>
            );
          })}

          {/* Haze: deliberately local animation driven from one shared percentage. */}
          {[0, 1, 2, 3, 4, 5].map((n) => {
            const driftX = ((phase * (0.45 + n * 0.07) + n * 71) % 430) - 45;
            const y = 105 + n * 25 + Math.sin(phase * 0.08 + n) * 8;
            return <ellipse key={"haze-" + n} cx={driftX} cy={y} rx={68 + n * 5} ry={12 + n * 2} fill="#CDEBFF" opacity={hazeFactor * (0.018 + n * 0.004)} />;
          })}

          {/* Stage floor and pooled colour. */}
          <path d="M 18 238 L 342 238 L 360 300 L 0 300 Z" fill="#080B10" />
          <ellipse cx="180" cy="255" rx="150" ry="50" fill="url(#floorGlow)" />
          <line x1="18" y1="238" x2="342" y2="238" stroke="#2A3441" />

          {/* Three performer silhouettes for scale. */}
          <g opacity={sceneId === "blackout" ? 0.34 : 0.76} style={{ transition: "opacity 400ms" }}>
            <circle cx="180" cy="181" r="7" fill="#050608" stroke="#273140" />
            <path d="M 173 191 Q 180 186 187 191 L 190 226 L 170 226 Z" fill="#050608" stroke="#273140" />
            <line x1="180" y1="198" x2="180" y2="165" stroke="#303B49" strokeWidth="2" />
            <circle cx="180" cy="162" r="2.5" fill="#455467" />

            <circle cx="128" cy="198" r="5" fill="#050608" stroke="#273140" />
            <path d="M 122 205 L 134 205 L 138 230 L 118 230 Z" fill="#050608" stroke="#273140" />
            <line x1="130" y1="207" x2="144" y2="190" stroke="#445161" strokeWidth="2" />

            <circle cx="234" cy="196" r="5" fill="#050608" stroke="#273140" />
            <path d="M 228 203 L 240 203 L 244 230 L 224 230 Z" fill="#050608" stroke="#273140" />
            <ellipse cx="249" cy="217" rx="13" ry="8" fill="none" stroke="#2D3947" strokeWidth="2" />
          </g>

          {/* Front-of-stage practicals. */}
          {[72, 126, 180, 234, 288].map((x, i) => (
            <g key={"foot-" + i}>
              <rect x={x - 8} y="234" width="16" height="5" rx="2" fill="#121923" stroke="#2D3947" />
              <circle cx={x} cy="236" r="2.4" fill={scene.accent} opacity={(0.12 + masterFactor * 0.62) * (i % 2 ? 0.78 : 1)} />
            </g>
          ))}

          {/* Crowd silhouettes at the bottom edge. */}
          {[12, 29, 48, 70, 92, 116, 139, 162, 187, 211, 236, 261, 286, 311, 334, 350].map((x, i) => {
            const bob = Math.sin(phase * 0.19 + i * 0.8) * (sceneId === "chorus" ? 2.2 : 0.8);
            return (
              <g key={"crowd-" + i} transform={"translate(0 " + bob + ")"} opacity="0.82">
                <circle cx={x} cy={276 - (i % 3) * 2} r="5" fill="#020304" />
                <path d={"M " + (x - 7) + " 300 Q " + x + " 278 " + (x + 7) + " 300 Z"} fill="#020304" />
              </g>
            );
          })}

          {/* Scene label is intentionally part of the stage rather than another card. */}
          <g>
            <rect x="134" y="88" width="92" height="22" rx="11" fill="#05070B" opacity="0.86" stroke={scene.primary} strokeOpacity="0.35" />
            <text x="180" y="102" textAnchor="middle" fill={sceneId === "blackout" ? "#8390A0" : "#F2F7FB"} fontSize="8" fontWeight="700" letterSpacing="1.4">{scene.short}</text>
          </g>

          {strobe && (
            <g>
              <rect x="0" y="0" width="360" height="300" fill="#FFFFFF" opacity={phase % 4 < 2 ? 0.95 : 0.14} />
              <rect x="4" y="4" width="352" height="292" rx="10" fill="none" stroke="#FFFFFF" strokeWidth="2" opacity="0.8" />
            </g>
          )}
        </svg>

        <div style={{ position: "absolute", left: 10, bottom: 9, display: "flex", gap: 7, alignItems: "center", pointerEvents: "none" }}>
          <span style={{ fontSize: 7, color: "#8592A2", padding: "3px 6px", border: "1px solid #263140", borderRadius: 99, background: "#070A0ECC" }}>8/8 FIXTURES</span>
          <span style={{ fontSize: 7, color: "#8592A2", padding: "3px 6px", border: "1px solid #263140", borderRadius: 99, background: "#070A0ECC" }}>DMX HEALTHY</span>
          <span style={{ fontSize: 7, color: "#8592A2", padding: "3px 6px", border: "1px solid #263140", borderRadius: 99, background: "#070A0ECC" }}>128 BPM</span>
        </div>
      </div>

      <div style={{ marginTop: 10, padding: 9, borderRadius: 11, border: "1px solid #263140", background: "#0A0E14" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 7 }}>
          <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: "0.12em", color: "#7F8C9D" }}>CUE STACK</span>
          <span style={{ fontSize: 8, color: "#647386" }}>{lastCue && lastCue.label ? "Last: " + String(lastCue.label) : "Ready"}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: 6 }}>
          {CUES.map((cue, index) => {
            const s = SCENES[cue.id];
            const active = cue.id === sceneId;
            return (
              <button
                key={cue.id}
                onClick={() => aeolus.fire(cue.event)}
                style={{
                  position: "relative",
                  overflow: "hidden",
                  minHeight: 42,
                  borderRadius: 8,
                  border: "1px solid " + (active ? s.primary + "88" : "#2B3542"),
                  background: active ? "linear-gradient(180deg," + s.primary + "22,#0A0E14)" : "#0C1118",
                  color: active ? "#F5F8FC" : "#8D9AAA",
                  cursor: "pointer",
                  transition: "all 180ms ease",
                  boxShadow: active ? "inset 0 -2px 0 " + s.primary + "66" : "none",
                }}
              >
                <div style={{ fontSize: 7, color: active ? s.primary : "#586677", fontFamily: "monospace", marginBottom: 3 }}>{String(index + 1).padStart(2, "0")}</div>
                <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: "0.04em" }}>{s.short}</div>
                {active && <div style={{ position: "absolute", top: 5, right: 6, width: 4, height: 4, borderRadius: "50%", background: s.primary, boxShadow: "0 0 8px " + s.primary }} />}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.25fr 1fr", gap: 9, marginTop: 9 }}>
        <div style={{ border: "1px solid #263140", borderRadius: 11, padding: 10, background: "#0A0E14" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 7 }}>
            <div>
              <div style={{ fontSize: 8, color: "#7F8C9D", fontWeight: 800, letterSpacing: "0.1em" }}>MASTER</div>
              <div style={{ fontSize: 7, color: "#536173", marginTop: 2 }}>Shared show intensity</div>
            </div>
            <div style={{ fontFamily: "monospace", fontSize: 15, fontWeight: 800, color: sceneId === "blackout" ? "#697687" : scene.primary }}>{master}%</div>
          </div>
          <input
            aria-label="Master intensity"
            type="range"
            min={0}
            max={100}
            value={master}
            onChange={(e) => setMaster(Number(e.target.value))}
            onMouseUp={(e) => commitMaster(Number((e.target as HTMLInputElement).value))}
            onTouchEnd={(e) => commitMaster(Number((e.target as HTMLInputElement).value))}
            style={{ width: "100%", accentColor: scene.primary }}
          />
          <div style={{ height: 5, borderRadius: 99, marginTop: 5, background: "#151D27", overflow: "hidden" }}>
            <div style={{ width: master + "%", height: "100%", background: "linear-gradient(90deg," + scene.secondary + "," + scene.primary + ")", transition: "width 120ms" }} />
          </div>
        </div>

        <div style={{ border: "1px solid #263140", borderRadius: 11, padding: 10, background: "#0A0E14" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 7 }}>
            <div>
              <div style={{ fontSize: 8, color: "#7F8C9D", fontWeight: 800, letterSpacing: "0.1em" }}>ATMOSPHERE</div>
              <div style={{ fontSize: 7, color: "#536173", marginTop: 2 }}>Shared haze target</div>
            </div>
            <div style={{ fontFamily: "monospace", fontSize: 15, fontWeight: 800, color: "#A9CBE5" }}>{haze}%</div>
          </div>
          <input
            aria-label="Haze level"
            type="range"
            min={0}
            max={100}
            value={haze}
            onChange={(e) => setHaze(Number(e.target.value))}
            onMouseUp={(e) => commitHaze(Number((e.target as HTMLInputElement).value))}
            onTouchEnd={(e) => commitHaze(Number((e.target as HTMLInputElement).value))}
            style={{ width: "100%", accentColor: "#8DCBEB" }}
          />
          <div style={{ height: 5, borderRadius: 99, marginTop: 5, background: "#151D27", overflow: "hidden" }}>
            <div style={{ width: haze + "%", height: "100%", background: "linear-gradient(90deg,#425466,#A9D8F4)", transition: "width 120ms" }} />
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.15fr 1fr 1fr", gap: 7, marginTop: 9 }}>
        <button
          onClick={() => aeolus.fire(armed ? "disarm" : "arm")}
          style={{
            borderRadius: 9,
            minHeight: 40,
            border: "1px solid " + (armed ? "#EF44445C" : "#22C55E55"),
            background: armed ? "#EF444412" : "#22C55E10",
            color: armed ? "#FF7777" : "#62DD88",
            fontWeight: 800,
            fontSize: 9,
            letterSpacing: "0.04em",
            cursor: "pointer",
          }}
        >
          {armed ? "DISARM FX" : "ARM FX INTERLOCK"}
        </button>
        <button
          onClick={() => aeolus.fire("fog")}
          disabled={!armed}
          style={{ borderRadius: 9, minHeight: 40, border: "1px solid " + (armed ? "#63B8E855" : "#2A3441"), background: armed ? "#3BA4FF12" : "#0C1118", color: armed ? "#76C9F7" : "#536173", fontWeight: 800, fontSize: 9, cursor: armed ? "pointer" : "not-allowed" }}
        >
          HAZE BURST
        </button>
        <button
          onClick={() => aeolus.fire("strobe")}
          disabled={!armed}
          style={{ borderRadius: 9, minHeight: 40, border: "1px solid " + (armed ? "#C767F255" : "#2A3441"), background: armed ? "#A855F712" : "#0C1118", color: armed ? "#D894F8" : "#536173", fontWeight: 800, fontSize: 9, cursor: armed ? "pointer" : "not-allowed" }}
        >
          STROBE HIT
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 8, padding: "0 2px" }}>
        <span style={{ fontSize: 7, color: "#526072" }}>All controls enter trusted Logic · numeric payloads are clamped before MQTT/state changes</span>
        <span style={{ fontSize: 7, color: armed ? "#7F8C9D" : "#526072" }}>{armed ? "FX requests are engine-gated" : "Physical FX locked safe"}</span>
      </div>
    </div>
  );
}`;

const automations = [
  {
    key: "show",
    name: "Stage Control",
    triggerTopic: "none",
    scriptSource: logic,
    uiSource: ui,
    demoAccess: {
      fireEvents: [
        "arm",
        "disarm",
        "cue-wash",
        "cue-verse",
        "cue-chorus",
        "cue-red",
        "cue-blackout",
        "set-master",
        "set-haze",
        "fog",
        "strobe",
      ],
    },
  },
];

const panes = [
  { kind: "automation", ref: "show", x: 0, y: 0, w: 12, h: 14 },
  { kind: "device-grid", x: 0, y: 14, w: 12, h: 6 },
];

const dataStore = [
  {
    name: "show-cues",
    description: "Stage cue and physical-FX event history from the seeded show-control demo.",
    retentionDays: 7,
    records: [
      { payload: { type: "scene", cue: "wash", label: "Open Wash" }, timestamp: Date.now() - 180000 },
      { payload: { type: "scene", cue: "verse", label: "Verse" }, timestamp: Date.now() - 120000 },
      { payload: { type: "scene", cue: "chorus", label: "Chorus" }, timestamp: Date.now() - 60000 },
    ],
  },
];

export default { tab, devices, automations, panes, dataStore };
