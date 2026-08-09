// src/automations/automation-event-service.ts
// phase-1-runtime-foundations Task 8 — safe automation-to-automation events over
// a reserved MQTT namespace. This is NOT a Verified Command: it never touches
// CommandService, produces no command record, and only ever publishes inside
// `aeolus/events/<sourceRuleId>/...`, so a scoped automation can emit without
// receiving arbitrary MQTT publish authority (Req 6).

import type { Logger } from "pino";
import type { MqttService } from "../mqtt/mqtt-service.js";
import type { EventMetadata } from "../core/types.js";
import { newEventMetadata } from "../core/event-metadata.js";
import { currentExecutionContext } from "./execution-context.js";

/** Reserved MQTT namespace owned by Aeolus for automation events. */
export const RESERVED_EVENT_NAMESPACE = "aeolus/events";
/** Versioned envelope schema tag. */
export const AUTOMATION_EVENT_SCHEMA = "aeolus.automation-event.v1";
/** Maximum causal hop count before emission is refused (A -> B -> A guard). */
export const MAX_EVENT_DEPTH = 16;
/** Maximum serialized envelope size (bytes) — bounds payload growth. */
export const MAX_ENVELOPE_BYTES = 64 * 1024;

/** Versioned payload published to the reserved namespace. */
export interface AutomationEventEnvelopeV1 {
  schema: typeof AUTOMATION_EVENT_SCHEMA;
  name: string;
  payload: unknown;
  meta: EventMetadata;
}

/** Truthful result of an emit attempt — reports local publish acceptance only. */
export interface AutomationEventEmitResult {
  published: boolean;
  eventId?: string;
  topic?: string;
  error?: string;
}

/**
 * Validate a single event name (which may contain a small path). Each segment
 * must be a safe topic segment so a caller cannot escape the reserved namespace
 * or inject MQTT wildcards (Req 6.5).
 */
export function isValidEventName(name: unknown): name is string {
  if (typeof name !== "string") return false;
  if (name.length < 1 || name.length > 128) return false;
  if (name.startsWith("/") || name.endsWith("/")) return false;
  const segments = name.split("/");
  for (const seg of segments) {
    if (seg.length === 0) return false; // empty segment (e.g. "a//b" or leading/trailing)
    if (seg === "." || seg === "..") return false; // traversal-like
    if (!/^[A-Za-z0-9_.-]+$/.test(seg)) return false; // no +, #, NUL, spaces, etc.
  }
  return true;
}

export interface AutomationEventServiceDeps {
  mqttService: MqttService;
  logger: Logger;
  /** Override the reserved namespace (defaults to {@link RESERVED_EVENT_NAMESPACE}). */
  namespace?: string;
  /** Override the maximum causal depth (defaults to {@link MAX_EVENT_DEPTH}). */
  maxDepth?: number;
}

/**
 * Emits constrained domain events for automations. The source rule id is taken
 * from the trusted active execution context, never from the caller, so the
 * topic's `<sourceRuleId>` segment cannot be spoofed by user script.
 */
export class AutomationEventService {
  private readonly mqttService: MqttService;
  private readonly logger: Logger;
  private readonly namespace: string;
  private readonly maxDepth: number;

  constructor(deps: AutomationEventServiceDeps) {
    this.mqttService = deps.mqttService;
    this.logger = deps.logger;
    this.namespace = deps.namespace ?? RESERVED_EVENT_NAMESPACE;
    this.maxDepth = deps.maxDepth ?? MAX_EVENT_DEPTH;
  }

  /**
   * Emit an automation event. Resolves the source rule and causal context from
   * the active execution context (host-derived), enforces the bounded causal
   * depth, and publishes a versioned envelope to the reserved namespace.
   *
   * Never throws into user script; returns a truthful result about local MQTT
   * publish acceptance only (it can never claim delivery to another automation).
   */
  emit(eventName: unknown, payload: unknown): AutomationEventEmitResult {
    const ctx = currentExecutionContext();
    const ruleId = ctx?.automationId;
    if (!ruleId) {
      this.logger.warn("events.emit called outside an automation execution context; refused");
      return { published: false, error: "No active automation execution context" };
    }

    if (!isValidEventName(eventName)) {
      this.logger.warn({ ruleId }, "events.emit refused: invalid event name");
      return { published: false, error: "Invalid event name" };
    }

    // Bounded causal depth (Req 6.15, 6.16). The trigger's depth + 1 is this
    // event's depth; refuse before publishing when the ceiling is reached.
    const parentDepth = ctx?.triggerMeta?.depth ?? 0;
    const depth = parentDepth + 1;
    if (depth > this.maxDepth) {
      this.logger.warn(
        { ruleId, depth, maxDepth: this.maxDepth },
        "events.emit refused: maximum automation-event causal depth reached",
      );
      return { published: false, error: "Maximum automation-event depth reached" };
    }

    const meta = newEventMetadata(
      { kind: "automation", id: ruleId },
      {
        ...(ctx?.triggerMeta?.eventId ? { causationId: ctx.triggerMeta.eventId } : {}),
        ruleId,
        ...(ctx?.executionId ? { executionId: ctx.executionId } : {}),
        ...(ctx?.triggerMeta?.traceId ? { traceId: ctx.triggerMeta.traceId } : {}),
        depth,
      },
    );

    const envelope: AutomationEventEnvelopeV1 = {
      schema: AUTOMATION_EVENT_SCHEMA,
      name: eventName,
      payload,
      meta,
    };

    let serialized: string;
    try {
      serialized = JSON.stringify(envelope);
    } catch {
      this.logger.warn({ ruleId }, "events.emit refused: payload is not JSON-serializable");
      return { published: false, error: "Payload is not JSON-serializable" };
    }
    if (serialized.length > MAX_ENVELOPE_BYTES) {
      this.logger.warn({ ruleId, bytes: serialized.length }, "events.emit refused: envelope too large");
      return { published: false, error: "Automation event too large" };
    }

    // Aeolus owns the <sourceRuleId> topic segment; the caller supplies only the
    // event name (already validated). This cannot escape the reserved namespace.
    const topic = `${this.namespace}/${ruleId}/${eventName}`;

    try {
      this.mqttService.publish(topic, serialized);
      return { published: true, eventId: meta.eventId, topic };
    } catch (err) {
      this.logger.error(
        { ruleId, topic, error: (err as Error).message },
        "events.emit failed to publish to the broker",
      );
      return { published: false, eventId: meta.eventId, topic, error: (err as Error).message };
    }
  }
}

/**
 * Parse and validate a raw message on the reserved namespace into an envelope,
 * or return undefined when it is not a well-formed automation event. Used by the
 * MQTT ingestion path; a malformed envelope is ignored (no device, no trigger).
 */
export function parseAutomationEventEnvelope(raw: string): AutomationEventEnvelopeV1 | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const obj = parsed as Record<string, unknown>;
  if (obj.schema !== AUTOMATION_EVENT_SCHEMA) return undefined;
  if (!isValidEventName(obj.name)) return undefined;
  const meta = obj.meta;
  if (typeof meta !== "object" || meta === null) return undefined;
  const m = meta as Record<string, unknown>;
  if (typeof m.eventId !== "string" || typeof m.timestamp !== "number") return undefined;
  return {
    schema: AUTOMATION_EVENT_SCHEMA,
    name: obj.name,
    payload: obj.payload,
    meta: meta as EventMetadata,
  };
}
