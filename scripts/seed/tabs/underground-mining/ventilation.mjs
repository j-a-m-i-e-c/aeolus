const logic = `automation({
  actions: [
    async function ventilationControl(context) {
      var topic = String(context.topic || ""); var evt = topic.split("/").pop();
      function byTopic(wanted) { return devices.list().find(function(d) { return d.topic === wanted; }); }
      function setAction(label) { state.set("lastAction", { label: label, at: Date.now() }); }
      function project() {
        var fan = byTopic("switch/mine/ventilation/state");
        var fs = fan && fan.state ? fan.state : {};
        state.set("mode", String(fs.mode || "auto")); state.set("demand", Number(fs.demand || 0)); state.set("primaryRpm", Number(fs.primaryRpm || 0)); state.set("boosterRpm", Number(fs.boosterRpm || 0)); state.set("airflow", Number(fs.airflow || 0)); state.set("fanOn", Boolean(fs.on));
        events.emit("mine/summary/ventilation", { mode: String(fs.mode || "auto"), demand: Number(fs.demand || 0), primaryRpm: Number(fs.primaryRpm || 0), boosterRpm: Number(fs.boosterRpm || 0), airflow: Number(fs.airflow || 0), manualOverride: Boolean(state.get("manualOverride")), requestedDemand: Number(state.get("requestedDemand") || 48) });
      }
      async function command(mode, reason) {
        var fan = byTopic("switch/mine/ventilation/state"); if (!fan) { setAction("Ventilation controller unavailable"); return; }
        if (String(fan.state && fan.state.mode || "") === mode) { setAction(reason); project(); return; }
        state.set("commandPending", true); setAction(reason);
        var result = await devices.action(fan.id, "command", { payload: { mode: mode } }, { tier: "observed", deviceId: fan.id, condition: { field: "mode", op: "eq", value: mode }, timeoutMs: 5000 });
        state.set("commandPending", false);
        if (!result.success) setAction("Ventilation command not verified: " + String(result.error || result.lifecycleState || "unknown"));
        project();
      }

      if (topic.indexOf("ui/") === 0) {
        if (evt === "force-boost") { state.set("manualOverride", true); await command("boost", "Manual ventilation boost enabled"); }
        else if (evt === "return-auto") { state.set("manualOverride", false); var demand = Number(state.get("requestedDemand") || 48); await command(demand >= 80 ? "boost" : "auto", "Ventilation returned to atmospheric demand"); }
        return;
      }

      if (topic.indexOf("/mine/atmosphere/vent-demand") < 0) return;
      var payload = context.state && typeof context.state === "object" ? context.state : {};
      var demand = Number(payload.demand || 48); var severity = String(payload.severity || "safe");
      state.set("requestedDemand", demand); state.set("atmosphereSeverity", severity);
      if (!Boolean(state.get("manualOverride"))) {
        if (demand >= 80) await command("boost", "Atmospheric Safety requested maximum ventilation");
        else await command("auto", "Atmosphere safe · ventilation returned to demand control");
      } else project();
    },
  ],
});`;

const ui = `import { useEffect, useState } from "react";
import type { CustomComponentProps } from "./types";
export default function VentilationControl(aeolus: CustomComponentProps) {
  const mode=String(aeolus.read("mode")||"auto"), demand=Number(aeolus.read("demand")??48), requested=Number(aeolus.read("requestedDemand")??48), rpm=Number(aeolus.read("primaryRpm")??1136), booster=Number(aeolus.read("boosterRpm")??840), airflow=Number(aeolus.read("airflow")??258), manual=Boolean(aeolus.read("manualOverride")), pending=Boolean(aeolus.read("commandPending")), severity=String(aeolus.read("atmosphereSeverity")||"safe"), last=aeolus.read("lastAction") as any;
  const [phase,setPhase]=useState(0); useEffect(()=>{const id=setInterval(()=>setPhase(v=>(v+1)%100000),90);return()=>clearInterval(id);},[]); const boost=mode==="boost"; const color=boost?"#F0B85D":"#62D2EA"; const action=last?.label?String(last.label):"Ventilation demand controller online";
  return <div style={{padding:11,minHeight:"100%",background:"linear-gradient(180deg,#0A0D0F,#07090B)",color:"#EDF2F4"}}>
    <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}><div><div style={{fontSize:12,fontWeight:900}}>VENTILATION CONTROL</div><div style={{fontSize:11,color:"#717B81",marginTop:2}}>Atmospheric demand → primary + booster fans → measured airflow</div></div><div style={{textAlign:"right"}}><div style={{fontSize:11,fontWeight:850,color}}>{manual?"MANUAL BOOST":boost?"AUTO BOOST":"DEMAND AUTO"}</div><div style={{fontSize:11,color:"#69747A"}}>{airflow} m³/s</div></div></div>
    <div style={{border:"1px solid #30363A",borderRadius:10,background:"#0B0E10",padding:7}}><svg width="100%" height="155" viewBox="0 0 440 155">
      <path d="M38 78 H168 V42 H273 V78 H400" fill="none" stroke="#31393E" strokeWidth="18"/><path d="M38 78 H168 V42 H273 V78 H400" fill="none" stroke="#565F64" strokeWidth="2"/>
      {Array.from({length:9}).map((_,i)=>{const p=((phase*(.006+demand*.00006)+i/9)%1);const x=42+p*354;const y=x<168?78:x<273?42:78;return <circle key={i} cx={x} cy={y} r={i%3===0?2.2:1.5} fill={color} opacity={.45+demand/190}/>})}
      <g transform="translate(78 78)"><circle r="26" fill="#121619" stroke={color}/><g style={{transform:"rotate("+(phase*(4+demand*.09))+"deg)",transformOrigin:"0px 0px"}}>{[0,90,180,270].map(a=><path key={a} d="M0 0 C9 -10 17 -8 19 -3 C13 3 7 5 0 0 Z" fill={color} transform={"rotate("+a+")"}/>)}</g><text x="0" y="42" textAnchor="middle" fill="#8B959A" fontSize="10">PRIMARY {rpm}</text></g>
      <g transform="translate(295 78)"><circle r="19" fill="#121619" stroke="#E0A34A"/><g style={{transform:"rotate("+(phase*(3+demand*.08))+"deg)",transformOrigin:"0px 0px"}}><line x1="-12" y1="0" x2="12" y2="0" stroke="#E0A34A" strokeWidth="3"/><line x1="0" y1="-12" x2="0" y2="12" stroke="#E0A34A" strokeWidth="3"/></g><text x="0" y="35" textAnchor="middle" fill="#8B7B61" fontSize="10">BOOSTER {booster}</text></g>
      <text x="186" y="22" fill="#707A80" fontSize="10">RETURN AIRWAY</text><text x="350" y="104" fill="#707A80" fontSize="10">EXHAUST</text>
    </svg></div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginTop:7}}><div style={{border:"1px solid #30363A",borderRadius:8,padding:7,background:"#0B0E10"}}><div style={{fontSize:11,color:"#707A80"}}>ATMOSPHERIC REQUEST</div><div style={{fontSize:17,fontFamily:"monospace",fontWeight:800,color:requested>=80?"#F0B85D":"#B9C7CC",marginTop:2}}>{Math.round(requested)}%</div><div style={{fontSize:11,color:"#626D72"}}>{severity.toUpperCase()} from Atmospheric Safety</div></div><div style={{border:"1px solid #30363A",borderRadius:8,padding:7,background:"#0B0E10"}}><div style={{fontSize:11,color:"#707A80"}}>PHYSICAL OUTPUT</div><div style={{fontSize:17,fontFamily:"monospace",fontWeight:800,color,marginTop:2}}>{airflow} m³/s</div><div style={{fontSize:11,color:"#626D72"}}>fan mode {mode}</div></div></div>
    <div style={{marginTop:7,border:"1px solid #343A3E",borderRadius:9,padding:8,background:"#0D1012"}}><div style={{fontSize:11,color:"#8D969B",letterSpacing:".12em",marginBottom:6}}>OPERATOR CONTROLS</div><div style={{display:"flex",gap:5}}><button disabled={pending||manual} onClick={()=>aeolus.fire("force-boost")} style={{flex:1,padding:"7px",borderRadius:6,border:"1px solid #69512E",background:"#21180B",color:"#E4B96A",fontSize:11,cursor:"pointer"}}>Force boost</button><button disabled={pending||!manual} onClick={()=>aeolus.fire("return-auto")} style={{flex:1,padding:"7px",borderRadius:6,border:"1px solid #365946",background:"#102019",color:"#84D7A0",fontSize:11,cursor:"pointer"}}>Return to auto</button></div><div style={{fontSize:11,color:"#626B70",marginTop:6}}>Automatic boost requests come over the Aeolus event bus from Atmospheric Safety. This pane owns the fan actuator.</div></div>
    <div style={{fontSize:11,color:"#60696D",marginTop:6,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{action}</div>
  </div>;
}`;

export const ventilationAutomation = {
  key: "mine-ventilation", name: "Ventilation Control", triggerTopic: "aeolus/events/+/mine/atmosphere/#", scriptSource: logic, uiSource: ui,
  demoAccess: { fireEvents: ["force-boost", "return-auto"] },
};
