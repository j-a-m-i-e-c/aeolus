import { wildlifeDetectionAutomation } from "./detection.mjs";
import { predatorResponseAutomation } from "./predator-response.mjs";
import { nestMonitoringAutomation } from "./nest-monitoring.mjs";
import { dataStore } from "./data-store.mjs";
const tab={id:"tab-wildlife",name:"Wildlife",icon:"paw-print"};
const automations=[wildlifeDetectionAutomation,predatorResponseAutomation,nestMonitoringAutomation];
// Pane geometry lives in demo/seed/layouts/showcase-layout.json (§7.2).
export default {tab,devices:[],automations,dataStore};
