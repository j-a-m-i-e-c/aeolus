const logic = `automation({
  actions: [
    async function underwayScience(context) {
      var topic = String(context.topic || ""); var evt = topic.split("/").pop();
      function byTopic(wanted) { return devices.list().find(function(d) { return d.topic === wanted; }); }
      function setAction(label) { state.set("lastAction", { label: label, at: Date.now() }); }
      function project() {
        var tsg = byTopic("sensor/underway/tsg"); var pump = byTopic("switch/vessel/tsg-pump/state");
        var sst = Number(tsg && tsg.state && tsg.state.sst); var sal = Number(tsg && tsg.state && tsg.state.salinity); var flow = Number(tsg && tsg.state && tsg.state.flow); var chl = Number(tsg && tsg.state && tsg.state.chlorophyll); var turb = Number(tsg && tsg.state && tsg.state.turbidity);
        if (!isNaN(sst)) state.set("sst", sst); if (!isNaN(sal)) state.set("salinity", sal); if (!isNaN(flow)) state.set("flow", flow); if (!isNaN(chl)) state.set("chlorophyll", chl); if (!isNaN(turb)) state.set("turbidity", turb);
        var pumpOn = Boolean(pump && pump.state && pump.state.on); state.set("pumpOn", pumpOn);
        var profile = state.get("profile"); if (!Array.isArray(profile)) profile = [];
        if (!isNaN(sst) && !isNaN(sal) && !isNaN(flow) && flow > .2) { profile = profile.concat([{ sst: sst, salinity: sal, chlorophyll: isNaN(chl) ? 0 : chl, at: Date.now() }]).slice(-18); state.set("profile", profile); }
        var front = Boolean(state.get("frontDetected"));
        events.emit("vessel/summary/underway", { tsgPumpOn: pumpOn, tsgFlow: isNaN(flow) ? 0 : flow, sst: isNaN(sst) ? 0 : sst, surfaceSalinity: isNaN(sal) ? 0 : sal, chlorophyll: isNaN(chl) ? 0 : chl, frontDetected: front });
      }

      async function setPump(on) {
        var pump = byTopic("switch/vessel/tsg-pump/state"); var tsg = byTopic("sensor/underway/tsg"); if (!pump || !tsg) { setAction("Flow-through system unavailable"); return; }
        state.set("commandPending", true); setAction(on ? "Starting flow-through seawater intake" : "Stopping flow-through seawater intake");
        var result = await devices.action(pump.id, "command", { payload: { on: on } }, { tier: "observed", deviceId: tsg.id, condition: { field: "flow", op: on ? "gt" : "eq", value: on ? .5 : 0 }, timeoutMs: 5000 });
        state.set("commandPending", false);
        if (result.success) setAction(on ? "Underway sampling verified · flow observed" : "Sampling stopped · zero flow observed"); else setAction("Sampling command not verified: " + String(result.error || result.lifecycleState || "unknown")); project();
      }

      if (topic.indexOf("ui/") === 0) {
        if (evt === "sampling-start") await setPump(true); else if (evt === "sampling-stop") await setPump(false);
        else if (evt === "simulate-front") { state.set("frontDetected", false); events.emit("vessel/sim/ocean-front", {}); setAction("Injecting hydrographic front ahead of vessel"); }
        else if (evt === "reset-underway") { events.emit("vessel/sim/underway-reset", {}); state.set("frontDetected", false); state.set("profile", []); setAction("Resetting surface-water transect"); }
        return;
      }

      var oldSst = Number(state.get("sst")); var oldSal = Number(state.get("salinity")); project();
      var flow = Number(state.get("flow") || 0); var newSst = Number(state.get("sst")); var newSal = Number(state.get("salinity"));
      if (flow > .5 && !isNaN(oldSst) && !isNaN(oldSal) && !isNaN(newSst) && !isNaN(newSal)) {
        var gradient = Math.abs(newSst - oldSst) + Math.abs(newSal - oldSal) * 3;
        if (gradient >= .7 && !Boolean(state.get("frontDetected"))) { state.set("frontDetected", true); setAction("Hydrographic front detected in flow-through stream"); events.emit("vessel/underway/front-detected", { sst: newSst, salinity: newSal, gradient: gradient }); project(); }
      }
    },
  ],
});`;

const ui = `import { useMemo } from "react";
import type { CustomComponentProps } from "./types";
export default function UnderwayScience(aeolus: CustomComponentProps) {
  const sst=Number(aeolus.read("sst")??18.4), sal=Number(aeolus.read("salinity")??35.2), flow=Number(aeolus.read("flow")??2.1), chl=Number(aeolus.read("chlorophyll")??.8), turb=Number(aeolus.read("turbidity")??.5); const pumpOn=Boolean(aeolus.read("pumpOn")), front=Boolean(aeolus.read("frontDetected")), pending=Boolean(aeolus.read("commandPending")); const profile=(aeolus.read("profile") as any[])||[]; const last=aeolus.read("lastAction") as any; const action=last?.label?String(last.label):"Surface-water stream online";
  const pts=profile.length?profile:[{sst:18.4,salinity:35.2},{sst:18.35,salinity:35.18},{sst:18.4,salinity:35.2}]; const tempPath=useMemo(()=>pts.map((p:any,i:number)=>{const x=18+i*Math.max(1,245/(Math.max(1,pts.length-1)));const y=112-(Number(p.sst)-15)*15;return(i?"L":"M")+x.toFixed(1)+","+y.toFixed(1)}).join(" "),[profile]); const salPath=useMemo(()=>pts.map((p:any,i:number)=>{const x=18+i*Math.max(1,245/(Math.max(1,pts.length-1)));const y=112-(Number(p.salinity)-34.6)*45;return(i?"L":"M")+x.toFixed(1)+","+y.toFixed(1)}).join(" "),[profile]);
  return <div style={{padding:11,minHeight:"100%",background:"linear-gradient(180deg,#0A1517,#071012)",color:"#EDF2EF"}}>
    <div style={{display:"flex",justifyContent:"space-between",marginBottom:7}}><div><div style={{fontSize:12,fontWeight:900}}>UNDERWAY SCIENCE</div><div style={{color:"#687D7D",fontSize:7.5,marginTop:2}}>Flow-through seawater · frontal detection · opportunistic transect</div></div><div style={{textAlign:"right"}}><div style={{color:front?"#A4E699":pumpOn?"#69D5C8":"#E3A66A",fontSize:9,fontWeight:850}}>{front?"FRONT DETECTED":pumpOn?"SAMPLING":"INTAKE STOPPED"}</div><div style={{color:"#627676",fontSize:7}}>{flow.toFixed(1)} L/min</div></div></div>
    <div style={{display:"grid",gridTemplateColumns:"1.2fr .8fr",gap:7}}><div style={{border:"1px solid #24403F",borderRadius:10,background:"#081719",padding:7}}><svg width="100%" height="165" viewBox="0 0 280 165"><rect width="280" height="165" rx="7" fill="#071315"/><text x="15" y="17" fill="#6A8583" fontSize="6.5" letterSpacing="1">RECENT SURFACE TRANSECT</text>{[45,75,105,135].map(y=><line key={y} x1="15" y1={y} x2="266" y2={y} stroke="#1C3434"/>)}<path d={tempPath} fill="none" stroke="#F0AF5C" strokeWidth="2"/><path d={salPath} fill="none" stroke="#58D2D0" strokeWidth="1.7" strokeDasharray="4 3"/><text x="16" y="153" fill="#F0AF5C" fontSize="7">SST {sst.toFixed(1)}°C</text><text x="98" y="153" fill="#58D2D0" fontSize="7">SAL {sal.toFixed(2)}</text>{front&&<g><rect x="200" y="25" width="63" height="19" rx="9" fill="#17311F" stroke="#579E67"/><text x="231" y="37" textAnchor="middle" fill="#A3E29C" fontSize="6.5">FRONT</text></g>}</svg></div>
      <div style={{border:"1px solid #24403F",borderRadius:10,background:"#081719",padding:9}}><div style={{color:"#718785",fontSize:6.5,letterSpacing:".12em"}}>LIVE STREAM</div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7,marginTop:9}}>{[["SST",sst.toFixed(1)+"°C","#F0B05D"],["SAL",sal.toFixed(2),"#66D3D0"],["CHL",chl.toFixed(2),"#8DD49A"],["TURB",turb.toFixed(2),"#B8C7B5"]].map(([l,v,c])=><div key={l}><div style={{color:"#637774",fontSize:6.5}}>{l}</div><div style={{color:c,fontFamily:"monospace",fontSize:12,fontWeight:800,marginTop:2}}>{v}</div></div>)}</div><div style={{marginTop:12,paddingTop:8,borderTop:"1px solid #203534",color:pumpOn?"#79D7CB":"#8E8D82",fontSize:7}}>{pumpOn?"INTAKE PUMP RUNNING":"NO SAMPLE FLOW"}</div></div></div>
    <div style={{marginTop:7,border:"1px solid #294442",borderRadius:9,padding:8,background:"#081618"}}><div style={{color:"#809592",fontSize:6.5,letterSpacing:".12em",marginBottom:6}}>OPERATOR CONTROLS</div><div style={{display:"flex",gap:5}}><button disabled={pending||pumpOn} onClick={()=>aeolus.fire("sampling-start")} style={{flex:1,padding:"7px",borderRadius:6,border:"1px solid #315D53",background:"#10231F",color:"#80D7C9",fontSize:7.5,cursor:"pointer"}}>Start sampling</button><button disabled={pending||!pumpOn} onClick={()=>aeolus.fire("sampling-stop")} style={{flex:1,padding:"7px",borderRadius:6,border:"1px solid #5B4935",background:"#211A11",color:"#DDBA7A",fontSize:7.5,cursor:"pointer"}}>Stop sampling</button></div></div>
    <div style={{marginTop:7,border:"1px dashed #69502E",borderRadius:9,padding:8,background:"#171309"}}><div style={{color:"#D8B66D",fontSize:6.5,letterSpacing:".12em"}}>DEMO SCENARIO</div><div style={{color:"#806F50",fontSize:7,margin:"3px 0 6px"}}>Move the simulated vessel across a water-mass boundary. Aeolus detects the gradient from real stream telemetry.</div><div style={{display:"flex",gap:5}}><button disabled={!pumpOn} onClick={()=>aeolus.fire("simulate-front")} style={{flex:1,padding:"6px",borderRadius:6,border:"1px solid #6A5130",background:"#21180B",color:"#E3B866",fontSize:7.5,cursor:"pointer"}}>Cross hydrographic front</button><button onClick={()=>aeolus.fire("reset-underway")} style={{padding:"6px 9px",borderRadius:6,border:"1px solid #454138",background:"#171713",color:"#898B82",fontSize:7.5,cursor:"pointer"}}>Reset transect</button></div></div>
    <div style={{color:"#5C706E",fontSize:7,marginTop:6,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{action}</div>
  </div>;
}`;

export const underwayAutomation = {
  key: "vessel-underway", name: "Underway Science", triggerTopic: "sensor/underway/#", scriptSource: logic, uiSource: ui,
  demoAccess: { fireEvents: ["sampling-start", "sampling-stop", "simulate-front", "reset-underway"] },
};
