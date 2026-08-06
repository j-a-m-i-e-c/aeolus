// scripts/seed/tabs/spacecraft.mjs — Crewed spacecraft environmental control demo.
//
// Public-demo flagship: a live ECLSS cutaway rather than a generic dashboard.
// Shared operational state (scrubber, O2 target, cabin leak, reset) lives in
// Aeolus. Airflow particles, fan rotation and other 60fps presentation remain
// browser-side and are derived from that shared state.

const tab = { id: "tab-spacecraft", name: "Spacecraft", icon: "orbit" };

const devices = [
  { topic: "switch/craft/scrubber", payload: { on: false, bedTempC: 31 } },
  { topic: "sensor/craft/atmo", payload: { o2: 20.9, co2: 0.55, pressureKpa: 101.2 } },
  { topic: "sensor/craft/power", payload: { busVolts: 28.1, arrayWatts: 1400, batteryPct: 86 } },
  { topic: "sensor/craft/thermal", payload: { cabinC: 22.4, loopC: 17.8 } },
];

const logic = `automation({
  actions: [
    function eclss(context) {
      function init(key, value) {
        if (state.get(key) === undefined) state.set(key, value);
      }
      function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
      }

      var now = Date.now();
      init("scrubberOn", false);
      init("o2Setpoint", 20.9);
      init("co2Base", 0.55);
      init("co2ChangedAt", now);
      init("pressureBase", 101.2);
      init("pressureChangedAt", now);
      init("leakActive", false);
      init("lastAction", { label: "Crew systems nominal", at: now });

      function currentCo2() {
        var base = Number(state.get("co2Base") || 0.55);
        var changedAt = Number(state.get("co2ChangedAt") || now);
        var seconds = Math.max(0, (now - changedAt) / 1000);
        var on = Boolean(state.get("scrubberOn"));
        var rate = on ? -0.006 : 0.0032;
        return clamp(base + seconds * rate, 0.32, 2.6);
      }

      function currentPressure() {
        var base = Number(state.get("pressureBase") || 101.2);
        var changedAt = Number(state.get("pressureChangedAt") || now);
        var seconds = Math.max(0, (now - changedAt) / 1000);
        var leaking = Boolean(state.get("leakActive"));
        return clamp(base + (leaking ? -seconds * 0.045 : 0), 78, 101.2);
      }

      function snapshotAtmosphere() {
        state.set("co2Base", currentCo2());
        state.set("co2ChangedAt", now);
        state.set("pressureBase", currentPressure());
        state.set("pressureChangedAt", now);
      }

      var evt = String(context.topic || "").split("/").pop();

      if (evt === "scrubber-on") {
        snapshotAtmosphere();
        state.set("scrubberOn", true);
        state.set("lastAction", { label: "CO2 scrubber brought online", at: now });
        mqtt.publish("switch/craft/scrubber", JSON.stringify({ on: true, bedTempC: 34 }));
        if (db) db.write("eclss-events", { event: "scrubber-on", at: now });
      } else if (evt === "scrubber-off") {
        snapshotAtmosphere();
        state.set("scrubberOn", false);
        state.set("lastAction", { label: "CO2 scrubber placed in standby", at: now });
        mqtt.publish("switch/craft/scrubber", JSON.stringify({ on: false, bedTempC: 31 }));
        if (db) db.write("eclss-events", { event: "scrubber-off", at: now });
      } else if (evt === "o2-low") {
        state.set("o2Setpoint", 20.4);
        state.set("lastAction", { label: "O2 target set to 20.4%", at: now });
      } else if (evt === "o2-nominal") {
        state.set("o2Setpoint", 20.9);
        state.set("lastAction", { label: "O2 target returned to nominal", at: now });
      } else if (evt === "o2-high") {
        state.set("o2Setpoint", 21.5);
        state.set("lastAction", { label: "O2 target set to 21.5%", at: now });
      } else if (evt === "leak-start") {
        snapshotAtmosphere();
        state.set("leakActive", true);
        state.set("lastAction", { label: "Micrometeoroid leak simulated", at: now });
        log.warn("Cabin pressure leak detected at aft pressure shell");
        if (db) db.write("eclss-events", { event: "pressure-leak", at: now });
      } else if (evt === "leak-seal") {
        snapshotAtmosphere();
        state.set("leakActive", false);
        state.set("lastAction", { label: "Leak isolated and pressure stabilised", at: now });
        if (db) db.write("eclss-events", { event: "leak-sealed", at: now });
      } else if (evt === "reset-craft") {
        state.set("scrubberOn", false);
        state.set("o2Setpoint", 20.9);
        state.set("co2Base", 0.55);
        state.set("co2ChangedAt", now);
        state.set("pressureBase", 101.2);
        state.set("pressureChangedAt", now);
        state.set("leakActive", false);
        state.set("lastAction", { label: "Crew systems reset to nominal", at: now });
        mqtt.publish("switch/craft/scrubber", JSON.stringify({ on: false, bedTempC: 31 }));
        mqtt.publish("sensor/craft/atmo", JSON.stringify({ o2: 20.9, co2: 0.55, pressureKpa: 101.2 }));
      }

      // Keep the generic device layer coherent with the shared application state.
      mqtt.publish("sensor/craft/atmo", JSON.stringify({
        o2: Number(state.get("o2Setpoint") || 20.9),
        co2: Math.round(currentCo2() * 100) / 100,
        pressureKpa: Math.round(currentPressure() * 10) / 10
      }));
    },
  ],
});`;

const ui = `import { useEffect, useState } from "react";
import type { CustomComponentProps } from "./types";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export default function SpacecraftEclss(aeolus: CustomComponentProps) {
  const scrubberOn = Boolean(aeolus.read("scrubberOn"));
  const o2Setpoint = Number(aeolus.read("o2Setpoint") ?? 20.9);
  const co2Base = Number(aeolus.read("co2Base") ?? 0.55);
  const co2ChangedAt = Number(aeolus.read("co2ChangedAt") ?? Date.now());
  const pressureBase = Number(aeolus.read("pressureBase") ?? 101.2);
  const pressureChangedAt = Number(aeolus.read("pressureChangedAt") ?? Date.now());
  const leakActive = Boolean(aeolus.read("leakActive"));
  const lastAction = aeolus.read("lastAction") as any;

  const [now, setNow] = useState(Date.now());
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
      setPhase((v) => (v + 1) % 100000);
    }, 90);
    return () => clearInterval(id);
  }, []);

  const co2Seconds = Math.max(0, (now - co2ChangedAt) / 1000);
  const co2 = clamp(co2Base + co2Seconds * (scrubberOn ? -0.006 : 0.0032), 0.32, 2.6);
  const pressureSeconds = Math.max(0, (now - pressureChangedAt) / 1000);
  const pressure = clamp(pressureBase - (leakActive ? pressureSeconds * 0.045 : 0), 78, 101.2);
  const actualO2 = clamp(o2Setpoint + Math.sin(now / 3800) * 0.035 - (101.2 - pressure) * 0.006, 18.5, 23);
  const co2Alarm = co2 >= 1.0;
  const pressureAlarm = pressure < 95;
  const alarm = co2Alarm || pressureAlarm;
  const actionLabel = lastAction && lastAction.label ? String(lastAction.label) : "Crew systems nominal";

  const flowColor = scrubberOn ? "#5DE1C4" : "#66737E";
  const cabinColor = alarm ? "#FF6E66" : "#6EE6A0";
  const particles = Array.from({ length: 22 });
  const o2Particles = Array.from({ length: 10 });

  return (
    <div style={{ minHeight: "100%", padding: 14, color: "#E8EEF5", background: "linear-gradient(180deg,#070B12 0%,#06080D 100%)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 10 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 850, letterSpacing: "0.025em" }}>CREW ENVIRONMENTAL CONTROL</span>
            <span style={{ fontSize: 8, border: "1px solid #29384B", borderRadius: 999, padding: "2px 7px", color: "#7BA4CC", letterSpacing: "0.1em" }}>ECLSS LOOP A</span>
          </div>
          <div style={{ color: "#677384", fontSize: 9, marginTop: 3 }}>Cabin atmosphere · carbon dioxide removal · oxygen injection · pressure integrity</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: alarm ? "#FF746C" : "#74E3A0", fontSize: 10, fontWeight: 850 }}>{alarm ? "CABIN ATTENTION" : "CABIN NOMINAL"}</div>
          <div style={{ color: "#657282", fontSize: 8, marginTop: 2 }}>{actionLabel}</div>
        </div>
      </div>

      <div style={{ border: "1px solid #263242", borderRadius: 14, overflow: "hidden", background: "#050810", boxShadow: "inset 0 0 80px rgba(40,90,150,.05)" }}>
        <svg width="100%" height="430" viewBox="0 0 720 430" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="craftCabin" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#111B28"/><stop offset="1" stopColor="#09101A"/></linearGradient>
            <linearGradient id="duct" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#233343"/><stop offset="1" stopColor="#17232E"/></linearGradient>
            <radialGradient id="earthGlow"><stop offset="0" stopColor="#2C88DD" stopOpacity=".8"/><stop offset=".65" stopColor="#14518D" stopOpacity=".35"/><stop offset="1" stopColor="#07101C" stopOpacity="0"/></radialGradient>
            <filter id="blueGlow"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          </defs>

          {/* Space outside the pressure shell. */}
          <rect width="720" height="430" fill="#03060B" />
          {Array.from({ length: 46 }).map((_, i) => <circle key={i} cx={(i * 79) % 720} cy={(i * 47) % 180} r={i % 7 === 0 ? 1.15 : .55} fill="#DDE9FF" opacity={0.18 + (i % 5) * .1} />)}
          <ellipse cx="84" cy="-2" rx="190" ry="120" fill="url(#earthGlow)" />
          <path d="M-40 47 Q72 102 186 34" fill="none" stroke="#65B8F3" strokeOpacity=".35" strokeWidth="2" />

          {/* Pressurised cabin. */}
          <path d="M74 142 Q74 94 122 83 H322 Q370 94 370 142 V323 Q370 348 344 348 H100 Q74 348 74 323 Z" fill="url(#craftCabin)" stroke={cabinColor} strokeOpacity={alarm ? .85 : .45} strokeWidth={alarm ? 2 : 1.3} />
          <path d="M98 112 H343" stroke="#2E4359" strokeWidth="1" />
          <text x="99" y="104" fill="#6E8094" fontSize="7" letterSpacing="1.5">PRESSURISED CABIN</text>

          {/* Cabin window + planet limb. */}
          <circle cx="128" cy="167" r="31" fill="#06101B" stroke="#4E6478" strokeWidth="3" />
          <path d="M101 174 Q128 145 156 169" fill="#1B5D93" opacity=".7" />
          <path d="M101 173 Q129 144 156 168" fill="none" stroke="#71C9FF" strokeWidth="1.2" opacity=".8" />

          {/* Crew silhouettes. */}
          {[{x:206,y:226},{x:278,y:228}].map((c, i) => <g key={i} opacity=".84">
            <circle cx={c.x} cy={c.y - 26} r="8" fill="#A8BACB" />
            <path d={"M" + (c.x - 11) + " " + (c.y - 16) + " Q" + c.x + " " + (c.y - 22) + " " + (c.x + 11) + " " + (c.y - 16) + " L" + (c.x + 8) + " " + (c.y + 16) + " H" + (c.x - 8) + " Z"} fill="#63798D" />
            <line x1={c.x - 5} y1={c.y + 16} x2={c.x - 8} y2={c.y + 34} stroke="#63798D" strokeWidth="5" strokeLinecap="round" />
            <line x1={c.x + 5} y1={c.y + 16} x2={c.x + 8} y2={c.y + 34} stroke="#63798D" strokeWidth="5" strokeLinecap="round" />
          </g>)}

          {/* Cabin atmosphere readout, intentionally embedded in the scene. */}
          <g transform="translate(98 292)">
            <rect width="238" height="42" rx="7" fill="#07101A" stroke="#27384A" />
            <text x="12" y="14" fill="#718397" fontSize="6.5" letterSpacing="1">CABIN ATMOSPHERE</text>
            <text x="12" y="31" fill="#7CC9FF" fontFamily="monospace" fontSize="12" fontWeight="700">O₂ {actualO2.toFixed(2)}%</text>
            <text x="91" y="31" fill={co2Alarm ? "#FF6E66" : "#79E2A1"} fontFamily="monospace" fontSize="12" fontWeight="700">CO₂ {co2.toFixed(2)}%</text>
            <text x="176" y="31" fill={pressureAlarm ? "#FF6E66" : "#D7E1EA"} fontFamily="monospace" fontSize="11">{pressure.toFixed(1)} kPa</text>
          </g>

          {/* Leak at aft pressure shell. */}
          {leakActive && <g filter="url(#blueGlow)">
            <path d="M367 224 l12 -7 l-7 13 l12 6 l-14 1" fill="none" stroke="#FF8A78" strokeWidth="2" />
            {Array.from({ length: 8 }).map((_, i) => {
              const d = ((phase * 1.6 + i * 13) % 80);
              return <circle key={i} cx={376 + d} cy={225 + Math.sin(i * 1.8 + phase * .08) * 10} r={1.2 + (i % 3) * .35} fill="#8FDBFF" opacity={1 - d / 90} />;
            })}
            <text x="382" y="205" fill="#FF7B6F" fontSize="7" fontWeight="700">PRESSURE LEAK</text>
          </g>}

          {/* ECLSS rack and loop. */}
          <g>
            <rect x="418" y="82" width="244" height="278" rx="14" fill="#090E15" stroke="#2B3B4D" />
            <text x="437" y="104" fill="#788A9D" fontSize="7" letterSpacing="1.4">ENVIRONMENTAL CONTROL RACK</text>

            {/* Return duct path */}
            <path d="M370 165 H450 V145 H575 V292 H449 V262 H370" fill="none" stroke="url(#duct)" strokeWidth="13" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M370 165 H450 V145 H575 V292 H449 V262 H370" fill="none" stroke={flowColor} strokeOpacity={scrubberOn ? .42 : .18} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

            {/* Animated recirculating airflow. */}
            {particles.map((_, i) => {
              const t = ((phase * .0055 + i / particles.length) % 1);
              let x = 370, y = 165;
              if (t < .18) { x = 370 + (t / .18) * 205; }
              else if (t < .48) { x = 575; y = 165 + ((t - .18) / .30) * 127; }
              else if (t < .75) { x = 575 - ((t - .48) / .27) * 126; y = 292; }
              else { x = 449 - ((t - .75) / .25) * 79; y = 292 - ((t - .75) / .25) * 30; }
              return <circle key={i} cx={x} cy={y} r={i % 4 === 0 ? 2.4 : 1.5} fill={i % 5 === 0 ? "#E6B85C" : flowColor} opacity={scrubberOn ? .86 : .32} />;
            })}

            {/* CO2 scrubber bed. */}
            <rect x="449" y="120" width="78" height="52" rx="8" fill={scrubberOn ? "#10251F" : "#10151B"} stroke={scrubberOn ? "#58D3AC" : "#43505C"} strokeWidth="1.4" />
            {[0,1,2,3,4].map((i) => <circle key={i} cx={463 + i * 12} cy="146" r="4" fill={scrubberOn ? "#58D3AC" : "#53606B"} opacity={.35 + (i % 2) * .2} />)}
            <text x="488" y="112" textAnchor="middle" fill="#718394" fontSize="6.5">CO₂ SCRUBBER</text>
            <text x="488" y="188" textAnchor="middle" fill={scrubberOn ? "#6DE3BB" : "#75808A"} fontSize="7" fontWeight="700">{scrubberOn ? "REMOVING CO₂" : "STANDBY"}</text>

            {/* Blower */}
            <circle cx="575" cy="221" r="27" fill="#0D151D" stroke={flowColor} strokeWidth="1.4" />
            <g style={{ transform: "rotate(" + (phase * (scrubberOn ? 7 : 1.2)) + "deg)", transformOrigin: "575px 221px" }}>
              {[0,90,180,270].map((a) => <path key={a} d="M575 221 C583 211 589 212 592 216 C589 224 583 229 575 221 Z" fill={flowColor} transform={"rotate(" + a + " 575 221)"} opacity={scrubberOn ? .9 : .45} />)}
            </g>
            <text x="575" y="258" textAnchor="middle" fill="#718394" fontSize="6.5">RECIRC BLOWER</text>

            {/* O2 supply + mixer */}
            <rect x="439" y="271" width="74" height="48" rx="8" fill="#0B1723" stroke="#4BA7E6" strokeWidth="1.3" />
            <text x="476" y="288" textAnchor="middle" fill="#80CFFF" fontSize="7">O₂ MIXER</text>
            <text x="476" y="307" textAnchor="middle" fill="#E7F4FF" fontFamily="monospace" fontSize="11" fontWeight="700">{o2Setpoint.toFixed(1)}%</text>
            <rect x="619" y="270" width="22" height="66" rx="10" fill="#0B1620" stroke="#3D79A8" />
            <rect x="623" y={326 - (o2Setpoint - 19) / 4 * 48} width="14" height={(o2Setpoint - 19) / 4 * 48 + 6} rx="6" fill="#4CB7F5" opacity=".7" />
            <text x="630" y="347" textAnchor="middle" fill="#668099" fontSize="6">O₂</text>

            {/* Oxygen injection particles. */}
            {o2Particles.map((_, i) => {
              const t = ((phase * .009 + i / o2Particles.length) % 1);
              return <circle key={i} cx={513 - t * 130} cy={292 - t * 28} r="1.7" fill="#6EC8FF" opacity={.45 + (i % 3) * .18} />;
            })}
          </g>

          {/* Power bus */}
          <g transform="translate(418 374)">
            <rect width="244" height="35" rx="8" fill="#080D13" stroke="#253242" />
            <text x="12" y="13" fill="#657789" fontSize="6.5" letterSpacing="1">POWER BUS</text>
            <text x="12" y="27" fill="#F2C76B" fontSize="10" fontFamily="monospace">28.1 V</text>
            <text x="81" y="27" fill="#F2C76B" fontSize="10" fontFamily="monospace">1.40 kW ARRAY</text>
            <text x="187" y="27" fill="#7ADAA0" fontSize="10" fontFamily="monospace">86% BAT</text>
          </g>
        </svg>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.35fr 1fr 1fr 1fr 1.15fr", gap: 7, marginTop: 9 }}>
        <button onClick={() => aeolus.fire(scrubberOn ? "scrubber-off" : "scrubber-on")} style={{ padding: "8px 7px", borderRadius: 8, border: "1px solid " + (scrubberOn ? "#4E8B78" : "#2C4456"), background: scrubberOn ? "#10261F" : "#0A1118", color: scrubberOn ? "#68E0B7" : "#86A5BD", fontSize: 9, fontWeight: 800 }}>{scrubberOn ? "SCRUBBER · ON" : "START SCRUBBER"}</button>
        {[{e:"o2-low",v:20.4},{e:"o2-nominal",v:20.9},{e:"o2-high",v:21.5}].map((o) => <button key={o.e} onClick={() => aeolus.fire(o.e)} style={{ padding: "8px 6px", borderRadius: 8, border: "1px solid " + (o2Setpoint === o.v ? "#3A86B8" : "#273442"), background: o2Setpoint === o.v ? "#102033" : "#080D13", color: o2Setpoint === o.v ? "#7CCBFF" : "#71808E", fontSize: 9, fontWeight: 750 }}>O₂ {o.v}%</button>)}
        <button onClick={() => aeolus.fire(leakActive ? "leak-seal" : "leak-start")} style={{ padding: "8px 6px", borderRadius: 8, border: "1px solid " + (leakActive ? "#9B4C48" : "#3F3740"), background: leakActive ? "#291313" : "#100E12", color: leakActive ? "#FF8178" : "#B99AAA", fontSize: 9, fontWeight: 800 }}>{leakActive ? "ISOLATE LEAK" : "SIMULATE LEAK"}</button>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, color: "#5E6A77", fontSize: 8 }}>
        <span>Shared simulated spacecraft · smooth animation rendered locally</span>
        <button onClick={() => aeolus.fire("reset-craft")} style={{ border: 0, background: "transparent", color: "#708092", cursor: "pointer", fontSize: 8 }}>RESET NOMINAL</button>
      </div>
    </div>
  );
}`;

const automations = [
  {
    key: "eclss",
    name: "Crew Environmental Control",
    cron: "* * * * *",
    scriptSource: logic,
    uiSource: ui,
    demoAccess: {
      fireEvents: ["scrubber-on", "scrubber-off", "o2-low", "o2-nominal", "o2-high", "leak-start", "leak-seal", "reset-craft"],
    },
  },
];

const panes = [
  { kind: "automation", ref: "eclss", x: 0, y: 0, w: 12, h: 16 },
  { kind: "device-grid", x: 0, y: 16, w: 12, h: 6 },
];

const dataStore = [
  {
    name: "eclss-events",
    description: "Crew environmental-control events in the simulated spacecraft",
    retentionDays: 30,
    // Seeded history so the collection is populated on first load; the seeded
    // Logic appends live rows (same shape) as visitors drive the ECLSS.
    records: [
      { payload: { event: "scrubber-on", at: Date.now() - 5_400_000 }, timestamp: Date.now() - 5_400_000 },
      { payload: { event: "pressure-leak", at: Date.now() - 3_600_000 }, timestamp: Date.now() - 3_600_000 },
      { payload: { event: "leak-sealed", at: Date.now() - 3_300_000 }, timestamp: Date.now() - 3_300_000 },
      { payload: { event: "scrubber-off", at: Date.now() - 1_800_000 }, timestamp: Date.now() - 1_800_000 },
    ],
  },
];

export default { tab, devices, automations, panes, dataStore };
