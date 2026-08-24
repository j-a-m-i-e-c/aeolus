// mine-overview — Automation Project logic
// The compiler wraps this module in Aeolus' execution/completion machinery.

export default async function run(context: EventContext) {
      function init(k,v){if(state.get(k)===undefined)state.set(k,v);}
      init("d7Ch4",0.42);init("severity","safe");init("ventMode","auto");init("airflow",258);init("refuge",0);init("underground",14);init("unaccounted",0);init("musterState","normal");init("sumpLevel",1.8);init("sumpPumpOn",false);init("lastMineEvent",{label:"Mine operating normally",at:Date.now()});
      var topic=String(context.topic||"");var s=context.state&&typeof context.state==="object"?context.state:{};function copy(src,dst){if(s[src]!==undefined)state.set(dst||src,s[src]);}
      if(topic.indexOf("/mine/summary/atmosphere")>=0){["d7Ch4","severity","alarm","ventDemand"].forEach(function(k){copy(k);});state.set("lastMineEvent",{label:String(s.severity||"safe")==="alarm"?"Atmospheric alarm at Drift 7":"Atmosphere updated",at:Date.now()});}
      else if(topic.indexOf("/mine/summary/ventilation")>=0){copy("mode","ventMode");copy("airflow");copy("primaryRpm");copy("boosterRpm");state.set("lastMineEvent",{label:"Ventilation · "+String(s.mode||"auto"),at:Date.now()});}
      else if(topic.indexOf("/mine/summary/personnel")>=0){["refuge","underground","unaccounted","musterState","alarmActive"].forEach(function(k){copy(k);});state.set("lastMineEvent",{label:Number(s.unaccounted||0)>0?"Personnel tag exception":String(s.musterState||"")==="complete"?"Muster complete":"Personnel tracking updated",at:Date.now()});}
      else if(topic.indexOf("/mine/summary/dewatering")>=0){copy("levelM","sumpLevel");copy("pumpOn","sumpPumpOn");copy("dischargeLps");state.set("lastMineEvent",{label:Boolean(s.pumpOn)?"Deep sump pumping":"Dewatering updated",at:Date.now()});}
}
