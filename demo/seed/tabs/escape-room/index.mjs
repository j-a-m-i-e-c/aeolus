import {gameMasterAutomation} from "./game-master.mjs";
import {puzzleProgressAutomation} from "./puzzles.mjs";
import {roomFxAutomation} from "./room-fx.mjs";
const tab={id:"tab-escape-room",name:"Escape Room",icon:"puzzle"};
const automations=[gameMasterAutomation,puzzleProgressAutomation,roomFxAutomation];
// Pane geometry lives in demo/seed/layouts/showcase-layout.json (§7.2).
export default{tab,devices:[],automations,dataStore:[]};
