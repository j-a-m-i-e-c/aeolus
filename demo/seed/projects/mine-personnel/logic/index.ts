// mine-personnel — Automation Project logic
// The compiler wraps this module in Aeolus' execution/completion machinery.

export default async function run(context: EventContext) {
      var topic=String(context.topic||""); var evt=topic.split("/").pop();
      function byTopic(wanted){return devices.list().find(function(d){return d.topic===wanted;});}
      function setAction(label){state.set("lastAction",{label:label,at:Date.now()});}
      function project(){
        var people=byTopic("sensor/mine/personnel"); var muster=byTopic("switch/mine/muster/state"); var ps=people&&people.state?people.state:{}; var ms=muster&&muster.state?muster.state:{};
        state.set("underground",Number(ps.underground||0)); state.set("l1",Number(ps.l1||0)); state.set("l2",Number(ps.l2||0)); state.set("l3",Number(ps.l3||0)); state.set("refuge",Number(ps.refuge||0)); state.set("unaccounted",Number(ps.unaccounted||0));
        state.set("musterState",String(ps.musterState||ms.state||"normal")); state.set("alarmActive",Boolean(ms.alarm)); state.set("musterActive",Boolean(ms.active));
        events.emit("mine/summary/personnel",{underground:Number(ps.underground||0),l1:Number(ps.l1||0),l2:Number(ps.l2||0),l3:Number(ps.l3||0),refuge:Number(ps.refuge||0),unaccounted:Number(ps.unaccounted||0),musterState:String(ps.musterState||ms.state||"normal"),alarmActive:Boolean(ms.alarm)});
      }
      async function commandMuster(active){
        var controller=byTopic("switch/mine/muster/state"); if(!controller){setAction("Muster controller unavailable");return;}
        state.set("commandPending",true); setAction(active?"Initiating underground personnel muster":"Clearing muster and returning to normal operations");
        var result=await devices.action(controller.id,"command",{payload:{active:active}},{tier:"observed",deviceId:controller.id,condition:{field:"active",op:"eq",value:active},timeoutMs:5000});
        state.set("commandPending",false); if(!result.success)setAction("Muster command not verified: "+String(result.error||result.lifecycleState||"unknown")); else setAction(active?"Muster alarm verified · tracking personnel to refuge":"Muster cleared"); project();
      }
      if(topic.indexOf("ui/")===0){
        if(evt==="initiate-muster")await commandMuster(true); else if(evt==="clear-muster")await commandMuster(false); else if(evt==="simulate-tag-dropout"){events.emit("mine/sim/tag-dropout",{});setAction("Injecting one temporary personnel-tag dropout");} else if(evt==="reset-personnel"){events.emit("mine/sim/personnel-reset",{});setAction("Resetting personnel distribution");}
        return;
      }
      if(topic!=="sensor/mine/personnel")return; project();
}
