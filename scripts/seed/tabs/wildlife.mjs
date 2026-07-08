// scripts/seed/tabs/wildlife.mjs — Wildlife & Conservation station.
//
// The "cause" tab: an on-device AI trail camera (vision inference runs locally
// on a Pi AI accelerator — a detection is just another event), a nest-box
// monitor, a humane predator deterrent, and a biodiversity log. Solar-powered,
// offline-first, nothing leaves the site. Simulated, no keys, works offline.

import { genSeries, noise } from "../lib.mjs";

const tab = { id: "tab-wildlife", name: "Wildlife", icon: "paw-print" };

const devices = [
  { topic: "camera/trailcam-01/status", payload: { online: true, npu: "Hailo-8L", fps: 30 } },
  { topic: "camera/trailcam-01/detection", payload: { species: "ringtail-possum", confidence: 0.88 } },
  { topic: "sensor/nestbox-01", payload: { temp: 34.4, humidity: 56, occupied: true, chicks: 3 } },
  { topic: "switch/deterrent-01", payload: { on: false, mode: "ultrasonic" } },
  { topic: "sensor/site-power", payload: { solar: 41, battery: 87 } },
];

// AI Trail Camera logic — the on-device NPU publishes detections to MQTT; this
// rule classifies them and fires a deterrent when an introduced predator appears.
// Mirrors the pipeline described in docs/WHY_AEOLUS.md — a detection is just an event.
const detectionLogic = `automation({
  conditions: [
    function hasDetection(context) {
      return !!(context && context.state && context.state.species);
    },
  ],
  actions: [
    function classify(context) {
      const evt = context.state || {};
      const species = evt.species;
      const confidence = typeof evt.confidence === "number" ? evt.confidence : 0;
      state.set("lastSpecies", species);
      state.set("lastConfidence", confidence);
      if (confidence < 0.6) { return; }
      const predators = ["fox", "red-fox", "feral-cat", "wild-dog"];
      const isPredator = predators.indexOf(String(species).toLowerCase()) !== -1;
      state.set("lastPredator", isPredator);
      if (isPredator) {
        const dts = devices.filter(function (d) {
          return typeof d.id === "string" && d.id.indexOf("deterrent") !== -1;
        });
        for (let i = 0; i < dts.length; i++) { devices.action(dts[i].id, "on"); }
        mqtt.publish("alerts/predator", JSON.stringify({ species: species, ts: Date.now() }));
      }
    },
  ],
});`;

// Monitoring consoles simulated in the UI. Manual no-op logic.
const simLogic = `automation({
  conditions: [
    function ready(context) {
      return true;
    },
  ],
  actions: [
    function sim(context) {
      state.set("lastUpdate", Date.now());
    },
  ],
});`;

// ─── AI Trail Camera — on-device vision detections ───────────────────────────
const trailcamUi = `import { useState, useEffect } from "react";
import type { CustomComponentProps } from "./types";

const SPECIES = [
  { name: "Eastern Quoll", kind: "native", emoji: "🐾" },
  { name: "Ringtail Possum", kind: "native", emoji: "🐾" },
  { name: "Short-beaked Echidna", kind: "native", emoji: "🦔" },
  { name: "Superb Lyrebird", kind: "bird", emoji: "🐦" },
  { name: "Laughing Kookaburra", kind: "bird", emoji: "🐦" },
  { name: "Red Fox", kind: "predator", emoji: "🦊" },
  { name: "Feral Cat", kind: "predator", emoji: "🐈" },
  { name: "European Rabbit", kind: "feral", emoji: "🐇" },
];
const COL = { native: "#22C55E", bird: "#5CE1E6", predator: "#EF4444", feral: "#F59E0B" };
const TAG = { native: "Native", bird: "Native bird", predator: "Predator", feral: "Feral" };

function hhmmss(ts) {
  const d = new Date(ts);
  const p = (n) => (n < 10 ? "0" + n : "" + n);
  return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
}

export default function TrailCamera(aeolus: CustomComponentProps) {
  const [cur, setCur] = useState<any>(null);
  const [feed, setFeed] = useState<any[]>([]);
  const [count, setCount] = useState(0);
  const [latency, setLatency] = useState(17);

  useEffect(() => {
    let n = 0;
    const id = setInterval(() => {
      setLatency(14 + Math.round(Math.random() * 9));
      const hit = Math.random() < 0.72;
      if (!hit) { setCur(null); return; }
      const sp = SPECIES[Math.floor(Math.random() * SPECIES.length)];
      const conf = 0.62 + Math.random() * 0.37;
      const w = 24 + Math.random() * 20;
      const h = 20 + Math.random() * 15;
      const x = 8 + Math.random() * (76 - w);
      const y = 28 + Math.random() * (48 - h);
      setCur({ name: sp.name, kind: sp.kind, emoji: sp.emoji, conf, x, y, w, h });
      n += 1;
      setFeed((f) => [{ id: n, name: sp.name, kind: sp.kind, emoji: sp.emoji, conf, ts: Date.now() }, ...f].slice(0, 6));
      setCount((c) => c + 1);
      aeolus.save("lastSpecies", sp.name);
    }, 2600);
    return () => clearInterval(id);
  }, []);

  const native = feed.filter((f) => f.kind === "native" || f.kind === "bird").length;
  const threats = feed.filter((f) => f.kind === "predator" || f.kind === "feral").length;

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[#E6EDF3]">📷 AI Trail Camera</span>
          <span className="text-[8px] font-bold tracking-wide px-1.5 py-0.5 rounded-full bg-[#22C55E] text-[#05070A]">● HAILO-8L · ON-DEVICE</span>
        </div>
        <span className="text-[9px] font-mono text-[#6B7785]">30 FPS · {latency} ms · offline</span>
      </div>

      <div className="relative rounded-xl overflow-hidden border border-[#2A3441] bg-[#05070A]">
        <svg width="100%" height="200" viewBox="0 0 100 66" preserveAspectRatio="xMidYMid slice">
          <defs>
            <linearGradient id="wnight" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#0a1a10" />
              <stop offset="1" stopColor="#04120a" />
            </linearGradient>
          </defs>
          <rect x="0" y="0" width="100" height="66" fill="url(#wnight)" />
          <rect x="0" y="49" width="100" height="17" fill="#07160c" />
          <line x1="0" y1="49" x2="100" y2="49" stroke="#1b3b26" strokeWidth="0.4" />
          {[9, 22, 38, 55, 70, 86, 94].map((gx, i) => (
            <path key={i} d={"M" + gx + " 51 l-1.4 -4 M" + gx + " 51 l0 -5 M" + gx + " 51 l1.4 -4"} stroke="#1f4d2c" strokeWidth="0.4" fill="none" />
          ))}
          {[1, 2, 3, 4, 5, 6].map((r) => (
            <line key={"sl" + r} x1="0" y1={r * 10} x2="100" y2={r * 10} stroke="#ffffff" strokeOpacity="0.02" strokeWidth="1" />
          ))}
          {cur && (
            <g>
              <rect x={cur.x} y={cur.y} width={cur.w} height={cur.h} fill="none" stroke={COL[cur.kind]} strokeWidth="0.7" />
              <line x1={cur.x} y1={cur.y} x2={cur.x + 4} y2={cur.y} stroke={COL[cur.kind]} strokeWidth="1.1" />
              <line x1={cur.x} y1={cur.y} x2={cur.x} y2={cur.y + 4} stroke={COL[cur.kind]} strokeWidth="1.1" />
              <text x={cur.x + cur.w / 2} y={cur.y + cur.h / 2 + 2.5} textAnchor="middle" fontSize="7">{cur.emoji}</text>
              <rect x={cur.x} y={cur.y - 5} width={Math.max(cur.w, 26)} height="4.6" fill={COL[cur.kind]} />
              <text x={cur.x + 1} y={cur.y - 1.7} fontSize="3" fill="#05070A" fontWeight="bold">{cur.name + "  " + Math.round(cur.conf * 100) + "%"}</text>
            </g>
          )}
        </svg>
        <div className="absolute top-2 left-3 text-[10px] font-bold text-[#EF4444] tracking-wider">● REC</div>
        <div className="absolute top-2 right-3 text-[9px] font-mono text-[#9fd6b0]">CAM-01 · IR</div>
        <div className="absolute bottom-2 left-3 text-[9px] font-mono text-[#bfe6cf]">{hhmmss(Date.now())}</div>
        {!cur && <div className="absolute bottom-2 right-3 text-[9px] text-[#6B7785] animate-pulse">scanning…</div>}
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[13px] font-mono font-bold text-[#E6EDF3]">{count + 42}</span>
          <span className="text-[7px] text-[#6B7785]">Detections today</span>
        </div>
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[13px] font-mono font-bold text-[#22C55E]">{native}</span>
          <span className="text-[7px] text-[#6B7785]">Native (recent)</span>
        </div>
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[13px] font-mono font-bold" style={{ color: threats > 0 ? "#EF4444" : "#22C55E" }}>{threats}</span>
          <span className="text-[7px] text-[#6B7785]">Threats (recent)</span>
        </div>
      </div>

      <div className="space-y-1">
        {feed.length === 0 && <div className="text-[10px] text-[#6B7785]">Waiting for first detection…</div>}
        {feed.map((f) => (
          <div key={f.id} className="flex items-center gap-2 bg-[#0B0F14] rounded-md border border-[#1c2530] px-2.5 py-1.5">
            <span className="text-[14px]">{f.emoji}</span>
            <span className="text-[11px] font-medium text-[#E6EDF3] flex-1">{f.name}</span>
            <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded-full" style={{ color: COL[f.kind], border: "1px solid " + COL[f.kind] + "66" }}>{TAG[f.kind]}</span>
            <span className="text-[10px] font-mono text-[#9AA6B2]">{Math.round(f.conf * 100)}%</span>
            <span className="text-[9px] font-mono text-[#6B7785]">{hhmmss(f.ts)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}`;

// ─── Nest Box Monitor — brooding temperature, humidity, visits ───────────────
const nestUi = `import { useState, useEffect } from "react";
import type { CustomComponentProps } from "./types";

export default function NestBox(aeolus: CustomComponentProps) {
  const [temp, setTemp] = useState(34.6);
  const [hum, setHum] = useState(56);
  const [occupied, setOccupied] = useState(true);
  const [visits, setVisits] = useState(28);
  const chicks = 3, eggs = 1;

  useEffect(() => {
    const id = setInterval(() => {
      setOccupied((o) => (Math.random() < 0.12 ? !o : o));
      setTemp((t) => {
        const target = occupied ? 35.4 : 30.5;
        const nt = t + (target - t) * 0.12 + (Math.random() - 0.5) * 0.5;
        return Math.max(27, Math.min(38, nt));
      });
      setHum((h) => Math.max(45, Math.min(70, h + (Math.random() - 0.5) * 1.6)));
      if (Math.random() < 0.18) setVisits((v) => v + 1);
    }, 1600);
    return () => clearInterval(id);
  }, [occupied]);

  const tempOk = temp >= 33 && temp <= 37;
  const tempCol = tempOk ? "#22C55E" : temp < 33 ? "#3BA4FF" : "#F59E0B";
  const warmthPct = Math.max(0, Math.min(100, ((temp - 27) / 11) * 100));

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-[#E6EDF3]">🪺 Nest Box Monitor</span>
        <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: occupied ? "#22C55E20" : "#6B778520", color: occupied ? "#22C55E" : "#9AA6B2" }}>
          {occupied ? "● Brooding" : "Parent away"}
        </span>
      </div>

      <div className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-3 flex items-center gap-4">
        <div className="text-4xl">🐣</div>
        <div className="flex-1">
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-mono font-bold" style={{ color: tempCol }}>{temp.toFixed(1)}</span>
            <span className="text-sm text-[#6B7785]">°C</span>
          </div>
          <div className="text-[9px] text-[#6B7785]">nest temperature · {tempOk ? "ideal for brooding" : temp < 33 ? "cooling — parent away" : "warm"}</div>
          <div className="mt-1.5 h-1.5 rounded-full bg-[#1A2330] overflow-hidden">
            <div className="h-full rounded-full transition-all duration-700" style={{ width: warmthPct + "%", backgroundColor: tempCol }} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[13px] font-mono font-bold text-[#5CE1E6]">{Math.round(hum)}%</span>
          <span className="text-[7px] text-[#6B7785]">Humidity</span>
        </div>
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[13px] font-mono font-bold text-[#F59E0B]">{chicks} 🐤</span>
          <span className="text-[7px] text-[#6B7785]">{eggs} egg · {chicks} chicks</span>
        </div>
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[13px] font-mono font-bold text-[#22C55E]">{visits}</span>
          <span className="text-[7px] text-[#6B7785]">Feeding visits</span>
        </div>
      </div>

      <div className="text-[8px] text-[#6B7785] text-center">on-device camera counts feeding visits — no clip ever leaves the nest box</div>
    </div>
  );
}`;

// ─── Predator Deterrent — humane, non-lethal, auto-triggered ─────────────────
const deterrentUi = `import { useState, useEffect } from "react";
import type { CustomComponentProps } from "./types";

const MODES = ["Ultrasonic", "Strobe light", "Misting"];

function hhmm(ts) {
  const d = new Date(ts);
  const p = (n) => (n < 10 ? "0" + n : "" + n);
  return p(d.getHours()) + ":" + p(d.getMinutes());
}

export default function PredatorDeterrent(aeolus: CustomComponentProps) {
  const [armed, setArmed] = useState<boolean>(() => (aeolus.read("armed") as boolean) ?? true);
  const [mode, setMode] = useState<string>(() => (aeolus.read("mode") as string) ?? "Ultrasonic");
  const [firing, setFiring] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [count, setCount] = useState(4);
  const [log, setLog] = useState<any[]>(() => [
    { id: 1, sp: "Red Fox", ts: Date.now() - 1000 * 60 * 42 },
    { id: 2, sp: "Feral Cat", ts: Date.now() - 1000 * 60 * 133 },
  ]);

  const fire = (sp) => {
    if (!armed) return;
    setFiring(true);
    setCooldown(6);
    setCount((c) => c + 1);
    setLog((l) => [{ id: Date.now(), sp, ts: Date.now() }, ...l].slice(0, 5));
  };

  useEffect(() => { aeolus.save("armed", armed); }, [armed]);
  useEffect(() => { aeolus.save("mode", mode); }, [mode]);

  useEffect(() => {
    const id = setInterval(() => {
      setCooldown((c) => {
        if (c > 1) return c - 1;
        if (c === 1) { setFiring(false); return 0; }
        return 0;
      });
      if (armed && Math.random() < 0.05) {
        const sp = Math.random() < 0.6 ? "Red Fox" : "Feral Cat";
        setFiring(true);
        setCooldown(6);
        setCount((c) => c + 1);
        setLog((l) => [{ id: Date.now(), sp, ts: Date.now() }, ...l].slice(0, 5));
      }
    }, 1000);
    return () => clearInterval(id);
  }, [armed]);

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-[#E6EDF3]">🚨 Predator Deterrent</span>
        <button onClick={() => setArmed((a) => !a)} className="text-[9px] px-2.5 py-1 rounded-full font-semibold border transition-all" style={{ backgroundColor: armed ? "#22C55E15" : "#6B778515", color: armed ? "#22C55E" : "#9AA6B2", borderColor: armed ? "#22C55E4D" : "#2A3441" }}>
          {armed ? "● Armed" : "Disarmed"}
        </button>
      </div>

      <div className="rounded-xl border p-3 flex items-center gap-3 transition-all" style={{ backgroundColor: firing ? "#EF444418" : "#0B0F14", borderColor: firing ? "#EF4444" : "#2A3441" }}>
        <div className="text-3xl" style={{ opacity: firing ? 1 : 0.45 }}>{firing ? "📢" : "🛡️"}</div>
        <div className="flex-1">
          <div className="text-[13px] font-bold" style={{ color: firing ? "#EF4444" : "#E6EDF3" }}>{firing ? "DETERRENT ACTIVE" : armed ? "Armed & watching" : "Disarmed"}</div>
          <div className="text-[9px] text-[#6B7785]">{firing ? mode + " · cooldown " + cooldown + "s" : "triggers automatically on predator detection"}</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        {MODES.map((m) => (
          <button key={m} onClick={() => setMode(m)} className="py-1.5 rounded-md text-[9px] font-medium border transition-all" style={{ backgroundColor: mode === m ? "#3BA4FF20" : "#0B0F14", color: mode === m ? "#3BA4FF" : "#9AA6B2", borderColor: mode === m ? "#3BA4FF4D" : "#2A3441" }}>{m}</button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button onClick={() => fire("Manual test")} disabled={!armed} className="flex-1 py-1.5 rounded-md text-[10px] font-semibold border transition-all" style={{ backgroundColor: armed ? "#F59E0B15" : "#6B778510", color: armed ? "#F59E0B" : "#6B7785", borderColor: armed ? "#F59E0B4D" : "#2A3441" }}>▶ Test deterrent</button>
        <div className="bg-[#0B0F14] rounded-md border border-[#2A3441] px-3 py-1.5 text-center">
          <div className="text-[12px] font-mono font-bold text-[#EF4444]">{count}</div>
          <div className="text-[7px] text-[#6B7785]">today</div>
        </div>
      </div>

      <div className="space-y-1">
        <div className="text-[8px] text-[#6B7785] uppercase tracking-wider">Recent activations</div>
        {log.map((e) => (
          <div key={e.id} className="flex items-center gap-2 text-[10px] text-[#9AA6B2]">
            <span className="text-[#EF4444]">▲</span>
            <span className="flex-1">{e.sp}</span>
            <span className="font-mono text-[#6B7785]">{hhmm(e.ts)}</span>
          </div>
        ))}
      </div>

      <div className="text-[8px] text-[#6B7785] text-center">non-lethal — deters, never harms</div>
    </div>
  );
}`;

// ─── Biodiversity Log — species tally, native/introduced, activity by hour ───
const biodiversityUi = `import { useState, useEffect } from "react";
import type { CustomComponentProps } from "./types";

const TALLY = [
  { name: "Brushtail Possum", emoji: "🐾", kind: "native", n: 142 },
  { name: "Sugar Glider", emoji: "🐿️", kind: "native", n: 86 },
  { name: "Superb Lyrebird", emoji: "🐦", kind: "bird", n: 41 },
  { name: "Eastern Quoll", emoji: "🐆", kind: "native", n: 23 },
  { name: "European Rabbit", emoji: "🐇", kind: "feral", n: 58 },
  { name: "Red Fox", emoji: "🦊", kind: "predator", n: 29 },
  { name: "Feral Cat", emoji: "🐈", kind: "predator", n: 15 },
];
const COL = { native: "#22C55E", bird: "#5CE1E6", predator: "#EF4444", feral: "#F59E0B" };
const HOURS = [6, 5, 4, 3, 2, 1, 1, 1, 2, 3, 2, 2, 1, 1, 2, 2, 3, 5, 9, 14, 17, 15, 11, 8];

export default function BiodiversityLog(aeolus: CustomComponentProps) {
  const max = Math.max.apply(null, TALLY.map((t) => t.n));
  const total = TALLY.reduce((a, t) => a + t.n, 0);
  const nativeN = TALLY.filter((t) => t.kind === "native" || t.kind === "bird").reduce((a, t) => a + t.n, 0);
  const introN = total - nativeN;
  const nativePct = Math.round((nativeN / total) * 100);
  const hmax = Math.max.apply(null, HOURS);

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-[#E6EDF3]">📊 Biodiversity Log</span>
        <span className="text-[9px] text-[#6B7785]">last 7 days · on-device</span>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[15px] font-mono font-bold text-[#E6EDF3]">{TALLY.length}</span>
          <span className="text-[7px] text-[#6B7785]">Species</span>
        </div>
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[15px] font-mono font-bold text-[#22C55E]">{nativePct}%</span>
          <span className="text-[7px] text-[#6B7785]">Native</span>
        </div>
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[15px] font-mono font-bold text-[#3BA4FF]">{total}</span>
          <span className="text-[7px] text-[#6B7785]">Detections</span>
        </div>
      </div>

      <div className="flex h-2 rounded-full overflow-hidden bg-[#1A2330]">
        <div className="h-full" style={{ width: (nativeN / total) * 100 + "%", backgroundColor: "#22C55E" }} />
        <div className="h-full" style={{ width: (introN / total) * 100 + "%", backgroundColor: "#EF4444" }} />
      </div>
      <div className="flex justify-between text-[8px]">
        <span style={{ color: "#22C55E" }}>native {nativeN}</span>
        <span style={{ color: "#EF4444" }}>introduced {introN}</span>
      </div>

      <div className="space-y-1">
        {TALLY.map((t) => (
          <div key={t.name} className="flex items-center gap-2">
            <span className="text-[13px] w-5">{t.emoji}</span>
            <span className="text-[10px] text-[#E6EDF3] w-32 shrink-0">{t.name}</span>
            <div className="flex-1 h-2.5 rounded-full bg-[#121821] overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700" style={{ width: (t.n / max) * 100 + "%", backgroundColor: COL[t.kind] }} />
            </div>
            <span className="text-[10px] font-mono text-[#9AA6B2] w-8 text-right">{t.n}</span>
          </div>
        ))}
      </div>

      <div>
        <div className="text-[8px] text-[#6B7785] uppercase tracking-wider mb-1">Activity by hour — detections peak after dark</div>
        <div className="flex items-end gap-0.5 h-12">
          {HOURS.map((v, i) => (
            <div key={i} className="flex-1 rounded-t" style={{ height: (v / hmax) * 100 + "%", backgroundColor: (i >= 19 || i < 6) ? "#5CE1E6" : "#2A3441" }} />
          ))}
        </div>
      </div>
    </div>
  );
}`;

// ─── Assembly ────────────────────────────────────────────────────────────────
const automations = [
  { key: "trailcam", name: "AI Trail Camera", triggerTopic: "camera/trailcam-01/detection", scriptSource: detectionLogic, uiSource: trailcamUi },
  { key: "nest", name: "Nest Box Monitor", triggerTopic: "none", scriptSource: simLogic, uiSource: nestUi },
  { key: "deterrent", name: "Predator Deterrent", triggerTopic: "none", scriptSource: simLogic, uiSource: deterrentUi },
  { key: "biodiversity", name: "Biodiversity Log", triggerTopic: "none", scriptSource: simLogic, uiSource: biodiversityUi },
];

const panes = [
  { kind: "automation", ref: "trailcam", x: 0, y: 0, w: 12, h: 15 },
  { kind: "automation", ref: "nest", x: 0, y: 15, w: 6, h: 12 },
  { kind: "automation", ref: "deterrent", x: 6, y: 15, w: 6, h: 12 },
  { kind: "automation", ref: "biodiversity", x: 0, y: 27, w: 12, h: 13 },
];

const dataStore = [
  {
    name: "wildlife-detections",
    description: "On-device AI trail-cam detections by category (7 days, hourly)",
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
        feral: () => Math.max(0, Math.round(1 + noise(0.9))),
      },
    }),
  },
];

export default { tab, devices, automations, panes, dataStore };
