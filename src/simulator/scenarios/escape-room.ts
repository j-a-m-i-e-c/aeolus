import type { AnyDeviceDefinition, DeviceModelFactoryContext, SimulatedInboundCommand, SimulatedCommandOutcome, SimulatedState, SimulatedStateController, SimulatorScenario } from "../types.js";

export const ESCAPE_ROOM_SCENARIO_KEY = "escape-room";
export const ESCAPE_ROOM_DEVICE_KEYS = { puzzles:"escape-puzzles", exit:"escape-exit", hint:"escape-hint", fx:"escape-fx", intercom:"escape-intercom" } as const;
export const ESCAPE_ROOM_STATE_TOPICS = { puzzles:"sensor/escape/puzzles", exit:"switch/escape/exit/state", hint:"switch/escape/hint-screen/state", fx:"switch/escape/fx/state", intercom:"switch/escape/intercom/state" } as const;
export const ESCAPE_ROOM_COMMAND_TOPICS = { exit:"switch/escape/exit/set", hint:"switch/escape/hint-screen/set", fx:"switch/escape/fx/set", intercom:"switch/escape/intercom/set" } as const;
export const ESCAPE_ROOM_STIMULUS = { solveNext:"escape/sim/solve-next", reset:"escape/sim/reset" } as const;

const INITIAL = {
  puzzles: { p1:false,p2:false,p3:false,p4:false,attempts:[0,0,0,0],solveSeconds:[0,0,0,0],lastSolved:0,currentRoom:"Library",teamProgress:"searching" },
  exit: { locked:true },
  hint: { on:true,hintsSent:0,hintId:0,message:"No hint sent yet.",room:"Library" },
  fx: { scene:"puzzle",smoke:false,audio:"clockwork",lightPct:62,transitionMs:900 },
  intercom: { tx:false,room:"Library",channel:"GM",transmissionsToday:0 },
};
const SOLVE_SECONDS=[402,497,336,471];
const ATTEMPTS=[2,3,1,4];
const ROOMS=["Library","Laser Hall","Observatory","Vault","Exit"];

class Env {
  private c=new Map<string,SimulatedStateController>();
  register(k:string,s:SimulatedStateController){this.c.set(k,s)}
  get(k:string){return this.c.get(k)}
  reset(){
    this.get(ESCAPE_ROOM_DEVICE_KEYS.puzzles)?.update({...INITIAL.puzzles,attempts:[...INITIAL.puzzles.attempts],solveSeconds:[...INITIAL.puzzles.solveSeconds]},{forcePublish:true});
    this.get(ESCAPE_ROOM_DEVICE_KEYS.exit)?.update({...INITIAL.exit},{forcePublish:true});
    this.get(ESCAPE_ROOM_DEVICE_KEYS.hint)?.update({...INITIAL.hint},{forcePublish:true});
    this.get(ESCAPE_ROOM_DEVICE_KEYS.fx)?.update({...INITIAL.fx},{forcePublish:true});
    this.get(ESCAPE_ROOM_DEVICE_KEYS.intercom)?.update({...INITIAL.intercom},{forcePublish:true});
  }
  solveNext(){
    const p=this.get(ESCAPE_ROOM_DEVICE_KEYS.puzzles); if(!p)return; const s=p.read();
    const solved=[Boolean(s.p1),Boolean(s.p2),Boolean(s.p3),Boolean(s.p4)]; const idx=solved.findIndex(v=>!v); if(idx<0)return;
    const attempts=Array.isArray(s.attempts)?[...(s.attempts as number[])]:[0,0,0,0];
    const solveSeconds=Array.isArray(s.solveSeconds)?[...(s.solveSeconds as number[])]:[0,0,0,0];
    attempts[idx]=ATTEMPTS[idx]; solveSeconds[idx]=SOLVE_SECONDS[idx];
    const patch:Record<string,unknown>={attempts,solveSeconds,lastSolved:idx+1,currentRoom:ROOMS[idx+1],teamProgress:idx===3?"complete":"moving"};
    patch[`p${idx+1}`]=true; p.update(patch,{forcePublish:true});
  }
}
function sensor(k:string,n:string,t:string,i:SimulatedState,e:Env):AnyDeviceDefinition{return{key:k,name:n,stateTopic:t,initialState:i,createModel:(c)=>{e.register(c.key,c.state);return{getState:()=>c.state.read()}}}}
function actuator(k:string,n:string,st:string,ct:string,i:SimulatedState,e:Env,h:(ctx:DeviceModelFactoryContext,c:SimulatedInboundCommand)=>SimulatedCommandOutcome):AnyDeviceDefinition{return{key:k,name:n,stateTopic:st,commandTopic:ct,initialState:i,commandProfile:{acknowledgement:{supported:true},qos:1},createModel:(c)=>{e.register(c.key,c.state);return{getState:()=>c.state.read(),onCommand:(x)=>h(c,x)}}}}

export function createEscapeRoomScenario():SimulatorScenario{
  const e=new Env();
  const exit=actuator(ESCAPE_ROOM_DEVICE_KEYS.exit,"Exit Maglock",ESCAPE_ROOM_STATE_TOPICS.exit,ESCAPE_ROOM_COMMAND_TOPICS.exit,{...INITIAL.exit},e,(_ctx,c)=>{if(typeof c.params.locked!=="boolean")return{accepted:false,error:"maglock requires boolean locked"};return{accepted:true,state:{patch:{locked:c.params.locked}}}});
  const hint=actuator(ESCAPE_ROOM_DEVICE_KEYS.hint,"Hint Screen",ESCAPE_ROOM_STATE_TOPICS.hint,ESCAPE_ROOM_COMMAND_TOPICS.hint,{...INITIAL.hint},e,(ctx,c)=>{const message=String(c.params.message||"");const room=String(c.params.room||"Library");const hintId=Number(c.params.hintId||0);if(!message)return{accepted:false,error:"hint screen requires message"};return{accepted:true,state:{patch:{on:true,message,room,hintId,hintsSent:Number(ctx.state.read().hintsSent??0)+1}}}});
  const fx=actuator(ESCAPE_ROOM_DEVICE_KEYS.fx,"Room Systems Controller",ESCAPE_ROOM_STATE_TOPICS.fx,ESCAPE_ROOM_COMMAND_TOPICS.fx,{...INITIAL.fx},e,(_ctx,c)=>{const scene=String(c.params.scene||"puzzle"),smoke=Boolean(c.params.smoke);if(!["calm","puzzle","tension","victory"].includes(scene))return{accepted:false,error:"unknown room scene"};const sceneData:Record<string,{audio:string;lightPct:number;transitionMs:number}>={calm:{audio:"ambient",lightPct:78,transitionMs:1200},puzzle:{audio:"clockwork",lightPct:62,transitionMs:900},tension:{audio:"heartbeat",lightPct:38,transitionMs:450},victory:{audio:"fanfare",lightPct:100,transitionMs:650}};return{accepted:true,state:{patch:{scene,smoke,...sceneData[scene]}}}});
  const intercom=actuator(ESCAPE_ROOM_DEVICE_KEYS.intercom,"Game Master Intercom",ESCAPE_ROOM_STATE_TOPICS.intercom,ESCAPE_ROOM_COMMAND_TOPICS.intercom,{...INITIAL.intercom},e,(ctx,c)=>{if(typeof c.params.tx!=="boolean")return{accepted:false,error:"intercom requires boolean tx"};const tx=c.params.tx,room=String(c.params.room||ctx.state.read().room||"Library");return{accepted:true,state:{patch:{tx,room,channel:"GM",transmissionsToday:Number(ctx.state.read().transmissionsToday??0)+(tx?1:0)}}}});
  return{key:ESCAPE_ROOM_SCENARIO_KEY,devices:[sensor(ESCAPE_ROOM_DEVICE_KEYS.puzzles,"Puzzle Sensor Network",ESCAPE_ROOM_STATE_TOPICS.puzzles,{...INITIAL.puzzles,attempts:[...INITIAL.puzzles.attempts],solveSeconds:[...INITIAL.puzzles.solveSeconds]},e),exit,hint,fx,intercom],stimuli:{[ESCAPE_ROOM_STIMULUS.solveNext]:()=>e.solveNext(),[ESCAPE_ROOM_STIMULUS.reset]:()=>e.reset()}};
}
