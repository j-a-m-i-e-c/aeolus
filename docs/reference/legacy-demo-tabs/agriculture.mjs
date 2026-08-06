// scripts/seed/tabs/agriculture.mjs — Connected farm demo (flagship agritech tab).
//
// Water management (dam→header + shed→house pump consoles in one pane), a 20-trough
// cattle watering grid, and GPS herd tracking with a virtual fence. Simulated,
// no keys, works offline.

import { genSeries, round, noise } from "../lib.mjs";

const tab = { id: "tab-agriculture", name: "Agriculture", icon: "sprout" };

const devices = [
  { topic: "sensor/farm/dam", payload: { value: 82 } },
  { topic: "sensor/farm/header-tank", payload: { value: 65 } },
  { topic: "sensor/farm/shed-tank", payload: { value: 78 } },
  { topic: "sensor/farm/house-tank", payload: { value: 55 } },
  { topic: "switch/farm/dam-pump", payload: { on: false } },
  { topic: "switch/farm/house-pump", payload: { on: false } },
  { topic: "sensor/fence/energiser", payload: { voltage: 7.2, current: 0.4, fault: false } },
  { topic: "sensor/fence/collars", payload: { herd: 30, tracked: 30, strays: 2, avgBattery: 74 } },
];

// All three panes are operator/monitoring consoles simulated in the UI and
// persisted via aeolus.save() where relevant. Manual no-op logic.
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

// ─── Water Management — two pump consoles in one pane ────────────────────────
const waterUi = `import { useState, useEffect } from "react";
import type { CustomComponentProps } from "./types";

function WaterSystem(props: any) {
  const aeolus = props.aeolus, cfg = props.cfg;
  const SRC_CAP = cfg.srcCap, DST_CAP = cfg.dstCap, RATE = 120;
  const [s, setS] = useState({
    src: (aeolus.read(cfg.srcKey) as number) ?? cfg.srcDef,
    dst: (aeolus.read(cfg.dstKey) as number) ?? cfg.dstDef,
    pumpOn: false, mode: "idle", xfer: 0, status: "Idle",
  });

  useEffect(() => {
    if (!s.pumpOn) return;
    const id = setInterval(() => {
      setS((p) => {
        if (!p.pumpOn) return p;
        let v = RATE;
        if (p.mode === "transfer") v = Math.min(v, p.xfer);
        v = Math.min(v, ((100 - p.dst) / 100) * DST_CAP, (p.src / 100) * SRC_CAP);
        if (v <= 0) return { ...p, pumpOn: false, mode: "idle", xfer: 0, status: cfg.dstName + " full" };
        const dst = Math.min(100, p.dst + (v / DST_CAP) * 100);
        const src = Math.max(0, p.src - (v / SRC_CAP) * 100);
        let xfer = p.xfer, pumpOn = true, mode = p.mode, status = "Pumping";
        if (mode === "transfer") { xfer = p.xfer - v; if (xfer <= 0) { xfer = 0; pumpOn = false; mode = "idle"; status = "Transfer complete"; } }
        if (dst >= 100) { pumpOn = false; mode = "idle"; status = cfg.dstName + " full"; }
        if (src <= 0) { pumpOn = false; mode = "idle"; status = "Source empty"; }
        return { dst, src, xfer, pumpOn, mode, status };
      });
    }, 150);
    return () => clearInterval(id);
  }, [s.pumpOn]);

  useEffect(() => { aeolus.save(cfg.srcKey, s.src); aeolus.save(cfg.dstKey, s.dst); }, [s.pumpOn]);

  const srcL = Math.round((s.src / 100) * SRC_CAP);
  const dstL = Math.round((s.dst / 100) * DST_CAP);
  const fh = (pct: number) => (pct / 100) * 72;
  const srcFill = s.src < 20 ? "#F59E0B" : cfg.accent;
  const dstFill = s.dst < 15 ? "#F59E0B" : cfg.accent;
  const toggle = () => setS((p) => ({ ...p, pumpOn: !p.pumpOn, mode: p.pumpOn ? "idle" : "manual" }));
  const fill = () => setS((p) => ({ ...p, pumpOn: true, mode: "fill" }));
  const xf = (n: number) => setS((p) => ({ ...p, pumpOn: true, mode: "transfer", xfer: p.xfer + n }));

  return (
    <div className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-2.5 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-[#E6EDF3]">{cfg.title}</span>
        <span className="text-[8px] px-1.5 py-0.5 rounded" style={{ backgroundColor: s.pumpOn ? cfg.accent + "20" : "#6B778520", color: s.pumpOn ? cfg.accent : "#9AA6B2" }}>{s.pumpOn ? "● Pumping" : s.status}</span>
      </div>
      <svg width="100%" height="96" viewBox="0 0 360 96" preserveAspectRatio="xMidYMid meet">
        <rect x="18" y="12" width="86" height="72" rx="5" fill="#121821" stroke={srcFill} strokeWidth="1" strokeOpacity="0.4" />
        <rect x="18" y={84 - fh(s.src)} width="86" height={fh(s.src)} rx="2" fill={srcFill} fillOpacity="0.35" className="transition-all duration-300" />
        <text x="61" y="44" textAnchor="middle" fill="#E6EDF3" fontSize="12" fontFamily="monospace" fontWeight="bold">{Math.round(s.src)}%</text>
        <text x="61" y="57" textAnchor="middle" fill="#6B7785" fontSize="6.5" fontFamily="monospace">{srcL.toLocaleString()} L</text>
        <text x="61" y="78" textAnchor="middle" fill="#9AA6B2" fontSize="7">{cfg.srcLabel}</text>

        <line x1="104" y1="48" x2="150" y2="48" stroke={s.pumpOn ? cfg.accent : "#2A3441"} strokeWidth="2.5" strokeLinecap="round" />
        <line x1="210" y1="48" x2="256" y2="48" stroke={s.pumpOn ? cfg.accent : "#2A3441"} strokeWidth="2.5" strokeLinecap="round" />
        {s.pumpOn && [0, 1, 2].map((d) => <circle key={"a" + d} cx={112 + d * 13} cy="48" r="1.8" fill={cfg.accent} className="animate-pulse" style={{ animationDelay: (d * 0.2) + "s" }} />)}
        {s.pumpOn && [0, 1, 2].map((d) => <circle key={"b" + d} cx={218 + d * 13} cy="48" r="1.8" fill={cfg.accent} className="animate-pulse" style={{ animationDelay: (d * 0.2) + "s" }} />)}
        <circle cx="180" cy="48" r="15" fill={s.pumpOn ? cfg.accent + "20" : "#1A2330"} stroke={s.pumpOn ? cfg.accent : "#2A3441"} strokeWidth="1.5" />
        <g className={s.pumpOn ? "animate-spin" : ""} style={{ transformOrigin: "180px 48px" }}>
          <line x1="173" y1="48" x2="187" y2="48" stroke={s.pumpOn ? cfg.accent : "#6B7785"} strokeWidth="2" />
          <line x1="180" y1="41" x2="180" y2="55" stroke={s.pumpOn ? cfg.accent : "#6B7785"} strokeWidth="2" />
        </g>

        <rect x="256" y="12" width="86" height="72" rx="5" fill="#121821" stroke={dstFill} strokeWidth="1" strokeOpacity="0.4" />
        <rect x="256" y={84 - fh(s.dst)} width="86" height={fh(s.dst)} rx="2" fill={dstFill} fillOpacity="0.35" className="transition-all duration-300" />
        <text x="299" y="44" textAnchor="middle" fill="#E6EDF3" fontSize="12" fontFamily="monospace" fontWeight="bold">{Math.round(s.dst)}%</text>
        <text x="299" y="57" textAnchor="middle" fill="#6B7785" fontSize="6.5" fontFamily="monospace">{dstL.toLocaleString()} L</text>
        <text x="299" y="78" textAnchor="middle" fill="#9AA6B2" fontSize="7">{cfg.dstLabel}</text>
      </svg>
      <div className="grid grid-cols-4 gap-1.5">
        <button onClick={toggle} className="py-1.5 rounded-md text-[9px] font-medium border transition-all" style={{ background: s.pumpOn ? "#EF444415" : "#22C55E15", color: s.pumpOn ? "#EF4444" : "#22C55E", borderColor: s.pumpOn ? "#EF44444D" : "#22C55E4D" }}>{s.pumpOn ? "■ Off" : "▶ On"}</button>
        <button onClick={fill} className="py-1.5 rounded-md text-[9px] font-medium border transition-all" style={{ background: cfg.accent + "15", color: cfg.accent, borderColor: cfg.accent + "4D" }}>Fill</button>
        <button onClick={() => xf(500)} className="py-1.5 rounded-md text-[9px] font-medium bg-[#0B0F14] text-[#9AA6B2] border border-[#2A3441] hover:text-[#E6EDF3]">+500L</button>
        <button onClick={() => xf(1000)} className="py-1.5 rounded-md text-[9px] font-medium bg-[#0B0F14] text-[#9AA6B2] border border-[#2A3441] hover:text-[#E6EDF3]">+1000L</button>
      </div>
    </div>
  );
}

export default function WaterManagement(aeolus: CustomComponentProps) {
  const dam = { title: "💧 Dam → Header Tank", srcLabel: "DAM", dstLabel: "HEADER", dstName: "Header", srcKey: "damPct", dstKey: "headerPct", srcDef: 82, dstDef: 65, srcCap: 60000, dstCap: 5000, accent: "#3BA4FF" };
  const drink = { title: "🚰 Shed → House (Drinking)", srcLabel: "SHED", dstLabel: "HOUSE", dstName: "House", srcKey: "shedPct", dstKey: "housePct", srcDef: 78, dstDef: 55, srcCap: 22000, dstCap: 4000, accent: "#22C55E" };
  return (
    <div className="p-4 space-y-3">
      <div className="text-sm font-semibold text-[#E6EDF3]">💧 Water Management</div>
      <WaterSystem aeolus={aeolus} cfg={dam} />
      <WaterSystem aeolus={aeolus} cfg={drink} />
    </div>
  );
}`;

// ─── Cattle Troughs — 20 troughs with drain + float-valve refill ─────────────
const troughsUi = `import { useState, useEffect } from "react";
import type { CustomComponentProps } from "./types";

export default function CattleTroughs(aeolus: CustomComponentProps) {
  const COUNT = 20;
  const [levels, setLevels] = useState<number[]>(() => {
    const arr: number[] = [];
    for (let i = 0; i < COUNT; i++) arr.push(Math.round(28 + Math.random() * 68));
    return arr;
  });
  const [refill, setRefill] = useState<boolean[]>(() => new Array(COUNT).fill(false));

  useEffect(() => {
    const id = setInterval(() => {
      setLevels((prev) => {
        const nextR: boolean[] = [];
        const next = prev.map((l, i) => {
          let r = refill[i];
          if (l <= 22) r = true;
          if (l >= 96) r = false;
          nextR[i] = r;
          const delta = r ? 4 : -(0.4 + Math.random() * 0.7);
          return Math.max(6, Math.min(100, l + delta));
        });
        setRefill(nextR);
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [refill]);

  const color = (l: number) => l < 20 ? "#EF4444" : l < 40 ? "#F59E0B" : "#3BA4FF";
  const refilling = refill.filter(Boolean).length;
  const low = levels.filter((l) => l < 40).length;
  const avg = Math.round(levels.reduce((a, b) => a + b, 0) / levels.length);

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🐮 Cattle Troughs</div>
        <span className="text-[9px] text-[#6B7785]">{COUNT} troughs</span>
      </div>

      <div className="grid grid-cols-5 gap-1.5">
        {levels.map((l, i) => {
          const c = color(l);
          return (
            <div key={i} className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-1.5 flex flex-col items-center" style={{ borderColor: l < 20 ? "#EF44444D" : "#2A3441" }}>
              <span className="text-[7px] text-[#6B7785]">T{i + 1}</span>
              <svg width="22" height="32" viewBox="0 0 22 32">
                <rect x="3" y="2" width="16" height="28" rx="2" fill="#121821" stroke={c} strokeWidth="0.8" strokeOpacity="0.5" />
                <rect x="3" y={30 - (l / 100) * 28} width="16" height={(l / 100) * 28} rx="1" fill={c} fillOpacity="0.4" className="transition-all duration-700" />
              </svg>
              <span className="text-[8px] font-mono font-bold" style={{ color: c }}>{Math.round(l)}%</span>
              {refill[i] && <span className="text-[6px] text-[#22C55E] animate-pulse">▲ fill</span>}
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[11px] font-mono font-bold text-[#22C55E]">{refilling}</span>
          <span className="text-[7px] text-[#6B7785]">Refilling</span>
        </div>
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[11px] font-mono font-bold" style={{ color: low > 0 ? "#F59E0B" : "#22C55E" }}>{low}</span>
          <span className="text-[7px] text-[#6B7785]">{"Low <40%"}</span>
        </div>
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[11px] font-mono font-bold text-[#3BA4FF]">{avg}%</span>
          <span className="text-[7px] text-[#6B7785]">Average</span>
        </div>
      </div>
    </div>
  );
}`;

// ─── Smart Fencing — GPS herd tracking + virtual fence ───────────────────────
const fenceUi = `import { useState, useEffect } from "react";
import type { CustomComponentProps } from "./types";

const PAD = { x: 16, y: 30, w: 448, h: 196 };
const VF = { x: 40, y: 48, w: 400, h: 160 };
const HERD = 30, VOLT = 7.2;

export default function SmartFencing(aeolus: CustomComponentProps) {
  const [cows, setCows] = useState(() => {
    const list: any[] = [];
    for (let i = 0; i < HERD; i++) {
      const stray = i < 2;
      list.push({
        id: "#" + String(1001 + i).slice(1),
        x: stray ? VF.x - 16 - Math.random() * 14 : VF.x + 14 + Math.random() * (VF.w - 28),
        y: stray ? VF.y + 40 + Math.random() * 80 : VF.y + 14 + Math.random() * (VF.h - 28),
        vx: (Math.random() - 0.5) * 1.2,
        vy: (Math.random() - 0.5) * 1.2,
        battery: Math.round(55 + Math.random() * 44),
        stray,
      });
    }
    return list;
  });
  const [sel, setSel] = useState<string | null>(null);

  useEffect(() => {
    const id = setInterval(() => {
      setCows((prev) => prev.map((c) => {
        let nx = c.x + c.vx, ny = c.y + c.vy, vx = c.vx, vy = c.vy;
        const minX = c.stray ? PAD.x + 4 : VF.x + 6;
        const maxX = c.stray ? VF.x - 8 : VF.x + VF.w - 6;
        const minY = c.stray ? PAD.y + 6 : VF.y + 6;
        const maxY = VF.y + VF.h - 6;
        if (nx < minX || nx > maxX) { vx = -vx; nx = c.x + vx; }
        if (ny < minY || ny > maxY) { vy = -vy; ny = c.y + vy; }
        if (Math.random() < 0.06) { vx = (Math.random() - 0.5) * 1.2; vy = (Math.random() - 0.5) * 1.2; }
        return { ...c, x: nx, y: ny, vx, vy };
      }));
    }, 400);
    return () => clearInterval(id);
  }, []);

  const strays = cows.filter((c) => c.stray).length;
  const inZone = cows.length - strays;
  const avgBatt = Math.round(cows.reduce((a, c) => a + c.battery, 0) / cows.length);
  const selected = cows.find((c) => c.id === sel);

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🐄 Smart Fencing — Herd Tracking</div>
        <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: strays > 0 ? "#EF444420" : "#22C55E20", color: strays > 0 ? "#EF4444" : "#22C55E" }}>
          {strays > 0 ? strays + " stray" : "Contained"}
        </span>
      </div>

      <div className="bg-[#070A0E] rounded-xl border border-[#2A3441] p-2">
        <svg width="100%" height="236" viewBox="0 0 480 250" preserveAspectRatio="xMidYMid meet">
          <rect x={PAD.x} y={PAD.y} width={PAD.w} height={PAD.h} rx="6" fill="#0B140C" stroke="#2A3441" strokeWidth="1" />
          <rect x={VF.x} y={VF.y} width={VF.w} height={VF.h} rx="4" fill="none" stroke="#22C55E" strokeWidth="1.5" strokeDasharray="6 4" strokeOpacity="0.7" />
          <text x={VF.x + 4} y={VF.y - 4} fill="#22C55E" fontSize="8" fillOpacity="0.8">virtual fence</text>
          {cows.map((c) => {
            const isSel = c.id === sel;
            const col = c.stray ? "#EF4444" : "#22C55E";
            return (
              <g key={c.id} onClick={() => setSel(c.id)} style={{ cursor: "pointer" }}>
                {isSel && <circle cx={c.x} cy={c.y} r="9" fill="none" stroke="#5CE1E6" strokeWidth="1.5" />}
                {c.stray && <circle cx={c.x} cy={c.y} r="8" fill="none" stroke="#EF4444" strokeWidth="1" className="animate-pulse" />}
                <circle cx={c.x} cy={c.y} r="4" fill={col} stroke="#05070A" strokeWidth="1" className="transition-all duration-300" />
              </g>
            );
          })}
        </svg>
      </div>

      {selected ? (
        <div className="bg-[#0B0F14] rounded-lg border border-[#5CE1E6]/30 p-2.5 flex items-center gap-3">
          <div className="text-2xl">🐄</div>
          <div className="flex-1">
            <div className="text-[12px] font-mono font-bold text-[#E6EDF3]">Tag {selected.id}</div>
            <div className="text-[8px] text-[#9AA6B2]">{selected.stray ? "⚠ Outside virtual fence" : "Grazing — in zone"} · collar {selected.battery}%</div>
          </div>
          <button onClick={() => setSel(null)} className="text-[10px] text-[#6B7785] hover:text-[#E6EDF3] px-2 py-1">✕</button>
        </div>
      ) : (
        <div className="text-center text-[8px] text-[#6B7785]">tap a tag to inspect · whole herd ({HERD}) tracked</div>
      )}

      <div className="grid grid-cols-4 gap-1.5">
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[11px] font-mono font-bold text-[#22C55E]">{inZone}</span>
          <span className="text-[7px] text-[#6B7785]">In Zone</span>
        </div>
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[11px] font-mono font-bold" style={{ color: strays > 0 ? "#EF4444" : "#22C55E" }}>{strays}</span>
          <span className="text-[7px] text-[#6B7785]">Strays</span>
        </div>
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[11px] font-mono font-bold text-[#3BA4FF]">{VOLT}kV</span>
          <span className="text-[7px] text-[#6B7785]">Energiser</span>
        </div>
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[11px] font-mono font-bold text-[#5CE1E6]">{avgBatt}%</span>
          <span className="text-[7px] text-[#6B7785]">Avg Collar</span>
        </div>
      </div>
    </div>
  );
}`;

// ─── Assembly ────────────────────────────────────────────────────────────────
const automations = [
  { key: "fence", name: "Smart Fencing", triggerTopic: "none", scriptSource: simLogic, uiSource: fenceUi },
  { key: "water", name: "Water Management", triggerTopic: "none", scriptSource: simLogic, uiSource: waterUi },
  { key: "troughs", name: "Cattle Troughs", triggerTopic: "none", scriptSource: simLogic, uiSource: troughsUi },
];

const panes = [
  { kind: "automation", ref: "fence", x: 0, y: 0, w: 12, h: 14 },
  { kind: "automation", ref: "water", x: 0, y: 14, w: 6, h: 15 },
  { kind: "automation", ref: "troughs", x: 6, y: 14, w: 6, h: 13 },
];

const dataStore = [
  {
    name: "tank-levels",
    description: "Dam, header, shed & house tank levels (72h)",
    retentionDays: 90,
    records: genSeries({
      count: 72,
      intervalMs: 3_600_000,
      fields: {
        dam: (i) => round(80 - i * 0.08 + noise(1.5), 0),
        header: (i) => round(55 + Math.sin(i / 5) * 25 + noise(3), 0),
        shed: (i) => round(75 + Math.sin(i / 12) * 8 + noise(2), 0),
        house: (i) => round(50 + Math.sin(i / 4) * 22 + noise(3), 0),
      },
    }),
  },
];

export default { tab, devices, automations, panes, dataStore };
