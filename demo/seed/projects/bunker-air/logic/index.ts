// bunker-air — Automation Project logic
// The compiler wraps this module in Aeolus' execution/completion machinery.

export default async function run(context: EventContext) {
var topic=String(context.topic||"");var evt=topic.split("/").pop();function d(){return devices.list().find(function(x){return x.topic==="switch/bunker/filter/state";});}function action(l){state.set("lastAction",{label:l,at:Date.now()});}function project(){var x=d(),s=x&&x.state?x.state:{};state.set("sealed",Boolean(s.sealed));state.set("overpressure",Number(s.overpressure??8));state.set("filterLife",Number(s.filterLife??78));state.set("on",s.on!==false);events.emit("bunker/summary/air",{sealed:Boolean(s.sealed),overpressure:Number(s.overpressure??8),filterLife:Number(s.filterLife??78)});}async function set(sealed){var x=d();if(!x)return;state.set("pending",true);var r=await devices.action(x.id,"command",{payload:{sealed:sealed}},{tier:"observed",deviceId:x.id,condition:{field:"sealed",op:"eq",value:sealed},timeoutMs:5000});state.set("pending",false);if(r.success){action(sealed?"Bunker sealed · positive pressure established":"Airlock returned to normal ventilation");project();}else action("Filtration command not verified");}
if(topic.indexOf("ui/")===0){if(evt==="seal")await set(true);else if(evt==="unseal")await set(false);return;}if(topic!=="switch/bunker/filter/state")return;project();
}
