import { afterEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "pino";
import { SimulatorDeviceRegistry } from "../device-registry.js";
import { FaultController } from "../fault-controller.js";
import type { ScenarioStimulusContext, SimulatedInboundCommand } from "../types.js";
import {
  UNDERGROUND_MINING_COMMAND_TOPICS,
  UNDERGROUND_MINING_DEVICE_KEYS,
  UNDERGROUND_MINING_STATE_TOPICS,
  UNDERGROUND_MINING_STIMULUS,
  createUndergroundMiningScenario,
} from "./underground-mining.js";

function logger(): Logger { const noop=():void=>undefined; return {info:noop,warn:noop,error:noop,debug:noop} as unknown as Logger; }
function setup(){
  const published:Array<{topic:string;payload:string}>=[];
  const registry=new SimulatorDeviceRegistry({publish:(topic,payload)=>published.push({topic,payload}),logger:logger(),maxDelayMs:0});
  const faults=new FaultController({maxDelayMs:0,logger:logger()}); const scenario=createUndergroundMiningScenario(); for(const d of scenario.devices)registry.register(d);
  const fire=async(name:string)=>{const ctx:ScenarioStimulusContext={stimulus:{name,payload:{},meta:{eventId:"e1",timestamp:1,source:{kind:"automation"}},receivedAt:1},devices:registry,faults,logger:logger()};await scenario.stimuli[name](ctx);};
  const last=(topic:string)=>{const xs=published.filter(e=>e.topic===topic);return xs.length?JSON.parse(xs.at(-1)!.payload) as Record<string,unknown>:undefined;};
  const command=(topic:string,params:Record<string,unknown>):SimulatedInboundCommand=>({topic,params,rawPayload:params,receivedAt:1});
  return {registry,scenario,fire,last,command};
}

afterEach(()=>{vi.useRealTimers();});

describe("underground-mining simulator scenario",()=>{
  it("registers three acknowledgement-capable mine actuators",()=>{const {registry,scenario}=setup();expect(registry.getByCommandTopic(UNDERGROUND_MINING_COMMAND_TOPICS.ventilation)?.definition.key).toBe(UNDERGROUND_MINING_DEVICE_KEYS.ventilation);expect(registry.getByCommandTopic(UNDERGROUND_MINING_COMMAND_TOPICS.muster)?.definition.key).toBe(UNDERGROUND_MINING_DEVICE_KEYS.muster);expect(registry.getByCommandTopic(UNDERGROUND_MINING_COMMAND_TOPICS.sumpPump)?.definition.key).toBe(UNDERGROUND_MINING_DEVICE_KEYS.sumpPump);expect(scenario.devices.filter(d=>d.commandProfile?.acknowledgement.supported)).toHaveLength(3);});

  it("models methane as external physical state and boosted ventilation purges it",async()=>{vi.useFakeTimers();const {registry,fire,last,command}=setup();await fire(UNDERGROUND_MINING_STIMULUS.gasRise);expect(last(UNDERGROUND_MINING_STATE_TOPICS.gasD7)).toMatchObject({ch4:1.12,co:34});const fan=registry.get(UNDERGROUND_MINING_DEVICE_KEYS.ventilation)!;await fan.model.onCommand!(command(UNDERGROUND_MINING_COMMAND_TOPICS.ventilation,{mode:"boost"}));expect(last(UNDERGROUND_MINING_STATE_TOPICS.ventilation)).toMatchObject({mode:"boost",airflow:330});await vi.advanceTimersByTimeAsync(2500);expect(last(UNDERGROUND_MINING_STATE_TOPICS.gasD7)).toMatchObject({ch4:.36,co:13});});

  it("runs a physical personnel muster to full refuge accountability",async()=>{vi.useFakeTimers();const {registry,last,command}=setup();const muster=registry.get(UNDERGROUND_MINING_DEVICE_KEYS.muster)!;await muster.model.onCommand!(command(UNDERGROUND_MINING_COMMAND_TOPICS.muster,{active:true}));expect(last(UNDERGROUND_MINING_STATE_TOPICS.muster)).toMatchObject({active:true});await vi.advanceTimersByTimeAsync(3200);expect(last(UNDERGROUND_MINING_STATE_TOPICS.personnel)).toMatchObject({refuge:14,l1:0,l2:0,l3:0,musterState:"complete"});});

  it("models a temporary personnel tag dropout without changing headcount",async()=>{vi.useFakeTimers();const {fire,last}=setup();await fire(UNDERGROUND_MINING_STIMULUS.tagDropout);expect(last(UNDERGROUND_MINING_STATE_TOPICS.personnel)).toMatchObject({underground:14,unaccounted:1});await vi.advanceTimersByTimeAsync(2700);expect(last(UNDERGROUND_MINING_STATE_TOPICS.personnel)).toMatchObject({underground:14,unaccounted:0});});

  it("models heavy inflow and a real pump-driven sump recovery",async()=>{vi.useFakeTimers();const {registry,fire,last,command}=setup();await fire(UNDERGROUND_MINING_STIMULUS.heavyInflow);await vi.advanceTimersByTimeAsync(700);expect(last(UNDERGROUND_MINING_STATE_TOPICS.sump)).toMatchObject({levelM:4.4,status:"high"});const pump=registry.get(UNDERGROUND_MINING_DEVICE_KEYS.sumpPump)!;await pump.model.onCommand!(command(UNDERGROUND_MINING_COMMAND_TOPICS.sumpPump,{on:true}));expect(last(UNDERGROUND_MINING_STATE_TOPICS.sumpPump)).toMatchObject({on:true,flowLps:55});await vi.advanceTimersByTimeAsync(2300);expect(last(UNDERGROUND_MINING_STATE_TOPICS.sump)).toMatchObject({levelM:1.3,status:"low"});});
});
