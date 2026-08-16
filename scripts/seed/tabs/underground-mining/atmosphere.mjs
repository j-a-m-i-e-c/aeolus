const logic = `automation({
  actions: [
    function atmosphericSafety(context) {
      var topic = String(context.topic || "");
      var evt = topic.split("/").pop();
      function byTopic(wanted) { return devices.list().find(function(d) { return d.topic === wanted; }); }
      function setAction(label) { state.set("lastAction", { label: label, at: Date.now() }); }
      function numberAt(device, field, fallback) { var n = Number(device && device.state && device.state[field]); return isNaN(n) ? fallback : n; }

      function project(allowDemandEvent) {
        var l3 = byTopic("sensor/mine/gas/l3");
        var d7 = byTopic("sensor/mine/gas/drift-7");
        var l3ch4 = numberAt(l3, "ch4", 0.30);
        var d7ch4 = numberAt(d7, "ch4", 0.42);
        var co = numberAt(d7, "co", 16);
        var o2 = numberAt(d7, "o2", 20.7);
        var no2 = numberAt(d7, "no2", 1.6);
        var severity = d7ch4 >= 1 ? "alarm" : d7ch4 >= 0.5 ? "warning" : "safe";
        var demand = severity === "alarm" ? 100 : severity === "warning" ? 78 : 48;
        var wasAlarm = Boolean(state.get("alarm"));
        state.set("l3Ch4", l3ch4); state.set("d7Ch4", d7ch4); state.set("co", co); state.set("o2", o2); state.set("no2", no2);
        state.set("severity", severity); state.set("alarm", severity === "alarm"); state.set("ventDemand", demand);
        if (!wasAlarm && severity === "alarm") { state.set("acknowledged", false); setAction("Drift 7 methane alarm · requesting maximum ventilation"); }
        if (wasAlarm && severity !== "alarm") setAction("Drift 7 atmosphere returned below alarm threshold");
        if (allowDemandEvent) {
          var band = severity + ":" + demand;
          if (String(state.get("lastDemandBand") || "") !== band) {
            state.set("lastDemandBand", band);
            events.emit("mine/atmosphere/vent-demand", { demand: demand, severity: severity, ch4: d7ch4 });
          }
        }
        events.emit("mine/summary/atmosphere", { l3Ch4: l3ch4, d7Ch4: d7ch4, co: co, o2: o2, no2: no2, severity: severity, alarm: severity === "alarm", acknowledged: Boolean(state.get("acknowledged")), ventDemand: demand });
      }

      if (topic.indexOf("ui/") === 0) {
        if (evt === "acknowledge-alarm") { state.set("acknowledged", true); setAction("Atmospheric alarm acknowledged by operator"); project(false); }
        else if (evt === "simulate-gas-rise") { events.emit("mine/sim/gas-rise", {}); setAction("Injecting a transient methane pocket at Drift 7"); }
        else if (evt === "reset-atmosphere") { events.emit("mine/sim/atmosphere-reset", {}); state.set("acknowledged", false); state.set("lastDemandBand", ""); setAction("Resetting mine atmosphere to nominal conditions"); }
        return;
      }

      if (topic.indexOf("sensor/mine/gas/") !== 0) return;
      project(true);
    },
  ],
});`;

const ui = `import type { CustomComponentProps } from "./types";
function clamp(v:number,a:number,b:number){return Math.min(b,Math.max(a,v));}
export default function AtmosphericSafety(aeolus: CustomComponentProps) {
  const l3=Number(aeolus.read("l3Ch4")??.30), d7=Number(aeolus.read("d7Ch4")??.42), co=Number(aeolus.read("co")??16), o2=Number(aeolus.read("o2")??20.7), no2=Number(aeolus.read("no2")??1.6);
  const severity=String(aeolus.read("severity")||"safe"), alarm=Boolean(aeolus.read("alarm")), ack=Boolean(aeolus.read("acknowledged")), demand=Number(aeolus.read("ventDemand")??48); const last=aeolus.read("lastAction") as any;
  const color=severity==="alarm"?"#FF7868":severity==="warning"?"#F2B65B":"#75D99A"; const action=last?.label?String(last.label):"Multi-gas network online";
  const gasWidth=(v:number)=>clamp(v/1.5*100,0,100);
  return <div style={{padding:11,minHeight:"100%",background:"linear-gradient(180deg,#0B0D0F,#080A0C)",color:"#EDF1F4"}}>
    <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}><div><div style={{fontSize:12,fontWeight:900}}>ATMOSPHERIC SAFETY</div><div style={{fontSize:7.5,color:"#747D84",marginTop:2}}>Distributed multi-gas telemetry · threshold policy · ventilation demand</div></div><div style={{textAlign:"right"}}><div style={{color,fontSize:9,fontWeight:850}}>{severity.toUpperCase()}</div><div style={{fontSize:7,color:"#6E767C"}}>vent demand {Math.round(demand)}%</div></div></div>
    <div style={{display:"grid",gridTemplateColumns:"1.15fr .85fr",gap:7}}>
      <div style={{border:"1px solid #303438",borderRadius:10,background:"#0B0D0F",padding:9}}>
        {[{name:"LEVEL 3",v:l3},{name:"DRIFT 7",v:d7}].map((g:any)=><div key={g.name} style={{marginBottom:10}}><div style={{display:"flex",justifyContent:"space-between",fontSize:7,color:"#929AA0"}}><span>{g.name}</span><span style={{fontFamily:"monospace",color:g.v>=1?"#FF7868":g.v>=.5?"#F2B65B":"#B8C3C8"}}>CH₄ {g.v.toFixed(2)}%</span></div><div style={{height:9,marginTop:4,background:"#191C1E",borderRadius:6,overflow:"hidden",position:"relative"}}><div style={{height:"100%",width:gasWidth(g.v)+"%",background:g.v>=1?"linear-gradient(90deg,#8C322C,#E76855)":g.v>=.5?"linear-gradient(90deg,#6F5125,#D6A149)":"linear-gradient(90deg,#28513A,#57B879)"}}/><div style={{position:"absolute",left:"66.6%",top:0,bottom:0,width:1,background:"#925047"}}/></div></div>)}
        <div style={{fontSize:6.5,color:"#5F666B"}}>Alarm line shown at 1.00% CH₄. The sensor values are simulator-owned physical MQTT state.</div>
      </div>
      <div style={{border:"1px solid "+(alarm?"#663B34":"#303438"),borderRadius:10,background:alarm?"#160F0D":"#0B0D0F",padding:9}}>
        <div style={{fontSize:6.5,color:"#7F878C",letterSpacing:".12em"}}>DRIFT 7 PANEL</div><div style={{fontSize:24,fontFamily:"monospace",fontWeight:850,color,marginTop:3}}>{d7.toFixed(2)}%</div><div style={{fontSize:7,color:"#6E7479"}}>methane</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5,marginTop:9}}>{[["CO",Math.round(co)+" ppm"],["O₂",o2.toFixed(1)+"%"],["NO₂",no2.toFixed(1)+" ppm"],["DEMAND",Math.round(demand)+"%"]].map((x:any)=><div key={x[0]} style={{padding:5,border:"1px solid #282D30",borderRadius:6}}><div style={{fontSize:5.8,color:"#686F73"}}>{x[0]}</div><div style={{fontSize:8,color:"#BEC7CB",fontFamily:"monospace",marginTop:1}}>{x[1]}</div></div>)}</div>
      </div>
    </div>
    <div style={{marginTop:7,border:"1px solid #343A3D",borderRadius:9,padding:8,background:"#0D1012"}}><div style={{fontSize:6.5,color:"#8B9499",letterSpacing:".12em",marginBottom:6}}>OPERATOR CONTROLS</div><button disabled={!alarm||ack} onClick={()=>aeolus.fire("acknowledge-alarm")} style={{width:"100%",padding:"7px",borderRadius:6,border:"1px solid "+(alarm&&!ack?"#70463B":"#34393C"),background:alarm&&!ack?"#241410":"#131618",color:alarm&&!ack?"#F2977E":"#687176",fontSize:7.5,cursor:"pointer"}}>{alarm?(ack?"Alarm acknowledged":"Acknowledge atmospheric alarm"):"No active alarm"}</button></div>
    <div style={{marginTop:7,border:"1px dashed #6D5232",borderRadius:9,padding:8,background:"#171209"}}><div style={{fontSize:6.5,color:"#D5B26B",letterSpacing:".12em"}}>DEMO SCENARIO</div><div style={{fontSize:7,color:"#857153",margin:"3px 0 6px"}}>Inject a transient methane pocket into Drift 7. Aeolus should demand ventilation without the demo button commanding a fan.</div><div style={{display:"flex",gap:5}}><button disabled={alarm} onClick={()=>aeolus.fire("simulate-gas-rise")} style={{flex:1,padding:"6px",borderRadius:6,border:"1px solid #6A4A2D",background:"#24170B",color:"#E7B668",fontSize:7.5,cursor:"pointer"}}>Inject methane pocket</button><button onClick={()=>aeolus.fire("reset-atmosphere")} style={{padding:"6px 9px",borderRadius:6,border:"1px solid #454038",background:"#171713",color:"#919087",fontSize:7.5,cursor:"pointer"}}>Reset</button></div></div>
    <div style={{fontSize:7,color:"#60686D",marginTop:6,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{action}</div>
  </div>;
}`;

export const atmosphereAutomation = {
  key: "mine-atmosphere", name: "Atmospheric Safety", triggerTopic: "sensor/mine/gas/#", scriptSource: logic, uiSource: ui,
  demoAccess: { fireEvents: ["acknowledge-alarm", "simulate-gas-rise", "reset-atmosphere"] },
};
