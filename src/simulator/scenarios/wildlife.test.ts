import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createWildlifeScenario, WILDLIFE_COMMAND_TOPICS, WILDLIFE_DEVICE_KEYS, WILDLIFE_STIMULUS } from "./wildlife.js";
import type { SimulatedState, SimulatedStateController } from "../types.js";

function controller(initial: SimulatedState): SimulatedStateController {
  let state={...initial}; return { read:()=>({...state}), update:(patch)=>{state={...state,...patch};}, publish:()=>{} };
}
function bindScenario(){
 const scenario=createWildlifeScenario(); const controllers=new Map<string,SimulatedStateController>(); const models=new Map<string,any>();
 for(const d of scenario.devices){const c=controller(d.initialState);controllers.set(d.key,c);models.set(d.key,d.createModel({key:d.key,name:d.name,state:c,logger:{ } as any}));}
 return {scenario,controllers,models};
}
function stimulus(name:string){return {stimulus:{name,payload:{},meta:{} as any,receivedAt:Date.now()},devices:{} as any,faults:{} as any,logger:{} as any};}

describe("wildlife simulator",()=>{
 beforeEach(()=>vi.useFakeTimers()); afterEach(()=>vi.useRealTimers());
 it("declares one ACK-capable deterrent actuator",()=>{const {scenario}=bindScenario();const actuator=scenario.devices.find(d=>d.key===WILDLIFE_DEVICE_KEYS.deterrent)!;expect(actuator.commandTopic).toBe(WILDLIFE_COMMAND_TOPICS.deterrent);expect(actuator.commandProfile?.acknowledgement.supported).toBe(true);});
 it("injects a predator as physical classifier telemetry",()=>{const {scenario,controllers}=bindScenario();scenario.stimuli[WILDLIFE_STIMULUS.fox](stimulus(WILDLIFE_STIMULUS.fox));vi.advanceTimersByTime(200);expect(controllers.get(WILDLIFE_DEVICE_KEYS.detection)?.read().category).toBe("predator");expect(controllers.get(WILDLIFE_DEVICE_KEYS.detection)?.read().species).toBe("red-fox");});
 it("runs a bounded deterrent pulse",async()=>{const {models,controllers}=bindScenario();const model=models.get(WILDLIFE_DEVICE_KEYS.deterrent);const result=await model.onCommand({topic:WILDLIFE_COMMAND_TOPICS.deterrent,params:{active:true,target:"Red Fox",pulseMs:4200},rawPayload:{},receivedAt:Date.now()});expect(result.accepted).toBe(true);expect(controllers.get(WILDLIFE_DEVICE_KEYS.deterrent)?.read().active).toBe(true);vi.advanceTimersByTime(4300);expect(controllers.get(WILDLIFE_DEVICE_KEYS.deterrent)?.read().active).toBe(false);});
 it("models an adult nest visit and departure",()=>{const {scenario,controllers}=bindScenario();scenario.stimuli[WILDLIFE_STIMULUS.nestVisit](stimulus(WILDLIFE_STIMULUS.nestVisit));expect(controllers.get(WILDLIFE_DEVICE_KEYS.nest)?.read().adultPresent).toBe(true);vi.advanceTimersByTime(2500);expect(controllers.get(WILDLIFE_DEVICE_KEYS.nest)?.read().adultPresent).toBe(false);});
});
