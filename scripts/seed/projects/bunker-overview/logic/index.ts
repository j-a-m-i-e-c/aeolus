// bunker-overview — Automation Project logic
// The compiler wraps this module in Aeolus' execution/completion machinery.

export default async function run(context: EventContext) {
var topic=String(context.topic||"");var s=context.state&&typeof context.state==="object"?context.state:{};function copy(k){if(s[k]!==undefined)state.set(k,s[k]);}if(topic.indexOf("/bunker/summary/perimeter")>=0)["contacts","sector","classification","lightsOn"].forEach(copy);else if(topic.indexOf("/bunker/summary/air")>=0)["sealed","overpressure","filterLife"].forEach(copy);else if(topic.indexOf("/bunker/summary/power")>=0)["battery","solar","load","net","generatorOn","foodDays","waterDays"].forEach(copy);else if(topic.indexOf("/bunker/summary/comms")>=0)["frequency","signal","contactsToday"].forEach(copy);
}
