// scripts/seed/tabs/agriculture.mjs — Connected farm demo (flagship agritech tab).
//
// Water management (dam → header tank, and drinking-water shed → house tanks,
// each with operator pump controls) plus virtual livestock fencing. Simulated,
// no keys, works offline.

import { genSeries, round, noise } from "../lib.mjs";

const tab = { id: "tab-agriculture", name: "Agriculture", icon: "sprout" };

const devices = [
  // Irrigation / dam water
  { topic: "sensor/farm/dam", payload: { value: 82 } },
  { topic: "sensor/farm/header-tank", payload: { value: 65 } },
  { topic: "switch/farm/dam-pump", payload: { on: false } },
  // Drinking water
  { topic: "sensor/farm/shed-tank", payload: { value: 78 } },
  { topic: "sensor/farm/house-tank", payload: { value: 55 } },
  { topic: "switch/farm/house-pump", payload: { on: false } },
  // Smart fencing
  { topic: "sensor/fence/energiser", payload: { voltage: 7.2, current: 0.4, fault: false } },
  { topic: "sensor/fence/zone-north", payload: { intact: true, voltage: 7.1 } },
  { topic: "sensor/fence/zone-east", payload: { intact: false, voltage: 2.1, breach: true } },
  { topic: "sensor/fence/zone-south", payload: { intact: true, voltage: 7.0 } },
  { topic: "sensor/fence/zone-west", payload: { intact: true, voltage: 6.9 } },
  { topic: "sensor/fence/collars", payload: { herd: 120, inZone: 118, strays: 2, avgBattery: 74 } },
];

// Both water panes are operator consoles — pump state + tank levels are
// simulated in the UI and persisted via aeolus.save(). Manual no-op logic.
const pumpLogic = `automation({
  conditions: [
    function ready(context) {
      return true;
    },
  ],
  actions: [
    function pump(context) {
      state.set("lastUpdate", Date.now());
    },
  ],
});`;

// ─── Water pane factory — source tank → pump → destination tank + controls ───
// Both panes are identical bar labels/keys/capacities, so build from one template.
function makeWaterPane(o) {
  return `import { useState, useEffect } from "react";
import type { CustomComponentProps } from "./types";

export default function ${o.comp}(aeolus: CustomComponentProps) {
  const SRC_CAP = ${o.srcCap}, DST_CAP = ${o.dstCap}, RATE = 120;
  const [s, setS] = useState({
    src: (aeolus.read("${o.srcKey}") as number) ?? ${o.srcDef},
    dst: (aeolus.read("${o.dstKey}") as number) ?? ${o.dstDef},
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
        if (v <= 0) return { ...p, pumpOn: false, mode: "idle", xfer: 0, status: "${o.dstName} full" };
        const dst = Math.min(100, p.dst + (v / DST_CAP) * 100);
        const src = Math.max(0, p.src - (v / SRC_CAP) * 100);
        let xfer = p.xfer, pumpOn = true, mode = p.mode, status = "Pumping";
        if (mode === "transfer") { xfer = p.xfer - v; if (xfer <= 0) { xfer = 0; pumpOn = false; mode = "idle"; status = "Transfer complete"; } }
        if (dst >= 100) { pumpOn = false; mode = "idle"; status = "${o.dstName} full"; }
        if (src <= 0) { pumpOn = false; mode = "idle"; status = "Source empty"; }
        return { dst, src, xfer, pumpOn, mode, status };
      });
    }, 150);
    return () => clearInterval(id);
  }, [s.pumpOn]);

  useEffect(() => { aeolus.save("${o.srcKey}", s.src); aeolus.save("${o.dstKey}", s.dst); }, [s.pumpOn]);

  const srcL = Math.round((s.src / 100) * SRC_CAP);
  const dstL = Math.round((s.dst / 100) * DST_CAP);
  const fillH = (pct: number) => (pct / 100) * 100;
  const srcFill = s.src < 20 ? "#F59E0B" : "${o.accent}";
  const dstFill = s.dst < 15 ? "#F59E0B" : "${o.accent}";

  const toggle = () => setS((p) => ({ ...p, pumpOn: !p.pumpOn, mode: p.pumpOn ? "idle" : "manual", status: p.pumpOn ? "Stopped" : "Pumping" }));
  const fill = () => setS((p) => ({ ...p, pumpOn: true, mode: "fill", status: "Filling" }));
  const transfer = (n: number) => setS((p) => ({ ...p, pumpOn: true, mode: "transfer", xfer: p.xfer + n, status: "Transferring" }));

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">${o.title}</div>
        <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: s.pumpOn ? "${o.accent}20" : "#6B778520", color: s.pumpOn ? "${o.accent}" : "#9AA6B2" }}>
          {s.pumpOn ? "● Pumping" : s.status}
        </span>
      </div>

      <div className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-2">
        <svg width="100%" height="150" viewBox="0 0 360 150" preserveAspectRatio="xMidYMid meet">
          <rect x="20" y="22" width="92" height="100" rx="6" fill="#121821" stroke={srcFill} strokeWidth="1.2" strokeOpacity="0.4" />
          <rect x="20" y={122 - fillH(s.src)} width="92" height={fillH(s.src)} rx="3" fill={srcFill} fillOpacity="0.35" className="transition-all duration-300" />
          <text x="66" y="15" textAnchor="middle" fill="#9AA6B2" fontSize="8">${o.srcLabel}</text>
          <text x="66" y="74" textAnchor="middle" fill="#E6EDF3" fontSize="13" fontFamily="monospace" fontWeight="bold">{Math.round(s.src)}%</text>
          <text x="66" y="88" textAnchor="middle" fill="#6B7785" fontSize="7" fontFamily="monospace">{srcL.toLocaleString()} L</text>

          <line x1="112" y1="72" x2="158" y2="72" stroke={s.pumpOn ? "${o.accent}" : "#2A3441"} strokeWidth="3" strokeLinecap="round" />
          <line x1="202" y1="72" x2="248" y2="72" stroke={s.pumpOn ? "${o.accent}" : "#2A3441"} strokeWidth="3" strokeLinecap="round" />
          {s.pumpOn && [0, 1, 2].map((d) => <circle key={"a" + d} cx={120 + d * 14} cy="72" r="2" fill="${o.accent}" className="animate-pulse" style={{ animationDelay: (d * 0.2) + "s" }} />)}
          {s.pumpOn && [0, 1, 2].map((d) => <circle key={"b" + d} cx={210 + d * 14} cy="72" r="2" fill="${o.accent}" className="animate-pulse" style={{ animationDelay: (d * 0.2) + "s" }} />)}
          <circle cx="180" cy="72" r="17" fill={s.pumpOn ? "${o.accent}20" : "#1A2330"} stroke={s.pumpOn ? "${o.accent}" : "#2A3441"} strokeWidth="1.5" />
          <g className={s.pumpOn ? "animate-spin" : ""} style={{ transformOrigin: "180px 72px" }}>
            <line x1="172" y1="72" x2="188" y2="72" stroke={s.pumpOn ? "${o.accent}" : "#6B7785"} strokeWidth="2" />
            <line x1="180" y1="64" x2="180" y2="80" stroke={s.pumpOn ? "${o.accent}" : "#6B7785"} strokeWidth="2" />
          </g>

          <rect x="248" y="22" width="92" height="100" rx="6" fill="#121821" stroke={dstFill} strokeWidth="1.2" strokeOpacity="0.4" />
          <rect x="248" y={122 - fillH(s.dst)} width="92" height={fillH(s.dst)} rx="3" fill={dstFill} fillOpacity="0.35" className="transition-all duration-300" />
          <text x="294" y="15" textAnchor="middle" fill="#9AA6B2" fontSize="8">${o.dstLabel}</text>
          <text x="294" y="74" textAnchor="middle" fill="#E6EDF3" fontSize="13" fontFamily="monospace" fontWeight="bold">{Math.round(s.dst)}%</text>
          <text x="294" y="88" textAnchor="middle" fill="#6B7785" fontSize="7" fontFamily="monospace">{dstL.toLocaleString()} L</text>
        </svg>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button onClick={toggle} className="py-2 rounded-lg text-[11px] font-medium border transition-all" style={{ background: s.pumpOn ? "#EF444415" : "#22C55E15", color: s.pumpOn ? "#EF4444" : "#22C55E", borderColor: s.pumpOn ? "#EF44444D" : "#22C55E4D" }}>
          {s.pumpOn ? "■ Pump Off" : "▶ Pump On"}
        </button>
        <button onClick={fill} className="py-2 rounded-lg text-[11px] font-medium border transition-all" style={{ background: "${o.accent}15", color: "${o.accent}", borderColor: "${o.accent}4D" }}>Fill ${o.dstName}</button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => transfer(500)} className="py-2 rounded-lg text-[11px] font-medium bg-[#0B0F14] text-[#9AA6B2] border border-[#2A3441] hover:text-[#E6EDF3] transition-all">Transfer 500 L</button>
        <button onClick={() => transfer(1000)} className="py-2 rounded-lg text-[11px] font-medium bg-[#0B0F14] text-[#9AA6B2] border border-[#2A3441] hover:text-[#E6EDF3] transition-all">Transfer 1000 L</button>
      </div>
      {s.mode === "transfer" && s.xfer > 0 && (
        <div className="text-center text-[9px]" style={{ color: "${o.accent}" }}>Transferring… {Math.round(s.xfer)} L remaining</div>
      )}
    </div>
  );
}`;
}

const waterUi = makeWaterPane({ comp: "DamWater", title: "💧 Dam & Header Tank", srcLabel: "DAM", dstLabel: "HEADER TANK", dstName: "Header", srcKey: "damPct", dstKey: "headerPct", srcDef: 82, dstDef: 65, srcCap: 60000, dstCap: 5000, accent: "#3BA4FF" });
const drinkingUi = makeWaterPane({ comp: "DrinkingWater", title: "🚰 Drinking Water", srcLabel: "SHED TANKS", dstLabel: "HOUSE TANK", dstName: "House", srcKey: "shedPct", dstKey: "housePct", srcDef: 78, dstDef: 55, srcCap: 22000, dstCap: 4000, accent: "#22C55E" });

// ─── Smart Fencing — energiser + virtual-fence collar containment ────────────
const fenceLogic = `automation({
  conditions: [
    function has(context) {
      return context.state !== undefined;
    },
  ],
  actions: [
    function fence(context) {
      var s = context.state, t = context.topic || "";
      if (t.indexOf("energiser") >= 0) {
        state.set("voltage", s.voltage);
        state.set("current", s.current);
        state.set("fault", s.fault);
      } else if (t.indexOf("collars") >= 0) {
        state.set("herd", s.herd);
        state.set("inZone", s.inZone);
        state.set("strays", s.strays);
        state.set("avgBattery", s.avgBattery);
      } else if (t.indexOf("zone-") >= 0) {
        var z = t.split("zone-")[1];
        state.set("zone_" + z + "_intact", s.intact);
        state.set("zone_" + z + "_voltage", s.voltage);
      }
      state.set("lastUpdate", Date.now());

      var zones = ["north", "east", "south", "west"];
      var breaches = 0;
      for (var i = 0; i < zones.length; i++) {
        if (state.get("zone_" + zones[i] + "_intact") === false) breaches++;
      }
      state.set("breaches", breaches);
      var v = state.get("voltage") || 7.2;
      state.set("fenceOk", v >= 5 && breaches === 0);
      if (breaches > 0) log.warn("Fence breach — " + breaches + " zone(s) down");
    },
  ],
});`;

const fenceUi = `import type { CustomComponentProps } from "./types";

export default function SmartFencing(aeolus: CustomComponentProps) {
  const voltage = aeolus.read("voltage") as number ?? 7.2;
  const herd = aeolus.read("herd") as number ?? 120;
  const inZone = aeolus.read("inZone") as number ?? 118;
  const strays = aeolus.read("strays") as number ?? 2;
  const avgBattery = aeolus.read("avgBattery") as number ?? 74;
  const breaches = aeolus.read("breaches") as number ?? 1;
  const fenceOk = aeolus.read("fenceOk") as boolean ?? false;

  const zones = [
    { key: "north", x: 70, y: 16, w: 80, h: 16 },
    { key: "east", x: 158, y: 40, w: 16, h: 70 },
    { key: "south", x: 70, y: 118, w: 80, h: 16 },
    { key: "west", x: 46, y: 40, w: 16, h: 70 },
  ];
  const intact = (k: string) => aeolus.read("zone_" + k + "_intact") as boolean ?? true;
  const vColor = voltage >= 6 ? "#22C55E" : voltage >= 4 ? "#F59E0B" : "#EF4444";
  const containment = Math.round((inZone / herd) * 100);

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🐄 Smart Fencing</div>
        <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: fenceOk ? "#22C55E20" : "#EF444420", color: fenceOk ? "#22C55E" : "#EF4444" }}>
          {breaches > 0 ? breaches + " breach" : "Secure"}
        </span>
      </div>

      <div className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-2 flex justify-center">
        <svg width="200" height="150" viewBox="0 0 220 150">
          <rect x="62" y="32" width="96" height="86" rx="4" fill="#22C55E08" stroke="#2A3441" strokeWidth="0.8" />
          <text x="110" y="78" textAnchor="middle" fill="#6B7785" fontSize="8">paddock</text>
          {zones.map((z) => {
            const ok = intact(z.key);
            const col = ok ? "#22C55E" : "#EF4444";
            return (
              <g key={z.key}>
                <rect x={z.x} y={z.y} width={z.w} height={z.h} rx="3" fill={col + "20"} stroke={col} strokeWidth="1.5" className="transition-all duration-500" />
                <text x={z.x + z.w / 2} y={z.y + z.h / 2 + 3} textAnchor="middle" fill={col} fontSize="6" className="uppercase">{z.key}</text>
                {!ok && <circle cx={z.x + z.w / 2} cy={z.y + 4} r="2" fill="#EF4444" className="animate-pulse" />}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[10px] font-mono font-bold" style={{ color: vColor }}>{voltage.toFixed(1)}kV</span>
          <span className="text-[7px] text-[#6B7785]">Energiser</span>
        </div>
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[10px] font-mono font-bold" style={{ color: strays > 0 ? "#F59E0B" : "#22C55E" }}>{inZone}/{herd}</span>
          <span className="text-[7px] text-[#6B7785]">In Zone ({containment}%)</span>
        </div>
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[10px] font-mono font-bold text-[#5CE1E6]">{avgBattery}%</span>
          <span className="text-[7px] text-[#6B7785]">Collar Batt</span>
        </div>
      </div>

      {strays > 0 && (
        <div className="rounded-lg bg-[#F59E0B]/15 border border-[#F59E0B]/40 text-[#F59E0B] text-[10px] text-center py-1.5">
          ⚠ {strays} head outside virtual boundary
        </div>
      )}
    </div>
  );
}`;

// ─── Assembly ────────────────────────────────────────────────────────────────
const automations = [
  { key: "water", name: "Dam & Header Tank", triggerTopic: "none", scriptSource: pumpLogic, uiSource: waterUi },
  { key: "drinking", name: "Drinking Water", triggerTopic: "none", scriptSource: pumpLogic, uiSource: drinkingUi },
  { key: "fence", name: "Smart Fencing", triggerTopic: "sensor/fence/+", scriptSource: fenceLogic, uiSource: fenceUi },
];

const panes = [
  { kind: "automation", ref: "water", x: 0, y: 0, w: 6, h: 12 },
  { kind: "automation", ref: "drinking", x: 6, y: 0, w: 6, h: 12 },
  { kind: "automation", ref: "fence", x: 0, y: 12, w: 6, h: 11 },
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
