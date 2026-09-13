import {showSequencerAutomation} from "./sequencer.mjs";
import {dataStore} from "./data-store.mjs";
const tab={id:"tab-stage-show",name:"Stage & Show",icon:"sparkles"};
const automations=[showSequencerAutomation];
// Pane geometry lives in demo/seed/layouts/showcase-layout.json (§7.2).
export default{tab,devices:[],automations,dataStore};
