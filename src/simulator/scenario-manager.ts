// src/simulator/scenario-manager.ts
// phase-2-mqtt-simulator Task 4 — Automation Event -> Scenario Stimulus boundary.
//
// Scenario stimuli are the ONLY control plane into the simulated world: there is
// no public REST/raw-MQTT injection endpoint (Req 4.8). The manager subscribes
// to the Phase 1 reserved Automation Event namespace, validates the real
// versioned envelope (reusing the Phase 1 parser/validator — never weakened),
// and dispatches only events a loaded scenario explicitly declares (Req 4.2-4.4).
// A stimulus changes only simulator-owned model/environment state; resulting
// observations leave through ordinary device state topics (Req 4.6, 4.7).

import type { IPublishPacket } from "mqtt";
import type { Logger } from "pino";
import {
  RESERVED_EVENT_NAMESPACE,
  MAX_ENVELOPE_BYTES,
  isValidEventName,
  parseAutomationEventEnvelope,
} from "../automations/automation-event-service.js";
import type { SimulatorDeviceRegistry } from "./device-registry.js";
import type { FaultArmer, ScenarioStimulus, ScenarioStimulusContext, SimulatorScenario } from "./types.js";

interface StimulusRegistration {
  scenarioKey: string;
  handler: (ctx: ScenarioStimulusContext) => void | Promise<void>;
}

export interface ScenarioManagerDeps {
  registry: SimulatorDeviceRegistry;
  /** Fault-arming surface exposed to trusted stimulus handlers (Req 5.6). */
  faults: FaultArmer;
  logger: Logger;
  /** Maximum accepted Automation Event payload size. Defaults to the Phase 1 bound. */
  maxPayloadBytes?: number;
  /** Injectable clock (tests). Default Date.now. */
  now?: () => number;
}

export class ScenarioManager {
  private readonly deps: ScenarioManagerDeps;
  private readonly now: () => number;
  private readonly maxPayloadBytes: number;
  private readonly scenarios: SimulatorScenario[] = [];
  private readonly handlers = new Map<string, StimulusRegistration[]>();

  constructor(deps: ScenarioManagerDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
    this.maxPayloadBytes = deps.maxPayloadBytes ?? MAX_ENVELOPE_BYTES;
  }

  /**
   * Load a scenario: register its devices and its declared stimulus handlers.
   * Throws on an invalid device definition or an unsafe stimulus event name so
   * startup fails clearly (Req 6.4).
   */
  load(scenario: SimulatorScenario): void {
    for (const definition of scenario.devices) {
      this.deps.registry.register(definition);
    }

    for (const [eventName, handler] of Object.entries(scenario.stimuli)) {
      // Reuse the Phase 1 event-name rules verbatim — never weakened (Req 4.3).
      if (!isValidEventName(eventName)) {
        throw new Error(`Scenario "${scenario.key}": invalid stimulus event name "${eventName}"`);
      }
      const list = this.handlers.get(eventName) ?? [];
      list.push({ scenarioKey: scenario.key, handler });
      this.handlers.set(eventName, list);
    }

    this.scenarios.push(scenario);
  }

  /** True when at least one scenario declares a stimulus (drives subscription). */
  hasDeclaredStimuli(): boolean {
    return this.handlers.size > 0;
  }

  /** The MQTT filter to subscribe to for Automation Event stimuli. */
  eventTopicFilter(): string {
    return `${RESERVED_EVENT_NAMESPACE}/#`;
  }

  /** True when a topic falls within the reserved Automation Event namespace. */
  static isEventTopic(topic: string): boolean {
    return topic === RESERVED_EVENT_NAMESPACE || topic.startsWith(`${RESERVED_EVENT_NAMESPACE}/`);
  }

  /**
   * Handle an inbound message on the Automation Event namespace. Malformed,
   * oversized, or undeclared events change no simulator state (Req 4.2, 4.4).
   */
  async handleAutomationEvent(topic: string, payload: Buffer, _packet?: IPublishPacket): Promise<void> {
    if (payload.length > this.maxPayloadBytes) {
      this.deps.logger.warn({ topic, bytes: payload.length }, "Automation Event exceeds size bound; ignored");
      return;
    }

    const envelope = parseAutomationEventEnvelope(payload.toString("utf8"));
    if (!envelope) {
      this.deps.logger.debug({ topic }, "Malformed Automation Event envelope ignored");
      return;
    }

    const registrations = this.handlers.get(envelope.name);
    if (!registrations || registrations.length === 0) {
      this.deps.logger.debug({ topic, event: envelope.name }, "Undeclared Automation Event ignored");
      return;
    }

    const stimulus: ScenarioStimulus = {
      name: envelope.name,
      payload: envelope.payload,
      meta: envelope.meta,
      ...(this.resolveSourceRuleId(topic, envelope.meta.ruleId) !== undefined
        ? { sourceRuleId: this.resolveSourceRuleId(topic, envelope.meta.ruleId) }
        : {}),
      receivedAt: this.now(),
    };

    for (const registration of registrations) {
      try {
        await registration.handler({
          stimulus,
          devices: this.deps.registry,
          faults: this.deps.faults,
          logger: this.deps.logger,
        });
      } catch (err) {
        this.deps.logger.error(
          { scenario: registration.scenarioKey, event: envelope.name, error: (err as Error).message },
          "Scenario stimulus handler threw",
        );
      }
    }
  }

  /** Prefer the authoring rule id from the envelope; fall back to the topic. */
  private resolveSourceRuleId(topic: string, metaRuleId: string | undefined): string | undefined {
    if (metaRuleId !== undefined) return metaRuleId;
    const segments = topic.split("/");
    // aeolus/events/<ruleId>/<eventName...>
    return segments.length >= 3 ? segments[2] : undefined;
  }

  /** Dispose every loaded scenario. */
  async dispose(): Promise<void> {
    for (const scenario of this.scenarios) {
      try {
        await scenario.dispose?.();
      } catch (err) {
        this.deps.logger.error(
          { scenario: scenario.key, error: (err as Error).message },
          "Error disposing scenario",
        );
      }
    }
    this.scenarios.length = 0;
    this.handlers.clear();
  }
}
