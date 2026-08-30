// wildlife-predator-response — Automation Project logic
// The compiler wraps this module in Aeolus' execution/completion machinery.

export default async function run(context: EventContext) {
 var topic=String(context.topic||"");var evt=topic.split("/").pop();
 function byTopic(w){return devices.list().find(function(d){return d.topic===w;});}
 function setAction(l){state.set("lastAction",{label:l,at:Date.now()});}
 function init(){if(state.get("armed")===undefined)state.set("armed",true);if(state.get("responsesToday")===undefined)state.set("responsesToday",3);if(state.get("lastOutcome")===undefined)state.set("lastOutcome","Waiting for classified wildlife event");}
 function summary(){events.emit("wildlife/response/status",{armed:Boolean(state.get("armed")),activeUntil:Number(state.get("activeUntil")||0),lastSpecies:String(state.get("lastSpecies")||"none"),responsesToday:Number(state.get("responsesToday")||3),lastOutcome:String(state.get("lastOutcome")||"idle"),lastVerifiedAt:Number(state.get("lastVerifiedAt")||0)});}
 async function stop(){var d=byTopic("switch/wildlife/deterrent/state");if(!d)return;await devices.action(d.id,"command",{payload:{active:false,target:"none",pulseMs:0}},{tier:"observed",deviceId:d.id,condition:{field:"active",op:"eq",value:false},timeoutMs:5000});state.set("activeUntil",0);state.set("lastOutcome","Deterrent physically stopped");summary();}
 init();
 if(topic.indexOf("ui/")===0){if(evt==="toggle-armed"){var next=!Boolean(state.get("armed"));state.set("armed",next);if(!next)await stop();setAction(next?"Predator response armed":"Predator response disarmed");summary();}else if(evt==="stop-deterrent"){await stop();setAction("Deterrent stopped by operator");}return;}
 if(topic.indexOf("/wildlife/detection/classified")<0)return;
 var p=context.state&&typeof context.state==="object"?context.state:{};var category=String(p.category||"unknown"),label=String(p.label||"Unknown"),eventId=String(p.eventId||"");
 if(eventId&&eventId===String(state.get("lastHandledEventId")||""))return;if(eventId)state.set("lastHandledEventId",eventId);
 state.set("lastSpecies",label);state.set("lastConfidence",Number(p.confidence||0));state.set("lastCategory",category);
 if(category!=="predator"){state.set("lastOutcome",label+" classified native · no actuation");setAction(label+" ignored by predator policy · native fauna");summary();return;}
 if(!Boolean(state.get("armed"))){state.set("lastOutcome",label+" detected while response disarmed");setAction(label+" detected · response disarmed");summary();return;}
 var d=byTopic("switch/wildlife/deterrent/state");if(!d){state.set("lastOutcome","Predator detected · deterrent unavailable");setAction("Predator detected · deterrent unavailable");summary();return;}
 var pulse=6200;state.set("commandPending",true);state.set("lastOutcome","Issuing verified deterrent command");setAction(label+" detected · issuing humane light/sound pulse");
 var r=await devices.action(d.id,"command",{payload:{active:true,target:label,pulseMs:pulse}},{tier:"observed",deviceId:d.id,condition:{field:"active",op:"eq",value:true},timeoutMs:5000});
 state.set("commandPending",false);
 if(r.success){var at=Date.now();state.set("activeUntil",at+pulse);state.set("responsesToday",Number(state.get("responsesToday")||3)+1);state.set("lastVerifiedAt",at);state.set("lastVerifiedTarget",label);state.set("lastOutcome",label+" response VERIFIED");setAction(label+" response verified · bounded "+(pulse/1000).toFixed(1)+"s pulse");}
 else {state.set("lastOutcome","Command failed verification");setAction("Deterrent command not verified: "+String(r.error||r.lifecycleState||"unknown"));}
 summary();
}
