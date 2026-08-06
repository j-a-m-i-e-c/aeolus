// scripts/seed/tabs/off-grid-bunker.mjs — Off-grid continuity bunker Easter egg.
//
// The zombies are intentionally character, not the architecture. Underneath the
// joke are legitimate edge concerns: perimeter sensing, local floodlighting,
// off-grid generation/storage, positive-pressure filtration, water/food burn
// down and radio comms. Everything remains simulated and bounded in public demo.

import { genSeries, round, noise } from "../lib.mjs";

const tab = { id: "tab-bunker", name: "Off-Grid Bunker", icon: "shield" };

const devices = [
  { topic: "sensor/bunker/perimeter", payload: { sector: "east", contacts: 0, classification: "none" } },
  { topic: "light/bunker/floodlights", payload: { on: true, brightness: 100, mode: "motion" } },
  { topic: "sensor/bunker/generator", payload: { on: true, fuel: 62, co: 8 } },
  { topic: "sensor/bunker/power", payload: { solar: 1800, battery: 74, load: 1200 } },
  { topic: "switch/bunker/nbc-filter", payload: { on: true, overpressure: 12, filterLife: 78, sealed: false } },
  { topic: "sensor/bunker/supplies", payload: { food: 64, water: 80, meds: 45, beans: 312 } },
  { topic: "sensor/bunker/radio", payload: { frequency: 146.52, contacts: 3, online: true } },
];

const logic = `automation({
  actions: [
    function bunker(context) {
      function init(key, value) {
        if (state.get(key) === undefined) state.set(key, value);
      }
      var now = Date.now();
      init("contacts", 0);
      init("breachSector", "east");
      init("contactSeq", 0);
      init("floodlights", true);
      init("sealed", false);
      init("filterOn", true);
      init("overpressure", 12);
      init("filterLife", 78);
      init("fuel", 62);
      init("battery", 74);
      init("solar", 1800);
      init("load", 1200);
      init("food", 64);
      init("water", 80);
      init("meds", 45);
      init("beans", 312);
      init("radioPingUntil", 0);
      init("lastAction", { label: "Local systems online. Internet optional.", at: now });

      var evt = String(context.topic || "").split("/").pop();
      if (evt === "shuffle") {
        var sectors = ["east", "north", "west", "south"];
        var seq = Number(state.get("contactSeq") || 0) + 1;
        var sector = sectors[seq % sectors.length];
        var contacts = 1 + (seq % 4);
        state.set("contactSeq", seq);
        state.set("breachSector", sector);
        state.set("contacts", contacts);
        state.set("floodlights", true);
        state.set("lastAction", { label: "Shambling bipeds detected — " + sector + " perimeter", at: now });
        mqtt.publish("sensor/bunker/perimeter", JSON.stringify({ sector: sector, contacts: contacts, classification: "shambling-biped" }));
        mqtt.publish("light/bunker/floodlights", JSON.stringify({ on: true, brightness: 100, mode: "motion" }));
        try { if (db) db.write("perimeter-events", { sector: sector, contacts: contacts, classification: "shambling-biped" }); } catch (e) {}
        log.warn("Perimeter event: " + contacts + " shambling contacts in " + sector + " sector");
      } else if (evt === "all-clear") {
        state.set("contacts", 0);
        state.set("lastAction", { label: "Perimeter clear. Probably just possums.", at: now });
        mqtt.publish("sensor/bunker/perimeter", JSON.stringify({ sector: state.get("breachSector"), contacts: 0, classification: "none" }));
      } else if (evt === "seal") {
        state.set("sealed", true);
        state.set("overpressure", 15);
        state.set("load", 1320);
        state.set("lastAction", { label: "Bunker sealed — positive-pressure mode", at: now });
        mqtt.publish("switch/bunker/nbc-filter", JSON.stringify({ on: true, overpressure: 15, filterLife: state.get("filterLife"), sealed: true }));
      } else if (evt === "unseal") {
        state.set("sealed", false);
        state.set("overpressure", 8);
        state.set("load", 1200);
        state.set("lastAction", { label: "Airlock returned to normal ventilation", at: now });
        mqtt.publish("switch/bunker/nbc-filter", JSON.stringify({ on: true, overpressure: 8, filterLife: state.get("filterLife"), sealed: false }));
      } else if (evt === "lights-toggle") {
        var lights = !Boolean(state.get("floodlights"));
        state.set("floodlights", lights);
        state.set("lastAction", { label: lights ? "Perimeter floodlights online" : "Perimeter floodlights dark", at: now });
        mqtt.publish("light/bunker/floodlights", JSON.stringify({ on: lights, brightness: lights ? 100 : 0, mode: "manual" }));
      } else if (evt === "radio-check") {
        state.set("radioPingUntil", now + 6500);
        state.set("lastAction", { label: "146.52 MHz: distant voice, three words intelligible", at: now });
        mqtt.publish("sensor/bunker/radio", JSON.stringify({ frequency: 146.52, contacts: 4, online: true }));
      } else if (evt === "count-beans") {
        var beans = Number(state.get("beans") || 312);
        state.set("lastAction", { label: "Inventory confirmed: " + beans + " tins of beans. Morale unchanged.", at: now });
      } else if (evt === "reset-bunker") {
        state.set("contacts", 0);
        state.set("breachSector", "east");
        state.set("floodlights", true);
        state.set("sealed", false);
        state.set("filterOn", true);
        state.set("overpressure", 12);
        state.set("filterLife", 78);
        state.set("fuel", 62);
        state.set("battery", 74);
        state.set("solar", 1800);
        state.set("load", 1200);
        state.set("food", 64);
        state.set("water", 80);
        state.set("meds", 45);
        state.set("beans", 312);
        state.set("radioPingUntil", 0);
        state.set("lastAction", { label: "Continuity node reset. Cloud still unavailable.", at: now });
      }
    },
  ],
});`;

const ui = `import { useEffect, useState } from "react";
import type { CustomComponentProps } from "./types";

function Zombie(props: { x: number; y: number; phase: number; lit: boolean; scale?: number }) {
  const s = props.scale || 1;
  const sway = Math.sin(props.phase) * 3;
  const c = props.lit ? "#849277" : "#313A31";
  return <g transform={"translate(" + props.x + " " + props.y + ") scale(" + s + ")"} stroke={c} fill={c} opacity={props.lit ? .9 : .54}>
    <circle cx={sway * .15} cy="-23" r="6" />
    <path d={"M0 -17 Q" + (7 + sway) + " -6 " + sway + " 8"} fill="none" strokeWidth="7" strokeLinecap="round" />
    <line x1={sway} y1="-8" x2={-15 + sway} y2="0" strokeWidth="4" strokeLinecap="round" />
    <line x1={sway + 2} y1="-6" x2={16 + sway} y2="-2" strokeWidth="4" strokeLinecap="round" />
    <line x1={sway} y1="8" x2={-8 + sway} y2="25" strokeWidth="5" strokeLinecap="round" />
    <line x1={sway} y1="8" x2={9 + sway} y2="26" strokeWidth="5" strokeLinecap="round" />
  </g>;
}

export default function ContinuityBunker(aeolus: CustomComponentProps) {
  const contacts = Number(aeolus.read("contacts") ?? 0);
  const breachSector = String(aeolus.read("breachSector") ?? "east");
  const floodlights = Boolean(aeolus.read("floodlights") ?? true);
  const sealed = Boolean(aeolus.read("sealed"));
  const overpressure = Number(aeolus.read("overpressure") ?? 12);
  const filterLife = Number(aeolus.read("filterLife") ?? 78);
  const fuel = Number(aeolus.read("fuel") ?? 62);
  const battery = Number(aeolus.read("battery") ?? 74);
  const solar = Number(aeolus.read("solar") ?? 1800);
  const load = Number(aeolus.read("load") ?? 1200);
  const food = Number(aeolus.read("food") ?? 64);
  const water = Number(aeolus.read("water") ?? 80);
  const meds = Number(aeolus.read("meds") ?? 45);
  const beans = Number(aeolus.read("beans") ?? 312);
  const radioPingUntil = Number(aeolus.read("radioPingUntil") ?? 0);
  const lastAction = aeolus.read("lastAction") as any;

  const [now, setNow] = useState(Date.now());
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const id = setInterval(() => { setNow(Date.now()); setPhase((v) => (v + 1) % 100000); }, 90);
    return () => clearInterval(id);
  }, []);

  const radioActive = now < radioPingUntil;
  const alert = contacts > 0;
  const actionLabel = lastAction && lastAction.label ? String(lastAction.label) : "Local systems online. Internet optional.";
  const daysFuel = Math.round((fuel / 100 * 200 / 2 / 24) * 10) / 10;
  const net = solar - load;
  const beam = floodlights ? "#FFE6A8" : "#2B302C";
  const airflow = Array.from({ length: 13 });

  return (
    <div style={{ minHeight: "100%", padding: 14, color: "#E7EBE5", background: "linear-gradient(180deg,#090A08 0%,#060705 100%)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 10 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 850, letterSpacing: ".025em" }}>CONTINUITY NODE 07</span>
            <span style={{ fontSize: 8, border: "1px solid #4B5136", background: "#16180E", borderRadius: 999, padding: "2px 7px", color: "#C9CF82", letterSpacing: ".1em" }}>LOCAL NETWORK ONLY</span>
          </div>
          <div style={{ color: "#74786A", fontSize: 9, marginTop: 3 }}>Power · air · perimeter · water · supplies · radio · no cloud dependency</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: alert ? "#FF766D" : "#92D78D", fontSize: 10, fontWeight: 850 }}>{alert ? contacts + " SHAMBLING CONTACT" + (contacts === 1 ? "" : "S") : "PERIMETER QUIET"}</div>
          <div style={{ color: "#666B60", fontSize: 8, marginTop: 2 }}>{actionLabel}</div>
        </div>
      </div>

      <div style={{ border: "1px solid #34372D", borderRadius: 14, overflow: "hidden", background: "#050604" }}>
        <svg width="100%" height="475" viewBox="0 0 720 475" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="nightSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#080B0D"/><stop offset="1" stopColor="#10130E"/></linearGradient>
            <linearGradient id="earth" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#252319"/><stop offset="1" stopColor="#14130E"/></linearGradient>
            <linearGradient id="beam"><stop offset="0" stopColor="#FFE8A8" stopOpacity=".40"/><stop offset="1" stopColor="#FFE8A8" stopOpacity="0"/></linearGradient>
            <filter id="lampGlow"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          </defs>

          {/* Surface / night. */}
          <rect width="720" height="142" fill="url(#nightSky)" />
          <circle cx="602" cy="40" r="25" fill="#D7D6B4" opacity=".18" />
          {Array.from({ length: 28 }).map((_, i) => <circle key={i} cx={(i * 83) % 720} cy={(i * 37) % 92} r={i % 5 === 0 ? 1 : .55} fill="#E6E6D2" opacity={.15 + (i % 4) * .1} />)}
          <path d="M0 110 L80 81 L133 104 L210 71 L292 111 L366 87 L454 109 L531 72 L612 100 L720 78 V142 H0 Z" fill="#11140F" />
          <rect y="132" width="720" height="343" fill="url(#earth)" />
          <line x1="0" y1="132" x2="720" y2="132" stroke="#474438" strokeWidth="1" />

          {/* Fence and surface sensors. */}
          <path d="M30 121 H690" stroke="#59604A" strokeWidth="2" strokeDasharray="11 4" />
          {[74,203,520,649].map((x, i) => <g key={i}><line x1={x} y1="106" x2={x} y2="130" stroke={alert && i === 3 ? "#FF7168" : "#687055"} strokeWidth="2"/><circle cx={x} cy="104" r="3" fill={alert && i === 3 ? "#FF7168" : "#7A8463"} opacity={.55 + Math.sin(phase * .18 + i) * .2}/></g>)}

          {/* Floodlight towers. */}
          <g>
            <line x1="121" y1="127" x2="121" y2="84" stroke="#6D705D" strokeWidth="3" /><rect x="108" y="77" width="24" height="10" rx="2" fill="#282A22" stroke="#7C7D68" />
            <line x1="598" y1="127" x2="598" y2="84" stroke="#6D705D" strokeWidth="3" /><rect x="586" y="77" width="24" height="10" rx="2" fill="#282A22" stroke="#7C7D68" />
            {floodlights && <><path d="M108 83 L8 112 L8 69 Z" fill="url(#beam)"/><path d="M610 83 L711 112 L711 69 Z" fill="url(#beam)"/></>}
            <circle cx="114" cy="82" r="3" fill={beam} filter="url(#lampGlow)" /><circle cx="604" cy="82" r="3" fill={beam} filter="url(#lampGlow)" />
          </g>

          {/* The surface view follows whichever perimeter camera is active. */}
          {alert && <text x="690" y="102" textAnchor="end" fill="#8A8D7A" fontSize="6" letterSpacing="1">PERIMETER CAM · {breachSector.toUpperCase()}</text>}

          {/* The undead Easter egg: silhouettes only, no gore. */}
          {Array.from({ length: Math.min(contacts, 4) }).map((_, i) => {
            const bx = 655 - i * 42 + Math.sin(phase * .025 + i) * 8;
            const by = 119 - (i % 2) * 3;
            return <Zombie key={i} x={bx} y={by} phase={phase * .08 + i * 1.7} lit={floodlights} scale={.78 + i * .04} />;
          })}
          {alert && <g transform="translate(454 28)"><rect width="154" height="42" rx="7" fill="#160D0B" stroke="#6F3833"/><text x="11" y="14" fill="#A96E67" fontSize="6.5" letterSpacing="1">EDGE CLASSIFIER</text><text x="11" y="31" fill="#F28A80" fontSize="10" fontFamily="monospace" fontWeight="700">SHAMBLING BIPED · 87%</text></g>}

          {/* Bunker shell cutaway. */}
          <rect x="75" y="160" width="570" height="277" rx="12" fill="#11120F" stroke="#555548" strokeWidth="2" />
          <rect x="91" y="176" width="538" height="245" rx="7" fill="#0A0B09" stroke="#292B24" />

          {/* POWER ROOM */}
          <g>
            <rect x="105" y="192" width="150" height="105" rx="6" fill="#10110E" stroke="#303126" />
            <text x="116" y="207" fill="#777A68" fontSize="6.5" letterSpacing="1.2">POWER ROOM</text>
            <rect x="118" y="222" width="66" height="48" rx="6" fill="#161811" stroke="#8A7748" />
            <circle cx="150" cy="245" r="15" fill="#0D0E0B" stroke="#B4934C" />
            <g style={{ transform: "rotate(" + (phase * 5) + "deg)", transformOrigin: "150px 245px" }}>{[0,90,180,270].map((a) => <line key={a} x1="150" y1="234" x2="150" y2="256" stroke="#C9A45B" strokeWidth="3" transform={"rotate(" + a + " 150 245)"}/>)}</g>
            <text x="151" y="282" textAnchor="middle" fill="#95815C" fontSize="6">GENERATOR · {fuel}% FUEL</text>
            <rect x="199" y="220" width="37" height="54" rx="5" fill="#121713" stroke="#4B7250" />
            <rect x="205" y={268 - battery * .42} width="25" height={battery * .42} rx="3" fill="#6EB474" opacity=".65" />
            <text x="217" y="287" textAnchor="middle" fill="#729178" fontSize="6">BAT {battery}%</text>
            <path d="M184 245 H199" stroke="#D7B65E" strokeWidth="2" strokeDasharray="3 2" />
          </g>

          {/* COMMAND ROOM */}
          <g>
            <rect x="270" y="192" width="181" height="105" rx="6" fill="#0E110E" stroke="#30372E" />
            <text x="281" y="207" fill="#777F72" fontSize="6.5" letterSpacing="1.2">COMMAND / RADIO</text>
            <rect x="285" y="220" width="74" height="46" rx="4" fill="#071009" stroke="#47624A" />
            <path d="M294 248 L306 241 L319 247 L331 232 L348 242" fill="none" stroke={radioActive ? "#88E29B" : "#55725A"} strokeWidth="1.3" />
            <line x1="293" y1="254" x2="351" y2="254" stroke="#25402B" />
            <text x="322" y="278" textAnchor="middle" fill="#718076" fontFamily="monospace" fontSize="7">146.520 MHz</text>
            <rect x="372" y="218" width="62" height="55" rx="4" fill="#080B08" stroke={alert ? "#78413A" : "#36423A"} />
            <text x="403" y="231" textAnchor="middle" fill="#66736A" fontSize="5.5">PERIMETER</text>
            <rect x="389" y="238" width="28" height="24" rx="3" fill="#151A14" stroke="#55604F" />
            {[{x:403,y:235,n:"N"},{x:421,y:250,n:"E"},{x:403,y:267,n:"S"},{x:385,y:250,n:"W"}].map((s) => <g key={s.n}><circle cx={s.x} cy={s.y} r="2.5" fill={alert && s.n.toLowerCase() === breachSector.charAt(0) ? "#FF7168" : "#65725C"}/><text x={s.x} y={s.y - 4} textAnchor="middle" fill="#657066" fontSize="4.5">{s.n}</text></g>)}
            {radioActive && [0,1,2].map((i) => <circle key={i} cx="322" cy="243" r={20 + ((phase * 2 + i * 12) % 36)} fill="none" stroke="#7ADB8D" strokeOpacity={.35 - i * .08} strokeWidth="1" />)}
          </g>

          {/* AIRLOCK / FILTRATION */}
          <g>
            <rect x="466" y="192" width="147" height="105" rx="6" fill={sealed ? "#101812" : "#11120F"} stroke={sealed ? "#4E774E" : "#34352D"} />
            <text x="477" y="207" fill="#777F72" fontSize="6.5" letterSpacing="1.2">AIR / AIRLOCK</text>
            <rect x="478" y="221" width="34" height="47" rx="4" fill="#141814" stroke={filterLife < 25 ? "#D17A57" : "#5B7C58"} />
            {[0,1,2,3].map((i) => <line key={i} x1={484 + i * 7} y1="226" x2={484 + i * 7} y2="263" stroke="#567152" strokeWidth="2" />)}
            <text x="495" y="278" textAnchor="middle" fill="#71806F" fontSize="5.8">FILTER {filterLife}%</text>
            <rect x="550" y="217" width="45" height="62" rx="4" fill="#0D0E0C" stroke={sealed ? "#6A9266" : "#55564C"} strokeWidth="2" />
            <line x1="560" y1="217" x2="560" y2="279" stroke="#37392F" /><circle cx="585" cy="248" r="3" fill={sealed ? "#7ED37A" : "#8B8B78"} />
            {airflow.map((_, i) => {
              const t = ((phase * .008 + i / airflow.length) % 1);
              return <circle key={i} cx={512 + t * 39} cy={236 + Math.sin(i * 1.7) * 10} r="1.5" fill="#78CF7C" opacity={sealed ? .8 : .35} />;
            })}
            <text x="548" y="291" textAnchor="middle" fill={sealed ? "#75C872" : "#777A70"} fontSize="6">{sealed ? "+" + overpressure + " Pa · SEALED" : "NORMAL VENT"}</text>
          </g>

          {/* SUPPLIES / WATER */}
          <g>
            <rect x="105" y="313" width="508" height="91" rx="6" fill="#0D0E0B" stroke="#303128" />
            <text x="116" y="328" fill="#767867" fontSize="6.5" letterSpacing="1.2">SUPPLIES / WATER / ESSENTIAL SERVICES</text>
            <rect x="122" y="342" width="61" height="46" rx="4" fill="#111711" stroke="#46684A" />
            <rect x="129" y={382 - water * .35} width="47" height={water * .35} rx="3" fill="#3A90B1" opacity=".7" />
            <text x="152" y="399" textAnchor="middle" fill="#6698A7" fontSize="6">WATER {water}%</text>

            {/* Bean shelf: intentionally the joke. */}
            <rect x="205" y="342" width="125" height="46" rx="4" fill="#12120E" stroke="#4B4B3A" />
            {[0,1,2,3,4,5,6,7,8].map((i) => <g key={i}><rect x={214 + (i % 5) * 21} y={350 + Math.floor(i / 5) * 17} width="11" height="13" rx="2" fill={i % 3 === 0 ? "#856845" : "#69724E"}/><line x1={216 + (i % 5) * 21} y1={353 + Math.floor(i / 5) * 17} x2={223 + (i % 5) * 21} y2={353 + Math.floor(i / 5) * 17} stroke="#B6AD75" strokeWidth="1"/></g>)}
            <text x="267" y="399" textAnchor="middle" fill="#93896A" fontSize="6">BEANS · {beans} TINS</text>

            <g transform="translate(352 345)">
              {[{n:"FOOD",v:food,c:"#8EA761"},{n:"MEDS",v:meds,c:"#A67575"}].map((it, i) => <g key={it.n} transform={"translate(" + (i * 100) + " 0)"}><text x="0" y="8" fill="#6F7264" fontSize="6">{it.n}</text><rect x="0" y="15" width="76" height="8" rx="4" fill="#202118"/><rect x="0" y="15" width={it.v * .76} height="8" rx="4" fill={it.c}/><text x="0" y="37" fill="#9A9C8A" fontFamily="monospace" fontSize="8">{it.v}%</text></g>)}
            </g>
          </g>

          {/* Status plaque */}
          <g transform="translate(75 444)">
            <text x="0" y="11" fill="#686B60" fontSize="6.5" letterSpacing="1">POWER</text><text x="48" y="11" fill={net >= 0 ? "#8FCB80" : "#D5A35F"} fontFamily="monospace" fontSize="8">{net >= 0 ? "+" : ""}{net} W NET</text>
            <text x="162" y="11" fill="#686B60" fontSize="6.5" letterSpacing="1">DIESEL</text><text x="212" y="11" fill="#C5AD71" fontFamily="monospace" fontSize="8">~{daysFuel} DAYS</text>
            <text x="306" y="11" fill="#686B60" fontSize="6.5" letterSpacing="1">CLOUD</text><text x="347" y="11" fill="#9B716A" fontFamily="monospace" fontSize="8">PRESUMED EATEN</text>
          </g>
        </svg>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.15fr 1fr 1fr 1fr 1fr 1fr", gap: 7, marginTop: 9 }}>
        <button onClick={() => aeolus.fire("shuffle")} style={{ padding: "8px 6px", borderRadius: 8, border: "1px solid #673A35", background: "#180D0B", color: "#E78379", fontSize: 9, fontWeight: 800 }}>SIMULATE SHUFFLING</button>
        <button onClick={() => aeolus.fire("all-clear")} style={{ padding: "8px 6px", borderRadius: 8, border: "1px solid #354937", background: "#0B120C", color: "#8DB98B", fontSize: 9, fontWeight: 800 }}>ALL CLEAR</button>
        <button onClick={() => aeolus.fire(sealed ? "unseal" : "seal")} style={{ padding: "8px 6px", borderRadius: 8, border: "1px solid " + (sealed ? "#4E754B" : "#48483C"), background: sealed ? "#0C170D" : "#11110D", color: sealed ? "#7ED17B" : "#A3A392", fontSize: 9, fontWeight: 800 }}>{sealed ? "BUNKER · SEALED" : "SEAL BUNKER"}</button>
        <button onClick={() => aeolus.fire("lights-toggle")} style={{ padding: "8px 6px", borderRadius: 8, border: "1px solid #544C34", background: "#131108", color: floodlights ? "#D9C27E" : "#858171", fontSize: 9, fontWeight: 800 }}>{floodlights ? "FLOODLIGHTS · ON" : "LIGHTS OFF"}</button>
        <button onClick={() => aeolus.fire("radio-check")} style={{ padding: "8px 6px", borderRadius: 8, border: "1px solid #38503C", background: "#0B120D", color: radioActive ? "#78D98A" : "#8AA18D", fontSize: 9, fontWeight: 800 }}>RADIO CHECK</button>
        <button onClick={() => aeolus.fire("count-beans")} style={{ padding: "8px 6px", borderRadius: 8, border: "1px solid #554B35", background: "#131008", color: "#C0AE75", fontSize: 9, fontWeight: 800 }}>COUNT BEANS</button>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, color: "#62665B", fontSize: 8 }}>
        <span>Built for the real world. And the undead one.</span>
        <button onClick={() => aeolus.fire("reset-bunker")} style={{ border: 0, background: "transparent", color: "#73776B", cursor: "pointer", fontSize: 8 }}>RESET CONTINUITY NODE</button>
      </div>
    </div>
  );
}`;

const automations = [
  {
    key: "bunker",
    name: "Continuity Bunker",
    triggerTopic: "none",
    scriptSource: logic,
    uiSource: ui,
    demoAccess: {
      fireEvents: ["shuffle", "all-clear", "seal", "unseal", "lights-toggle", "radio-check", "count-beans", "reset-bunker"],
    },
  },
];

const panes = [
  { kind: "automation", ref: "bunker", x: 0, y: 0, w: 12, h: 18 },
  { kind: "device-grid", x: 0, y: 18, w: 12, h: 5 },
];

const dataStore = [
  {
    name: "perimeter-events",
    description: "Perimeter motion/classification events from the off-grid continuity demo",
    retentionDays: 30,
    records: genSeries({
      count: 42,
      intervalMs: 95 * 60_000,
      fields: {
        sector: () => ["north", "east", "south", "west"][Math.floor(Math.random() * 4)],
        contacts: () => Math.random() > .72 ? 1 + Math.floor(Math.random() * 3) : 0,
        classification: () => Math.random() > .72 ? "shambling-biped" : "wildlife",
      },
    }),
  },
  {
    name: "supply-history",
    description: "Bunker supply burn-down over seven days",
    retentionDays: 90,
    records: genSeries({
      count: 84,
      intervalMs: 2 * 3_600_000,
      fields: {
        food: (i) => round(85 - i * .25 + noise(1), 0),
        water: (i) => round(95 - i * .18 + noise(1), 0),
        meds: (i) => round(55 - i * .12 + noise(.5), 0),
      },
    }),
  },
];

export default { tab, devices, automations, panes, dataStore };
