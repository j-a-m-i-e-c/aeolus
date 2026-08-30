import {gameMasterAutomation} from "./game-master.mjs";
import {puzzleProgressAutomation} from "./puzzles.mjs";
import {roomFxAutomation} from "./room-fx.mjs";
const tab={id:"tab-escape-room",name:"Escape Room",icon:"puzzle"};
const automations=[gameMasterAutomation,puzzleProgressAutomation,roomFxAutomation];
const panes=[
  {kind:"automation",ref:"escape-game-master",x:0,y:0,w:12,h:15},
  {kind:"automation",ref:"escape-puzzles",x:0,y:15,w:7,h:12},
  {kind:"automation",ref:"escape-room-fx",x:7,y:15,w:5,h:12},
];
export default{tab,devices:[],automations,panes,dataStore:[]};
