const logic = `automation({
  actions: [
    async function rovOperations(context) {
      var topic = String(context.topic || ""); var evt = topic.split("/").pop();
      function byTopic(wanted) { return devices.list().find(function(d) { return d.topic === wanted; }); }
      function setAction(label) { state.set("lastAction", { label: label, at: Date.now() }); }
      function project() {
        var telemetry = byTopic("sensor/rov/telemetry"); var vehicle = byTopic("switch/rov/vehicle/state");
        var depth = Number(telemetry && telemetry.state && telemetry.state.depth); var heading = Number(telemetry && telemetry.state && telemetry.state.heading);
        var battery = Number(telemetry && telemetry.state && telemetry.state.battery); var tether = Number(telemetry && telemetry.state && telemetry.state.tetherTension);
        var altitude = Number(telemetry && telemetry.state && telemetry.state.altitude); var visibility = Number(telemetry && telemetry.state && telemetry.state.visibility);
        var mode = String(telemetry && telemetry.state && telemetry.state.mode || vehicle && vehicle.state && vehicle.state.mode || "holding");
        if (!isNaN(depth)) state.set("depth", depth); if (!isNaN(heading)) state.set("heading", heading); if (!isNaN(battery)) state.set("battery", battery);
        if (!isNaN(tether)) state.set("tetherTension", tether); if (!isNaN(altitude)) state.set("altitude", altitude); if (!isNaN(visibility)) state.set("visibility", visibility); state.set("mode", mode);
        state.set("lightsOn", Boolean(vehicle && vehicle.state && vehicle.state.lights)); state.set("thrusterPct", Number(vehicle && vehicle.state && vehicle.state.thrusterPct || 0));
        events.emit("vessel/summary/rov", { rovDepth: isNaN(depth) ? 0 : depth, rovMode: mode, rovBattery: isNaN(battery) ? 0 : battery, rovTether: isNaN(tether) ? 0 : tether, rovHeading: isNaN(heading) ? 0 : heading, rovAltitude: isNaN(altitude) ? 0 : altitude });
      }

      async function commandRov(mode, targetDepth) {
        var vehicle = byTopic("switch/rov/vehicle/state"); var telemetry = byTopic("sensor/rov/telemetry"); if (!vehicle || !telemetry) { setAction("ROV hardware unavailable"); return; }
        if (Boolean(state.get("commandPending"))) return;
        var liveMode = String(telemetry.state && telemetry.state.mode || "holding");
        if ((liveMode === "diving" || liveMode === "recovering") && mode !== "hold") { setAction("ROV already changing depth · hold before new command"); return; }
        state.set("commandPending", true);
        var options;
        if (mode === "dive") options = { tier: "observed", deviceId: telemetry.id, condition: { field: "depth", op: "gte", value: targetDepth - 5 }, timeoutMs: 8000 };
        else if (mode === "recover") options = { tier: "observed", deviceId: telemetry.id, condition: { field: "depth", op: "lte", value: targetDepth + 8 }, timeoutMs: 8000 };
        else options = { tier: "observed", deviceId: telemetry.id, condition: { field: "mode", op: "eq", value: mode === "survey" ? "surveying" : "holding" }, timeoutMs: 5000 };
        setAction(mode === "dive" ? "ROV descending to survey altitude" : mode === "recover" ? "Recovering ROV to launch depth" : mode === "survey" ? "Starting seabed transect" : "Holding ROV position");
        var result = await devices.action(vehicle.id, "command", { payload: { mode: mode, targetDepth: targetDepth } }, options);
        state.set("commandPending", false);
        if (result.success) { setAction(mode === "survey" ? "Transect underway · telemetry verified" : mode === "dive" ? "Survey depth reached" : mode === "recover" ? "ROV recovered to launch depth" : "ROV hold verified"); events.emit("vessel/rov/command-verified", { mode: mode, lifecycleState: result.lifecycleState }); }
        else setAction("ROV command not verified: " + String(result.error || result.lifecycleState || "unknown"));
        project();
      }

      async function protectTether() {
        if (Boolean(state.get("tetherProtectionActive"))) return;
        var vehicle = byTopic("switch/rov/vehicle/state"); var telemetry = byTopic("sensor/rov/telemetry"); if (!vehicle || !telemetry) return;
        state.set("tetherProtectionActive", true); setAction("Tether load high · commanding ROV station hold");
        var result = await devices.action(vehicle.id, "command", { payload: { mode: "hold", targetDepth: Number(state.get("depth") || 0) } }, { tier: "observed", deviceId: telemetry.id, condition: { field: "mode", op: "eq", value: "holding" }, timeoutMs: 5000 });
        state.set("tetherProtectionActive", false);
        if (result.success) { setAction("ROV hold verified · tether protected"); events.emit("vessel/rov/tether-protection", { lifecycleState: result.lifecycleState }); } else setAction("ROV safety hold not verified");
        project();
      }

      if (topic.indexOf("ui/") === 0) {
        if (evt === "rov-dive") await commandRov("dive", 360);
        else if (evt === "rov-survey") await commandRov("survey", Number(state.get("depth") || 360));
        else if (evt === "rov-hold") await commandRov("hold", Number(state.get("depth") || 310));
        else if (evt === "rov-recover") await commandRov("recover", 25);
        else if (evt === "simulate-rov-current") { events.emit("vessel/sim/rov-cross-current", {}); setAction("Injecting cross-current at ROV depth"); }
        else if (evt === "reset-rov") { events.emit("vessel/sim/rov-reset", {}); state.set("tetherProtectionActive", false); setAction("Resetting ROV mission state"); }
        return;
      }
      project();
      var tether = Number(state.get("tetherTension") || 0); if (tether >= 650) await protectTether();
    },
  ],
});`;

const ui = `import { useEffect, useState } from "react";
import type { CustomComponentProps } from "./types";
export default function RovOperations(aeolus: CustomComponentProps) {
  const depth=Number(aeolus.read("depth")??310), heading=Number(aeolus.read("heading")??88), battery=Number(aeolus.read("battery")??78), tether=Number(aeolus.read("tetherTension")??310), altitude=Number(aeolus.read("altitude")??8.2), visibility=Number(aeolus.read("visibility")??14), thruster=Number(aeolus.read("thrusterPct")??18);
  const mode=String(aeolus.read("mode")||"holding"), lights=aeolus.read("lightsOn")!==false, pending=Boolean(aeolus.read("commandPending"))||Boolean(aeolus.read("tetherProtectionActive")); const last=aeolus.read("lastAction") as any; const [phase,setPhase]=useState(0);
  useEffect(()=>{const id=setInterval(()=>setPhase(v=>(v+1)%100000),90);return()=>clearInterval(id);},[]); const action=last?.label?String(last.label):"ROV telemetry online"; const high=tether>=650; const moving=mode==="diving"||mode==="recovering";
  const seabedY=170; const rovY=Math.max(65,seabedY-Math.max(2,Math.min(30,altitude))*3.1);
  return <div style={{padding:11,minHeight:"100%",background:"linear-gradient(180deg,#061219,#041018)",color:"#EDF3F5"}}>
    <div style={{display:"flex",justifyContent:"space-between",marginBottom:7}}><div><div style={{fontSize:12,fontWeight:900}}>ROV OPERATIONS</div><div style={{color:"#607B87",fontSize:7.5,marginTop:2}}>Vehicle command · tether protection · seabed survey</div></div><div style={{textAlign:"right"}}><div style={{color:high?"#F08E6B":mode==="surveying"?"#73DBA1":"#63D1E8",fontSize:9,fontWeight:850}}>{high?"TETHER PROTECTION":mode.toUpperCase()}</div><div style={{color:"#5E737C",fontSize:7}}>{Math.round(depth)} m · battery {Math.round(battery)}%</div></div></div>
    <div style={{display:"grid",gridTemplateColumns:"1.25fr .85fr",gap:7}}><div style={{border:"1px solid #1B3A49",borderRadius:10,overflow:"hidden",background:"#04131D"}}><svg width="100%" height="190" viewBox="0 0 330 190"><defs><linearGradient id="rovWater" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0A3046"/><stop offset="1" stopColor="#031019"/></linearGradient></defs><rect width="330" height="190" fill="url(#rovWater)"/><path d="M0 172 Q38 159 75 171 T150 169 T225 173 T330 164 L330 190 L0 190 Z" fill="#1D2925" stroke="#59634E"/><path d={"M25 22 C95 45 130 65 168 "+rovY} fill="none" stroke="#627B86" strokeDasharray="4 3"/>
      <g transform={"translate(170 "+rovY+") rotate("+(heading-90)+")"}><rect x="-22" y="-10" width="44" height="20" rx="5" fill="#102F3D" stroke={high?"#E27D5D":"#58D2ED"}/><circle cx="-12" cy="0" r="4" fill={lights?"#B9F4FF":"#4C626A"}/><path d="M22 -4 L33 -10 M22 4 L33 10" stroke="#58D2ED"/><circle cx="4" cy="0" r="2" fill="#77DDA0"/></g>
      {mode==="surveying"&&Array.from({length:5}).map((_,i)=><circle key={i} cx={205+((phase+i*22)%90)} cy={rovY+18+Math.sin((phase+i*9)*.13)*5} r="1.5" fill="#6ED6E9" opacity=".55"/>)}
      <line x1="214" y1={rovY} x2="214" y2={seabedY} stroke="#6FA0A8" strokeDasharray="2 3"/><text x="219" y={(rovY+seabedY)/2} fill="#6D929C" fontSize="6">{altitude.toFixed(1)} m AGL</text><text x="10" y="18" fill="#5F7F8C" fontSize="7">VIS {visibility.toFixed(0)} m</text><text x="10" y="31" fill="#5F7F8C" fontSize="7">HDG {Math.round(heading)}°</text></svg></div>
      <div style={{border:"1px solid #1B3A49",borderRadius:10,background:"#07141B",padding:9}}><div style={{color:"#687F89",fontSize:6.5,letterSpacing:".12em"}}>VEHICLE HEALTH</div><div style={{marginTop:9,color:"#697E87",fontSize:7}}>BATTERY</div><div style={{display:"flex",alignItems:"baseline",gap:4}}><span style={{fontSize:19,fontWeight:850,color:battery<30?"#E98B68":"#8CDBA0"}}>{Math.round(battery)}</span><span style={{fontSize:8,color:"#677B84"}}>%</span></div><div style={{height:5,background:"#17272E",borderRadius:4,overflow:"hidden"}}><div style={{height:"100%",width:Math.max(0,Math.min(100,battery))+"%",background:battery<30?"#D46D4E":"#55AD70"}}/></div>
      <div style={{marginTop:12,color:"#697E87",fontSize:7}}>TETHER LOAD</div><div style={{fontFamily:"monospace",fontSize:14,fontWeight:800,color:high?"#F08A68":"#C8D4D8",marginTop:2}}>{Math.round(tether)} N</div><div style={{height:5,background:"#17272E",borderRadius:4,overflow:"hidden",marginTop:3}}><div style={{height:"100%",width:Math.min(100,tether/8)+"%",background:high?"#D56646":"#4DABC0"}}/></div><div style={{marginTop:11,color:"#697E87",fontSize:7}}>THRUSTER {Math.round(thruster)}%</div></div></div>
    <div style={{marginTop:7,border:"1px solid #263F4A",borderRadius:9,padding:8,background:"#07151D"}}><div style={{color:"#80949D",fontSize:6.5,letterSpacing:".12em",marginBottom:6}}>OPERATOR CONTROLS</div><div style={{display:"flex",gap:5,flexWrap:"wrap"}}><button disabled={pending||moving} onClick={()=>aeolus.fire("rov-dive")} style={{flex:1,minWidth:75,padding:"7px",borderRadius:6,border:"1px solid #2B5E70",background:"#0B2632",color:"#72D9EF",fontSize:7.5,cursor:"pointer"}}>Dive 360 m</button><button disabled={pending||moving} onClick={()=>aeolus.fire("rov-survey")} style={{flex:1,minWidth:75,padding:"7px",borderRadius:6,border:"1px solid #315B43",background:"#102219",color:"#83DA9C",fontSize:7.5,cursor:"pointer"}}>Start transect</button><button disabled={pending} onClick={()=>aeolus.fire("rov-hold")} style={{padding:"7px 9px",borderRadius:6,border:"1px solid #454A4C",background:"#171A1C",color:"#AAB4B8",fontSize:7.5,cursor:"pointer"}}>Hold</button><button disabled={pending||moving} onClick={()=>aeolus.fire("rov-recover")} style={{padding:"7px 9px",borderRadius:6,border:"1px solid #5B4931",background:"#211A10",color:"#DDBB7B",fontSize:7.5,cursor:"pointer"}}>Recover</button></div></div>
    <div style={{marginTop:7,border:"1px dashed #69502E",borderRadius:9,padding:8,background:"#171309"}}><div style={{color:"#D8B66D",fontSize:6.5,letterSpacing:".12em"}}>DEMO SCENARIO</div><div style={{color:"#806F50",fontSize:7,margin:"3px 0 6px"}}>Inject a deep cross-current. High tether load should make Aeolus command a safe hold.</div><div style={{display:"flex",gap:5}}><button onClick={()=>aeolus.fire("simulate-rov-current")} style={{flex:1,padding:"6px",borderRadius:6,border:"1px solid #6A5130",background:"#21180B",color:"#E3B866",fontSize:7.5,cursor:"pointer"}}>Inject cross-current</button><button onClick={()=>aeolus.fire("reset-rov")} style={{padding:"6px 9px",borderRadius:6,border:"1px solid #454138",background:"#171713",color:"#898B82",fontSize:7.5,cursor:"pointer"}}>Reset mission</button></div></div>
    <div style={{color:"#5A6F78",fontSize:7,marginTop:6,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{action}</div>
  </div>;
}`;

export const rovAutomation = {
  key: "vessel-rov", name: "ROV Operations", triggerTopic: "sensor/rov/#", scriptSource: logic, uiSource: ui,
  demoAccess: { fireEvents: ["rov-dive", "rov-survey", "rov-hold", "rov-recover", "simulate-rov-current", "reset-rov"] },
};
