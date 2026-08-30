import {showSequencerAutomation} from "./sequencer.mjs";
import {dataStore} from "./data-store.mjs";
const tab={id:"tab-stage-show",name:"Stage & Show",icon:"sparkles"};
const automations=[showSequencerAutomation];
const panes=[{kind:"automation",ref:"stage-show-sequencer",x:0,y:0,w:12,h:19}];
export default{tab,devices:[],automations,panes,dataStore};
