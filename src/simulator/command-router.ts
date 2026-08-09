// src/simulator/command-router.ts
// phase-2-mqtt-simulator Task 3 — generic-MQTT command wire contract.
//
// Parses the EXACT payload Aeolus publishes for a generic MQTT device command
// (no simulator-only envelope — Req 3.2), resolves correlation using the Phase 1
// precedence (MQTT 5 Correlation Data / Response Topic win, else the mirrored
// JSON fields — Req 3.3, 3.4), runs the device model on a per-device serialized
// path (Req 3.11), and publishes the Phase 1 acknowledgement shape only after
// the model accepts (Req 3.5). A model rejection publishes the negative ACK and
// never the requested success state (Req 3.6). Dispatch-only commands (no
// correlation) run without manufacturing a fake ACK (Req 3.10). Duplicate
// correlated deliveries never apply the physical change twice (Req 3.12).

import type { IPublishPacket } from "mqtt";
import type { Logger } from "pino";
import type { SimulatorDeviceRegistry } from "./device-registry.js";
import type { SimulatorPublishOptions } from "./mqtt-client.js";
import type { FaultController, ConsumedFault } from "./fault-controller.js";
import type { TimerBudget } from "./timer-budget.js";
import type { SimulatedCommandOutcome, SimulatedInboundCommand } from "./types.js";

/** Publish sink for acknowledgement messages (wired to the MQTT client). */
export type AckPublishFn = (topic: string, payload: string, options: SimulatorPublishOptions) => void;

export interface SimulatorCommandRouterDeps {
  registry: SimulatorDeviceRegistry;
  publish: AckPublishFn;
  logger: Logger;
  /** Upper bound applied to any ACK delay. */
  maxDelayMs: number;
  /** How long a completed correlation id is remembered for dedupe. Default 5 min. */
  dedupeTtlMs?: number;
  /** Maximum remembered correlation ids. Default 1000. */
  dedupeMaxEntries?: number;
  /** Deterministic fault injection. Absent ⇒ no faults. */
  faults?: FaultController;
  /** Shared cap on outstanding delayed operations. Absent ⇒ unbounded (tests). */
  timerBudget?: TimerBudget;
  /** Maximum queued commands per device before fail-fast drop. Default 100. */
  maxQueueDepth?: number;
  /** Injectable clock (tests). Default Date.now. */
  now?: () => number;
}

const DEFAULT_MAX_QUEUE_DEPTH = 100;
const EMPTY_FAULT: ConsumedFault = { dropNextAck: false, suppressNextState: false };

interface DedupeEntry {
  deviceKey: string;
  completedAt: number;
  /** The ACK previously published, resent verbatim on a duplicate delivery. */
  ack?: { topic: string; payload: string; options: SimulatorPublishOptions };
}

const DEFAULT_DEDUPE_TTL_MS = 5 * 60_000;
const DEFAULT_DEDUPE_MAX_ENTRIES = 1000;

export class SimulatorCommandRouter {
  private readonly deps: SimulatorCommandRouterDeps;
  private readonly now: () => number;
  private readonly dedupeTtlMs: number;
  private readonly dedupeMaxEntries: number;
  private readonly completed = new Map<string, DedupeEntry>();
  private readonly queues = new Map<string, Promise<void>>();
  private readonly queueDepth = new Map<string, number>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly maxQueueDepth: number;
  private disposed = false;

  constructor(deps: SimulatorCommandRouterDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
    this.dedupeTtlMs = deps.dedupeTtlMs ?? DEFAULT_DEDUPE_TTL_MS;
    this.dedupeMaxEntries = deps.dedupeMaxEntries ?? DEFAULT_DEDUPE_MAX_ENTRIES;
    this.maxQueueDepth = deps.maxQueueDepth ?? DEFAULT_MAX_QUEUE_DEPTH;
  }

  /**
   * Handle an inbound message on a device command topic. Resolves when this
   * command has finished processing (ACK published; resulting state scheduled).
   * Unknown command topics are ignored.
   */
  handleCommand(topic: string, payload: Buffer, packet?: IPublishPacket): Promise<void> {
    const device = this.deps.registry.getByCommandTopic(topic);
    if (!device) {
      this.deps.logger.debug({ topic }, "Command on an unknown topic ignored");
      return Promise.resolve();
    }
    const key = device.definition.key;

    // Fail-fast on an interaction storm: never let one device's queue grow
    // without bound (Req 5.7, §6.3). A dropped command lets Aeolus time out.
    const depth = this.queueDepth.get(key) ?? 0;
    if (depth >= this.maxQueueDepth) {
      this.deps.logger.warn({ deviceKey: key, depth }, "Command queue full; dropping command (fail-fast)");
      return Promise.resolve();
    }
    this.queueDepth.set(key, depth + 1);

    const command = this.parseCommand(topic, payload, packet);
    return this.enqueue(key, async () => {
      try {
        await this.process(key, command);
      } finally {
        const current = this.queueDepth.get(key) ?? 1;
        if (current <= 1) this.queueDepth.delete(key);
        else this.queueDepth.set(key, current - 1);
      }
    });
  }

  /** Parse the generic-MQTT command payload and resolve correlation fields. */
  private parseCommand(topic: string, payload: Buffer, packet?: IPublishPacket): SimulatedInboundCommand {
    const raw = payload.toString("utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = raw;
    }

    const payloadObject =
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};

    // Phase 1 precedence: MQTT 5 property wins, else the mirrored JSON field.
    const correlationData = packet?.properties?.correlationData as Buffer | undefined;
    const mqtt5CorrelationId =
      correlationData !== undefined && correlationData.length > 0
        ? Buffer.from(correlationData).toString("utf8")
        : undefined;
    const payloadCorrelationId =
      typeof payloadObject.correlationId === "string" ? payloadObject.correlationId : undefined;
    const correlationId = mqtt5CorrelationId ?? payloadCorrelationId;

    const mqtt5ResponseTopic = packet?.properties?.responseTopic;
    const payloadResponseTopic =
      typeof payloadObject.responseTopic === "string" ? payloadObject.responseTopic : undefined;
    const responseTopic = mqtt5ResponseTopic ?? payloadResponseTopic;

    // Present the model with clean params (correlation fields stripped).
    const params: Record<string, unknown> = { ...payloadObject };
    delete params.correlationId;
    delete params.responseTopic;

    return {
      topic,
      ...(typeof params.action === "string" ? { action: params.action } : {}),
      params,
      rawPayload: parsed,
      ...(correlationId !== undefined ? { correlationId } : {}),
      ...(responseTopic !== undefined ? { responseTopic } : {}),
      receivedAt: this.now(),
    };
  }

  /** Serialize command handling per device (Req 3.11). */
  private enqueue(deviceKey: string, task: () => Promise<void>): Promise<void> {
    const previous = this.queues.get(deviceKey) ?? Promise.resolve();
    const next = previous.then(task, task);
    // Keep the tail settled so a rejected task never wedges the queue.
    this.queues.set(
      deviceKey,
      next.catch(() => undefined),
    );
    return next;
  }

  private async process(deviceKey: string, command: SimulatedInboundCommand): Promise<void> {
    const device = this.deps.registry.get(deviceKey);
    if (!device) return;

    // Duplicate correlated delivery — never apply the physical change twice.
    if (command.correlationId !== undefined) {
      const existing = this.lookupDedupe(command.correlationId);
      if (existing) {
        this.deps.logger.debug(
          { deviceKey, correlationId: command.correlationId },
          "Duplicate correlated command ignored; resending prior ACK",
        );
        if (existing.ack) {
          this.publishAck(existing.ack.topic, existing.ack.payload, existing.ack.options);
        }
        return;
      }
    }

    // Consume one-shot faults up front so they clear deterministically even if
    // the command later errors (design §6.2).
    const fault = this.deps.faults?.consume(deviceKey) ?? EMPTY_FAULT;

    // rejectNext short-circuits the model entirely (negative ACK, no state).
    if (fault.rejectNext) {
      const ack = await this.maybePublishAck(
        command,
        { success: false, error: fault.rejectNext.reason, ackDelayMs: fault.ackDelayMs },
        fault.dropNextAck,
      );
      if (command.correlationId !== undefined) this.recordDedupe(command.correlationId, deviceKey, ack);
      return;
    }

    const model = device.model;
    if (!model.onCommand) {
      this.deps.logger.warn({ deviceKey, topic: command.topic }, "Device received a command but declares no handler");
      return;
    }

    let outcome: SimulatedCommandOutcome;
    try {
      outcome = await model.onCommand(command);
    } catch (err) {
      this.deps.logger.error(
        { deviceKey, error: (err as Error).message },
        "Device model threw while handling a command; treating as rejection",
      );
      outcome = { accepted: false, error: (err as Error).message };
    }

    const ackDelayMs = fault.ackDelayMs ?? outcome.acknowledgement?.delayMs;

    let ack: DedupeEntry["ack"];
    if (outcome.accepted) {
      ack = await this.maybePublishAck(command, { success: true, ackDelayMs }, fault.dropNextAck);
      this.applyResultingState(device.controller, outcome, fault);
    } else {
      ack = await this.maybePublishAck(command, { success: false, error: outcome.error, ackDelayMs }, fault.dropNextAck);
      // A rejection never publishes the requested success state (Req 3.6).
    }

    if (command.correlationId !== undefined) {
      this.recordDedupe(command.correlationId, deviceKey, ack);
    }
  }

  /**
   * Publish the acknowledgement when the command is correlated. A command with
   * no correlation id / response topic executes without a manufactured ACK
   * (Req 3.10). Returns the published ACK so it can be cached for dedupe.
   */
  private async maybePublishAck(
    command: SimulatedInboundCommand,
    outcome: { success: boolean; error?: string; ackDelayMs?: number },
    dropAck = false,
  ): Promise<DedupeEntry["ack"]> {
    if (command.correlationId === undefined || command.responseTopic === undefined) {
      return undefined;
    }
    if (dropAck) {
      this.deps.logger.debug({ correlationId: command.correlationId }, "ACK suppressed by fault (drops to timeout)");
      return undefined;
    }

    const delayMs = this.clampDelay(outcome.ackDelayMs ?? 0);
    if (delayMs > 0) await this.sleep(delayMs);
    if (this.disposed) return undefined;

    const payloadObject: Record<string, unknown> = { correlationId: command.correlationId, success: outcome.success };
    if (!outcome.success && outcome.error !== undefined) payloadObject.error = outcome.error;
    const payload = JSON.stringify(payloadObject);

    const options: SimulatorPublishOptions = {
      correlationData: Buffer.from(command.correlationId, "utf8"),
      retain: false,
    };
    this.publishAck(command.responseTopic, payload, options);
    return { topic: command.responseTopic, payload, options };
  }

  private applyResultingState(
    controller: { update: (patch: Record<string, unknown>, options?: { publish?: boolean; delayMs?: number }) => void },
    outcome: Extract<SimulatedCommandOutcome, { accepted: true }>,
    fault: ConsumedFault,
  ): void {
    // Suppress the resulting state so an observed-tier command times out.
    if (fault.suppressNextState) {
      this.deps.logger.debug("Resulting state suppressed by fault (drops to observation timeout)");
      return;
    }

    // Publish a deliberately wrong state so an observed-tier command mismatches.
    if (fault.mismatchNextState) {
      controller.update(fault.mismatchNextState, {
        ...(fault.stateDelayMs !== undefined ? { delayMs: fault.stateDelayMs } : {}),
      });
      return;
    }

    const state = outcome.state;
    if (!state || !state.patch) return;
    if (state.publish === false) {
      controller.update(state.patch, { publish: false });
      return;
    }
    const delayMs = fault.stateDelayMs ?? state.delayMs;
    controller.update(state.patch, {
      ...(delayMs !== undefined ? { delayMs } : {}),
    });
  }

  private publishAck(topic: string, payload: string, options: SimulatorPublishOptions): void {
    try {
      this.deps.publish(topic, payload, options);
    } catch (err) {
      this.deps.logger.error({ topic, error: (err as Error).message }, "Failed to publish acknowledgement");
    }
  }

  private lookupDedupe(correlationId: string): DedupeEntry | undefined {
    const entry = this.completed.get(correlationId);
    if (!entry) return undefined;
    if (this.now() - entry.completedAt > this.dedupeTtlMs) {
      this.completed.delete(correlationId);
      return undefined;
    }
    return entry;
  }

  private recordDedupe(correlationId: string, deviceKey: string, ack: DedupeEntry["ack"]): void {
    this.completed.set(correlationId, { deviceKey, completedAt: this.now(), ...(ack ? { ack } : {}) });
    // Bound by size: evict oldest insertions first.
    while (this.completed.size > this.dedupeMaxEntries) {
      const oldest = this.completed.keys().next().value;
      if (oldest === undefined) break;
      this.completed.delete(oldest);
    }
  }

  private clampDelay(delayMs: number): number {
    if (Number.isNaN(delayMs) || delayMs <= 0) return 0;
    return Math.min(delayMs, this.deps.maxDelayMs);
  }

  private sleep(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    // When the shared budget is exhausted, skip the delay rather than schedule
    // another timer (Req 5.7).
    if (this.deps.timerBudget && !this.deps.timerBudget.tryAcquire()) {
      this.deps.logger.debug("Timer budget exhausted; ACK published without delay");
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        this.deps.timerBudget?.release();
        resolve();
      }, ms);
      (timer as { unref?: () => void }).unref?.();
      this.timers.add(timer);
    });
  }

  /** Number of remembered correlation ids (observability/tests). */
  get dedupeSize(): number {
    return this.completed.size;
  }

  /** Cancel outstanding ACK-delay timers. */
  dispose(): void {
    this.disposed = true;
    for (const timer of this.timers) {
      clearTimeout(timer);
      this.deps.timerBudget?.release();
    }
    this.timers.clear();
  }
}
