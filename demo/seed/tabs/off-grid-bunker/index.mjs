import {bunkerOverviewAutomation} from "./overview.mjs";import {bunkerPerimeterAutomation} from "./perimeter.mjs";import {bunkerAirAutomation} from "./air.mjs";import {bunkerPowerAutomation} from "./power.mjs";import {bunkerCommsAutomation} from "./comms.mjs";
const tab={id:"tab-bunker",name:"Off-Grid Bunker",icon:"shield"};const automations=[bunkerOverviewAutomation,bunkerPerimeterAutomation,bunkerAirAutomation,bunkerPowerAutomation,bunkerCommsAutomation];
// Pane geometry lives in demo/seed/layouts/showcase-layout.json (§7.2).
export default{tab,devices:[],automations,dataStore:[]};
