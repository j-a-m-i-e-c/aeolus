// scripts/seed/tabs/wildlife.mjs — Offline wildlife edge station.
//
// The visual centre is an on-device AI trail-camera pipeline. Visitors can
// inject bounded native/predator detections; trusted Logic classifies them,
// writes shared state and triggers a humane deterrent when armed. Smooth camera
// movement, scan lines and deterrent waves are local presentation only.

import { genSeries, noise } from "../lib.mjs";

const tab = { id: "tab-wildlife", name: "Wildlife", icon: "paw-print" };

const devices = [
  { topic: "camera/trailcam-01/status", payload: { online: true, npu: "Hailo-8L", fps: 30, latencyMs: 17 } },
  { topic: "sensor/nestbox-01", payload: { temp: 34.4, humidity: 56, occupied: true, chicks: 3, visitsToday: 11 } },
  { topic: "switch/deterrent-01", payload: { on: false, armed: true, mode: "ultrasonic-light" } },
  { topic: "sensor/site-power", payload: { solarW: 41, battery: 87 } },
];

const logic = `automation({
  actions: [
    function wildlife(context) {
      function init(key, value) {
        if (state.get(key) === undefined) state.set(key, value);
      }
      var now = Date.now();
      init("speciesKey", "ringtail-possum");
      init("speciesLabel", "Ringtail Possum");
      init("confidence", 0.91);
      init("category", "native");
      init("detectedAt", now - 16000);
      init("armed", true);
      init("deterrentUntil", 0);
      init("nativeIndex", 0);
      init("detectionsToday", 47);
      init("nativeToday", 39);
      init("threatsToday", 8);
      init("nestTemp", 34.4);
      init("nestHumidity", 56);
      init("chicks", 3);
      init("nestVisits", 11);
      init("battery", 87);
      init("lastAction", { label: "Edge station scanning locally", at: now });

      function record(key, label, category, confidence) {
        state.set("speciesKey", key);
        state.set("speciesLabel", label);
        state.set("category", category);
        state.set("confidence", confidence);
        state.set("detectedAt", now);
        state.set("detectionsToday", Number(state.get("detectionsToday") || 0) + 1);
        if (category === "native") state.set("nativeToday", Number(state.get("nativeToday") || 0) + 1);
        if (category === "predator") state.set("threatsToday", Number(state.get("threatsToday") || 0) + 1);
        var armed = Boolean(state.get("armed"));
        if (category === "predator" && armed) {
          state.set("deterrentUntil", now + 7000);
          mqtt.publish("switch/deterrent-01", JSON.stringify({ on: true, armed: true, mode: "ultrasonic-light", species: label }));
          mqtt.publish("alerts/predator", JSON.stringify({ species: label, confidence: confidence, ts: now }));
          state.set("lastAction", { label: label + " detected — humane deterrent active", at: now });
        } else {
          state.set("lastAction", { label: label + " classified on-device", at: now });
        }
        try { if (db) db.write("wildlife-events", { species: label, category: category, confidence: confidence }); } catch (e) {}
      }

      var evt = String(context.topic || "").split("/").pop();
      if (evt === "native-detection") {
        var natives = [
          ["ringtail-possum", "Ringtail Possum", 0.94],
          ["echidna", "Short-beaked Echidna", 0.89],
          ["lyrebird", "Superb Lyrebird", 0.96]
        ];
        var idx = (Number(state.get("nativeIndex") || 0) + 1) % natives.length;
        state.set("nativeIndex", idx);
        record(natives[idx][0], natives[idx][1], "native", natives[idx][2]);
      } else if (evt === "fox-detection") {
        record("red-fox", "Red Fox", "predator", 0.97);
      } else if (evt === "cat-detection") {
        record("feral-cat", "Feral Cat", "predator", 0.93);
      } else if (evt === "arm-deterrent") {
        state.set("armed", true);
        state.set("lastAction", { label: "Predator deterrent armed", at: now });
        mqtt.publish("switch/deterrent-01", JSON.stringify({ on: false, armed: true, mode: "ultrasonic-light" }));
      } else if (evt === "disarm-deterrent") {
        state.set("armed", false);
        state.set("deterrentUntil", 0);
        state.set("lastAction", { label: "Predator deterrent disarmed", at: now });
        mqtt.publish("switch/deterrent-01", JSON.stringify({ on: false, armed: false, mode: "ultrasonic-light" }));
      } else if (evt === "nest-visit") {
        state.set("nestVisits", Number(state.get("nestVisits") || 0) + 1);
        state.set("nestTemp", Math.min(36, Number(state.get("nestTemp") || 34.4) + 0.2));
        state.set("lastAction", { label: "Nest-box visit recorded", at: now });
        mqtt.publish("sensor/nestbox-01", JSON.stringify({ temp: state.get("nestTemp"), humidity: 56, occupied: true, chicks: 3, visitsToday: state.get("nestVisits") }));
      } else if (evt === "reset-wildlife") {
        state.set("speciesKey", "ringtail-possum");
        state.set("speciesLabel", "Ringtail Possum");
        state.set("confidence", 0.91);
        state.set("category", "native");
        state.set("detectedAt", now - 16000);
        state.set("armed", true);
        state.set("deterrentUntil", 0);
        state.set("detectionsToday", 47);
        state.set("nativeToday", 39);
        state.set("threatsToday", 8);
        state.set("nestTemp", 34.4);
        state.set("nestVisits", 11);
        state.set("lastAction", { label: "Edge station reset to dawn state", at: now });
      }
    },
  ],
});`;

const ui = `import { useEffect, useState } from "react";
import type { CustomComponentProps } from "./types";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function Animal(props: { kind: string; x: number; y: number; color: string; opacity: number }) {
  const k = props.kind;
  const x = props.x;
  const y = props.y;
  if (k === "red-fox") return <g transform={"translate(" + x + " " + y + ")"} fill={props.color} stroke={props.color} opacity={props.opacity}>
    <ellipse cx="0" cy="0" rx="29" ry="12" />
    <circle cx="26" cy="-8" r="10" />
    <path d="M21 -16 L24 -28 L30 -17 M29 -17 L36 -27 L36 -13" fill={props.color} />
    <path d="M-25 -2 Q-55 -20 -64 -2 Q-49 4 -28 7" fill="none" strokeWidth="10" strokeLinecap="round" />
    <line x1="-15" y1="9" x2="-18" y2="25" strokeWidth="5" strokeLinecap="round" />
    <line x1="15" y1="9" x2="18" y2="25" strokeWidth="5" strokeLinecap="round" />
  </g>;
  if (k === "feral-cat") return <g transform={"translate(" + x + " " + y + ")"} fill={props.color} stroke={props.color} opacity={props.opacity}>
    <ellipse cx="0" cy="0" rx="23" ry="10" />
    <circle cx="20" cy="-8" r="8" />
    <path d="M15 -14 L17 -24 L22 -15 M22 -15 L28 -23 L28 -11" />
    <path d="M-21 -4 Q-45 -17 -43 -36" fill="none" strokeWidth="5" strokeLinecap="round" />
    <line x1="-11" y1="8" x2="-13" y2="23" strokeWidth="4" /><line x1="12" y1="8" x2="14" y2="23" strokeWidth="4" />
  </g>;
  if (k === "echidna") return <g transform={"translate(" + x + " " + y + ")"} fill={props.color} stroke={props.color} opacity={props.opacity}>
    <path d="M-29 7 Q-23 -17 5 -18 Q25 -17 30 3 Q20 15 -5 15 Q-21 15 -29 7 Z" />
    {[-20,-12,-4,4,12,20].map((v) => <line key={v} x1={v} y1="-11" x2={v - 5} y2="-27" strokeWidth="2" />)}
    <path d="M27 0 L43 5 L29 8" />
  </g>;
  if (k === "lyrebird") return <g transform={"translate(" + x + " " + y + ")"} fill={props.color} stroke={props.color} opacity={props.opacity}>
    <ellipse cx="0" cy="0" rx="15" ry="11" /><circle cx="14" cy="-8" r="6" /><path d="M18 -9 L28 -6 L18 -4" />
    <path d="M-13 -3 Q-38 -25 -49 -15 M-13 -1 Q-41 -8 -52 4 M-13 2 Q-38 13 -47 24" fill="none" strokeWidth="3" strokeLinecap="round" />
    <line x1="-3" y1="9" x2="-5" y2="23" strokeWidth="2" /><line x1="5" y1="9" x2="8" y2="23" strokeWidth="2" />
  </g>;
  return <g transform={"translate(" + x + " " + y + ")"} fill={props.color} stroke={props.color} opacity={props.opacity}>
    <ellipse cx="0" cy="0" rx="24" ry="13" /><circle cx="22" cy="-9" r="8" /><circle cx="18" cy="-17" r="4" /><circle cx="26" cy="-17" r="4" />
    <path d="M-22 -3 Q-48 -18 -52 -2 Q-53 13 -40 13" fill="none" strokeWidth="4" strokeLinecap="round" />
    <line x1="-10" y1="10" x2="-11" y2="24" strokeWidth="4" /><line x1="12" y1="10" x2="13" y2="24" strokeWidth="4" />
  </g>;
}

export default function WildlifeEdgeStation(aeolus: CustomComponentProps) {
  const speciesKey = String(aeolus.read("speciesKey") ?? "ringtail-possum");
  const speciesLabel = String(aeolus.read("speciesLabel") ?? "Ringtail Possum");
  const confidence = Number(aeolus.read("confidence") ?? .91);
  const category = String(aeolus.read("category") ?? "native");
  const detectedAt = Number(aeolus.read("detectedAt") ?? 0);
  const armed = Boolean(aeolus.read("armed") ?? true);
  const deterrentUntil = Number(aeolus.read("deterrentUntil") ?? 0);
  const detectionsToday = Number(aeolus.read("detectionsToday") ?? 47);
  const nativeToday = Number(aeolus.read("nativeToday") ?? 39);
  const threatsToday = Number(aeolus.read("threatsToday") ?? 8);
  const nestTemp = Number(aeolus.read("nestTemp") ?? 34.4);
  const nestHumidity = Number(aeolus.read("nestHumidity") ?? 56);
  const chicks = Number(aeolus.read("chicks") ?? 3);
  const nestVisits = Number(aeolus.read("nestVisits") ?? 11);
  const battery = Number(aeolus.read("battery") ?? 87);
  const lastAction = aeolus.read("lastAction") as any;

  const [now, setNow] = useState(Date.now());
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const id = setInterval(() => { setNow(Date.now()); setPhase((v) => (v + 1) % 100000); }, 90);
    return () => clearInterval(id);
  }, []);

  const age = detectedAt ? Math.max(0, now - detectedAt) : 999999;
  const active = age < 12000;
  const travel = clamp(age / 9000, 0, 1);
  const animalX = 105 + travel * 380;
  const animalY = 260 + Math.sin(travel * Math.PI * 3) * 5;
  const predator = category === "predator";
  const deterrentActive = now < deterrentUntil;
  const boxColor = predator ? "#FF766D" : "#71E6A0";
  const animalColor = predator ? "#E96C61" : "#9ED8B1";
  const actionLabel = lastAction && lastAction.label ? String(lastAction.label) : "Edge station scanning locally";
  const pipelinePulse = (phase * 3.2) % 420;

  return (
    <div style={{ minHeight: "100%", padding: 14, color: "#E8EEF5", background: "linear-gradient(180deg,#07100C 0%,#050A08 100%)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 10 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 850, letterSpacing: "0.025em" }}>WILDLIFE EDGE STATION</span>
            <span style={{ fontSize: 8, border: "1px solid #285B3B", background: "#0C2115", borderRadius: 999, padding: "2px 7px", color: "#72E09A", letterSpacing: "0.1em" }}>HAILO-8L · OFFLINE AI</span>
          </div>
          <div style={{ color: "#66786C", fontSize: 9, marginTop: 3 }}>Trail-camera inference · biodiversity logging · nest telemetry · non-lethal predator response</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: predator && active ? "#FF776D" : "#77E39B", fontSize: 10, fontWeight: 850 }}>{predator && active ? "INTRODUCED PREDATOR" : "SITE MONITORING"}</div>
          <div style={{ color: "#637167", fontSize: 8, marginTop: 2 }}>{actionLabel}</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.6fr) minmax(215px,.72fr)", gap: 10 }}>
        <div style={{ border: "1px solid #28372D", borderRadius: 14, overflow: "hidden", background: "#030805" }}>
          <svg width="100%" height="400" viewBox="0 0 530 400" preserveAspectRatio="xMidYMid meet">
            <defs>
              <linearGradient id="forestNight" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0B1A12"/><stop offset="1" stopColor="#041008"/></linearGradient>
              <linearGradient id="irCone" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#8CDDA6" stopOpacity=".18"/><stop offset="1" stopColor="#8CDDA6" stopOpacity="0"/></linearGradient>
              <filter id="wildGlow"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
            </defs>
            <rect width="530" height="400" fill="url(#forestNight)" />
            <circle cx="444" cy="50" r="27" fill="#C8E5D1" opacity=".12" />

            {/* Distant forest layers. */}
            {[20,72,130,188,245,315,390,462,510].map((x, i) => <g key={i} opacity={.34 + (i % 3) * .08}>
              <rect x={x} y={110 + (i % 4) * 13} width={7 + (i % 3) * 3} height={185} fill="#102A18" />
              <circle cx={x + 4} cy={116 + (i % 4) * 13} r={28 + (i % 2) * 9} fill="#12371E" />
              <circle cx={x - 12} cy={135 + (i % 3) * 9} r={18} fill="#102E1A" />
            </g>)}
            <path d="M0 297 Q90 277 175 300 T350 293 T530 298 V400 H0 Z" fill="#07170C" />
            <path d="M0 322 Q115 296 230 325 T530 316" fill="none" stroke="#173720" strokeWidth="2" />

            {/* Trail camera and its detection cone. */}
            <path d="M54 237 L430 177 L430 335 Z" fill="url(#irCone)" />
            <rect x="35" y="213" width="35" height="48" rx="5" fill="#101A14" stroke="#568868" strokeWidth="1.3" />
            <circle cx="53" cy="228" r="7" fill="#020603" stroke="#72AD80" />
            <circle cx="53" cy="228" r="2.5" fill="#72E09A" opacity={.55 + Math.sin(phase * .2) * .25} />
            <rect x="43" y="243" width="20" height="7" rx="2" fill="#233B2A" />
            <text x="52" y="274" textAnchor="middle" fill="#62816B" fontSize="6">CAM-01</text>

            {/* Animal rendered as a silhouette, not an emoji. */}
            {active && <Animal kind={speciesKey} x={animalX} y={animalY} color={animalColor} opacity={.84} />}

            {/* Detection box tracks the moving animal. */}
            {active && <g>
              <rect x={animalX - 70} y={animalY - 52} width="140" height="91" fill="none" stroke={boxColor} strokeWidth="1.2" />
              <path d={"M" + (animalX - 70) + " " + (animalY - 40) + " V" + (animalY - 52) + " H" + (animalX - 58)} fill="none" stroke={boxColor} strokeWidth="2.2" />
              <path d={"M" + (animalX + 70) + " " + (animalY + 27) + " V" + (animalY + 39) + " H" + (animalX + 58)} fill="none" stroke={boxColor} strokeWidth="2.2" />
              <rect x={animalX - 70} y={animalY - 68} width="140" height="16" rx="2" fill={boxColor} />
              <text x={animalX - 64} y={animalY - 57} fill="#051008" fontSize="7" fontWeight="800">{speciesLabel.toUpperCase()} · {Math.round(confidence * 100)}%</text>
            </g>}

            {/* Humane deterrent on the far side of the trail. */}
            <g transform="translate(476 248)">
              <rect x="-15" y="-23" width="30" height="46" rx="5" fill="#101914" stroke={armed ? "#63B97D" : "#4C5750"} />
              <circle cx="0" cy="-8" r="7" fill={deterrentActive ? "#FF6D63" : "#25352B"} stroke={deterrentActive ? "#FF9A92" : "#577061"} />
              <rect x="-7" y="6" width="14" height="8" rx="2" fill="#26382D" />
              <text x="0" y="35" textAnchor="middle" fill="#66786B" fontSize="6">DETERRENT</text>
              {deterrentActive && [1,2,3,4].map((i) => <path key={i} d={"M" + (-16 - i * 9) + " " + (-18 - i * 4) + " Q" + (-28 - i * 10) + " 0 " + (-16 - i * 9) + " " + (18 + i * 4)} fill="none" stroke="#FF756B" strokeOpacity={1 - i * .16} strokeWidth="1.6" />)}
            </g>

            {/* Scan lines / camera overlay. */}
            {Array.from({ length: 18 }).map((_, i) => <line key={i} x1="0" y1={i * 22 + (phase % 22)} x2="530" y2={i * 22 + (phase % 22)} stroke="#DDFCE6" strokeOpacity=".018" />)}
            <text x="15" y="20" fill="#FF766D" fontSize="8" fontWeight="800">● REC</text>
            <text x="514" y="20" textAnchor="end" fill="#83A78C" fontFamily="monospace" fontSize="7">30 FPS · 17 ms · IR</text>
            {!active && <text x="265" y="197" textAnchor="middle" fill="#5D7765" fontSize="9" letterSpacing="1.2">SCANNING TRAIL CORRIDOR…</text>}
          </svg>

          {/* Edge pipeline lives visually underneath the camera, not as generic metric cards. */}
          <div style={{ height: 52, borderTop: "1px solid #1F3025", background: "#07100B", position: "relative", display: "flex", alignItems: "center", justifyContent: "space-around", padding: "0 14px" }}>
            {[{n:"CAMERA",s:"30 FPS"},{n:"HAILO-8L",s:"17 ms inference"},{n:"AEOLUS",s:"local Logic"},{n:"RESPONSE",s:armed ? "armed" : "disarmed"}].map((n, i) => <div key={n.n} style={{ zIndex: 2, textAlign: "center", width: "22%" }}><div style={{ color: i === 2 ? "#77DDA0" : "#9AABA0", fontSize: 8, fontWeight: 800, letterSpacing: ".08em" }}>{n.n}</div><div style={{ color: "#536459", fontSize: 6.5, marginTop: 2 }}>{n.s}</div></div>)}
            <div style={{ position: "absolute", left: "11%", right: "11%", top: 22, height: 1, background: "#254331" }} />
            <div style={{ position: "absolute", left: "calc(11% + " + pipelinePulse + "px)", top: 19, width: 7, height: 7, borderRadius: 99, background: predator && active ? "#FF756B" : "#6BE09A", boxShadow: "0 0 12px currentColor", opacity: pipelinePulse < 410 ? .85 : 0 }} />
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ border: "1px solid #28372D", borderRadius: 12, background: "#07100B", padding: 11 }}>
            <div style={{ color: "#788A7E", fontSize: 8, letterSpacing: ".12em", marginBottom: 8 }}>TODAY AT THE EDGE</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}><span style={{ color: "#E5EFE8", fontSize: 28, fontFamily: "monospace", fontWeight: 850 }}>{detectionsToday}</span><span style={{ color: "#617167", fontSize: 8 }}>detections</span></div>
            <div style={{ height: 5, background: "#142019", borderRadius: 99, overflow: "hidden", marginTop: 8 }}><div style={{ width: (nativeToday / Math.max(1,detectionsToday) * 100) + "%", height: "100%", background: "#66D990" }} /></div>
            <div style={{ display: "flex", justifyContent: "space-between", color: "#66776C", fontSize: 7, marginTop: 5 }}><span>{nativeToday} native</span><span style={{ color: threatsToday > 0 ? "#C47A70" : "#66776C" }}>{threatsToday} introduced</span></div>
          </div>

          <div style={{ flex: 1, border: "1px solid #28372D", borderRadius: 12, background: "#07100B", padding: 11, position: "relative", minHeight: 205 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span style={{ color: "#788A7E", fontSize: 8, letterSpacing: ".12em" }}>NEST BOX 01</span><span style={{ color: "#6FD997", fontSize: 8, fontWeight: 800 }}>OCCUPIED</span></div>
            <svg width="100%" height="105" viewBox="0 0 190 105">
              <rect x="67" y="18" width="58" height="69" rx="4" fill="#17251B" stroke="#4A7658" />
              <circle cx="96" cy="44" r="13" fill="#050B07" stroke="#3D634A" />
              <rect x="77" y="67" width="38" height="12" rx="5" fill="#293C2D" />
              {[0,1,2].map((i) => <g key={i}><circle cx={87 + i * 9} cy="66" r="4" fill="#A9C796" /><path d={"M" + (84 + i * 9) + " 63 L" + (87 + i * 9) + " 57 L" + (90 + i * 9) + " 63"} fill="#A9C796" /></g>)}
              <line x1="96" y1="87" x2="96" y2="103" stroke="#405A46" strokeWidth="3" />
              <text x="12" y="31" fill="#677A6C" fontSize="7">BROOD</text><text x="12" y="46" fill="#E1ECE4" fontFamily="monospace" fontSize="12">{nestTemp.toFixed(1)}°C</text>
              <text x="141" y="31" fill="#677A6C" fontSize="7">HUMID</text><text x="141" y="46" fill="#E1ECE4" fontFamily="monospace" fontSize="12">{nestHumidity}%</text>
            </svg>
            <div style={{ display: "flex", justifyContent: "space-between", color: "#66776C", fontSize: 7 }}><span>{chicks} chicks</span><span>{nestVisits} visits today</span></div>
          </div>

          <div style={{ border: "1px solid #28372D", borderRadius: 12, background: "#07100B", padding: "9px 11px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div><div style={{ color: "#788A7E", fontSize: 7, letterSpacing: ".1em" }}>SOLAR NODE</div><div style={{ color: "#E1ECE4", fontFamily: "monospace", fontSize: 11, marginTop: 3 }}>41 W · {battery}%</div></div>
            <div style={{ width: 42, height: 7, background: "#17231B", borderRadius: 99, overflow: "hidden" }}><div style={{ width: battery + "%", height: "100%", background: battery > 40 ? "#67D991" : "#F1B551" }} /></div>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1.15fr .9fr", gap: 7, marginTop: 9 }}>
        <button onClick={() => aeolus.fire("native-detection")} style={{ padding: "8px 6px", borderRadius: 8, border: "1px solid #31563D", background: "#0A1710", color: "#78D99A", fontSize: 9, fontWeight: 800 }}>SIMULATE NATIVE</button>
        <button onClick={() => aeolus.fire("fox-detection")} style={{ padding: "8px 6px", borderRadius: 8, border: "1px solid #673A36", background: "#180C0C", color: "#E9847A", fontSize: 9, fontWeight: 800 }}>RED FOX</button>
        <button onClick={() => aeolus.fire("cat-detection")} style={{ padding: "8px 6px", borderRadius: 8, border: "1px solid #5B4433", background: "#15100B", color: "#D6A46C", fontSize: 9, fontWeight: 800 }}>FERAL CAT</button>
        <button onClick={() => aeolus.fire(armed ? "disarm-deterrent" : "arm-deterrent")} style={{ padding: "8px 6px", borderRadius: 8, border: "1px solid " + (armed ? "#3D6849" : "#4A4F4B"), background: armed ? "#0B1810" : "#0D100E", color: armed ? "#72D993" : "#858E88", fontSize: 9, fontWeight: 800 }}>{armed ? "DETERRENT · ARMED" : "ARM DETERRENT"}</button>
        <button onClick={() => aeolus.fire("nest-visit")} style={{ padding: "8px 6px", borderRadius: 8, border: "1px solid #33473A", background: "#0B120D", color: "#9BB4A3", fontSize: 9, fontWeight: 800 }}>NEST VISIT</button>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, color: "#5D6B61", fontSize: 8 }}>
        <span>Detection and response state is shared · all inference is represented as local edge events</span>
        <button onClick={() => aeolus.fire("reset-wildlife")} style={{ border: 0, background: "transparent", color: "#6F7F74", cursor: "pointer", fontSize: 8 }}>RESET STATION</button>
      </div>
    </div>
  );
}`;

const automations = [
  {
    key: "wildlife",
    name: "Wildlife Edge Station",
    triggerTopic: "none",
    scriptSource: logic,
    uiSource: ui,
    demoAccess: {
      fireEvents: ["native-detection", "fox-detection", "cat-detection", "arm-deterrent", "disarm-deterrent", "nest-visit", "reset-wildlife"],
    },
  },
];

const panes = [
  { kind: "automation", ref: "wildlife", x: 0, y: 0, w: 12, h: 17 },
  { kind: "device-grid", x: 0, y: 17, w: 12, h: 5 },
];

const dataStore = [
  {
    name: "wildlife-events",
    description: "Classified on-device wildlife detections",
    retentionDays: 90,
    // Seeded history so the collection is populated on first load; the seeded
    // Logic appends live rows (same shape) as visitors trigger detections.
    records: [
      { payload: { species: "Ringtail Possum", category: "native", confidence: 0.94 }, timestamp: Date.now() - 5_400_000 },
      { payload: { species: "Superb Lyrebird", category: "native", confidence: 0.96 }, timestamp: Date.now() - 3_600_000 },
      { payload: { species: "Red Fox", category: "predator", confidence: 0.97 }, timestamp: Date.now() - 1_800_000 },
      { payload: { species: "Short-beaked Echidna", category: "native", confidence: 0.89 }, timestamp: Date.now() - 600_000 },
    ],
  },
  {
    name: "wildlife-detections",
    description: "Hourly native and introduced-animal detection totals (7 days)",
    retentionDays: 90,
    records: genSeries({
      count: 168,
      intervalMs: 3_600_000,
      fields: {
        native: (i) => {
          const h = ((i % 24) + 24) % 24;
          const noct = (h >= 19 || h < 6) ? 3.2 : 0.7;
          return Math.max(0, Math.round(noct + noise(1.1)));
        },
        predator: (i) => {
          const h = ((i % 24) + 24) % 24;
          const noct = (h >= 20 || h < 6) ? 1.1 : 0.15;
          return Math.max(0, Math.round(noct + noise(0.5)));
        },
      },
    }),
  },
];

export default { tab, devices, automations, panes, dataStore };
