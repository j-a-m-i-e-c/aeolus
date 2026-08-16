import { wildlifeDetectionAutomation } from "./detection.mjs";
import { predatorResponseAutomation } from "./predator-response.mjs";
import { nestMonitoringAutomation } from "./nest-monitoring.mjs";
import { dataStore } from "./data-store.mjs";
const tab={id:"tab-wildlife",name:"Wildlife",icon:"paw-print"};
const automations=[wildlifeDetectionAutomation,predatorResponseAutomation,nestMonitoringAutomation];
const panes=[
  {kind:"automation",ref:"wildlife-detection",x:0,y:0,w:12,h:13},
  {kind:"automation",ref:"wildlife-predator-response",x:0,y:13,w:6,h:11},
  {kind:"automation",ref:"wildlife-nest-monitoring",x:6,y:13,w:6,h:11},
];
export default {tab,devices:[],automations,panes,dataStore};
