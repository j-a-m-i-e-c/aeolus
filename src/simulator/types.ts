// src/simulator/types.ts
// phase-2-mqtt-simulator Task 2 — typed simulated-device / model / scenario
// contracts. These are ordinary TypeScript modules, NOT a new DSL (Req 2.3).

import type { Logger } from "pino";
import type { EventMetadata } from "../core/types.js";

/** All simulated device state is a plain JSON-serializable object. */
export type SimulatedState = Record<string, unknown>;

/**
 * Acknowledgement/QoS behaviour a simulated actuator declares. The bootstrap
 * layer translates this into the real Phase 1 MQTT Command Profile — the
 * simulator never invents a second profile inside Aeolus (design §2.1).
 */
export interface SimulatedCommandProfile {
  acknowledgement: {
    /** True when the device replies with a correlated acknowledgement. */
    supported: boolean;
  };
  /** MQTT QoS the real device profile should use for command publishes. */
  qos?: 0 | 1 | 2;
}

/** A command received on a device's command topic, normalized for the model. */
export interface SimulatedInboundCommand {
  /** Command topic the message arrived on. */
  topic: string;
  /** Optional action verb parsed from the payload (e.g. "on"). */
  action?: string;
  /** Parsed command parameters. */
  params: Record<string, unknown>;
  /** The raw decoded payload (object or scalar), for models that need it. */
  rawPayload: unknown;
  /** Correlation id resolved from MQTT 5 properties or the JSON payload. */
  correlationId?: string;
  /** Response topic the acknowledgement must be published on, when supplied. */
  responseTopic?: string;
  /** Epoch ms the command was received. */
  receivedAt: number;
}

/**
 * The outcome a device model returns for a command. The runtime — not the
 * model — formats the wire-level acknowledgement and publishes resulting state
 * (design §4.2). A rejection never pretends the requested physical state
 * occurred (Req 3.6).
 */
export type SimulatedCommandOutcome =
  | {
      accepted: true;
      /** Optional bounded delay before the positive ACK is published. */
      acknowledgement?: { delayMs?: number };
      /** Resulting physical state change to publish after acceptance. */
      state?: {
        patch?: SimulatedState;
        /** Optional bounded delay before the resulting state is published. */
        delayMs?: number;
        /** Publish the resulting state (default true when a patch is present). */
        publish?: boolean;
      };
    }
  | {
      accepted: false;
      /** Device-reported rejection reason, surfaced in the negative ACK. */
      error?: string;
      /** Optional bounded delay before the negative ACK is published. */
      acknowledgement?: { delayMs?: number };
    };

/** A bounded external-world stimulus delivered from a Phase 1 Automation Event. */
export interface ScenarioStimulus {
  /** The declared event name (already validated against the Phase 1 rules). */
  name: string;
  /** The Automation Event payload. */
  payload: unknown;
  /** The Phase 1 event metadata envelope (identity/causation). */
  meta: EventMetadata;
  /** Authoring rule id from the event topic, when available. */
  sourceRuleId?: string;
  /** Epoch ms the stimulus was received. */
  receivedAt: number;
}

/**
 * Per-device state access handed to a model. Every mutation flows through this
 * one path so updates are serialized, no-op publishes are suppressed, and
 * delayed publishes are bounded/cancellable (design §2.2, Req 2.9, 2.10).
 */
export interface SimulatedStateController<TState extends SimulatedState = SimulatedState> {
  /** Read the current state (a defensive copy — mutating it does nothing). */
  read(): Readonly<TState>;
  /** Merge a patch and (by default) publish the resulting state. */
  update(patch: Partial<TState>, options?: StateUpdateOptions): void;
  /** Publish the current state now. `force` bypasses no-op suppression. */
  publish(options?: { force?: boolean }): void;
  /** Advance state over time in bounded, cancellable steps. */
  transition(options: StateTransitionOptions<TState>): StateTransition;
  /** Cancel running transitions, optionally only those in one group. */
  cancelTransitions(group?: string): number;
}

/** A running timed transition. */
export interface StateTransition {
  /** Stop before the next step. Idempotent; a settled transition ignores it. */
  cancel(): void;
  /** True once every step has run, or the transition was cancelled. */
  readonly settled: boolean;
}

/**
 * A movement of physical state over time.
 *
 * Physical things move; publishing a single patch makes them teleport, which is
 * why scenarios kept hand-rolling `setTimeout` chains. Those chains escaped the
 * controller's timer budget and delay clamp and leaked whenever a scenario forgot
 * to clear them on dispose. A transition is the supported form: one outstanding
 * timer at a time, charged to the shared budget, cancelled automatically on
 * dispose, and free to run longer than a single delay may — because its duration
 * is composed of short steps rather than one long wait.
 */
export interface StateTransitionOptions<TState extends SimulatedState = SimulatedState> {
  /** Total wall-clock duration across every step. */
  durationMs: number;
  /** How many patches are published, including the final one. At least 1. */
  steps: number;
  /**
   * Produces the patch for one step. `progress` runs from just above 0 to
   * exactly 1 on the final step; `index` is 1-based. Returning undefined skips
   * the publish for that step without ending the transition.
   */
  frame: (progress: number, index: number) => Partial<TState> | undefined;
  /**
   * Publish every step even when the serialized state is unchanged. Defaults to
   * true: movement the operator is meant to watch should not be suppressed as a
   * no-op just because one interpolated step rounded to the previous value.
   */
  forcePublish?: boolean;
  /**
   * Domain label for coordination. Starting a transition in a group cancels any
   * running transition on this device in the same group, so a repeated
   * interaction replaces its animation instead of fighting it, and a scoped reset
   * can cancel one domain without disturbing the others.
   */
  group?: string;
  /** Called once when the transition ends. `completed` is false when cancelled. */
  onSettled?: (completed: boolean) => void;
}

/** Options controlling a single {@link SimulatedStateController.update}. */
export interface StateUpdateOptions {
  /** Publish the resulting state (default true). */
  publish?: boolean;
  /** Publish even if the serialized state is unchanged (default false). */
  forcePublish?: boolean;
  /** Delay the merge + publish by this many ms (clamped to the runtime max). */
  delayMs?: number;
}

/** Context passed to a device model factory. */
export interface DeviceModelFactoryContext<TState extends SimulatedState = SimulatedState> {
  key: string;
  name: string;
  /** The single per-device state access path. */
  state: SimulatedStateController<TState>;
  logger: Logger;
}

/**
 * A simulated device model. Command handling is optional (sensors omit it) and
 * runs through the runtime's per-device serialized path (Req 3.11).
 */
export interface SimulatedDeviceModel<TState extends SimulatedState = SimulatedState> {
  /** Return the current modelled state. */
  getState(): Readonly<TState>;
  /** Handle an inbound command, returning an accept/reject outcome. */
  onCommand?(command: SimulatedInboundCommand): SimulatedCommandOutcome | Promise<SimulatedCommandOutcome>;
  /** React to a scenario stimulus by changing simulator-owned state. */
  onStimulus?(stimulus: ScenarioStimulus): void | Promise<void>;
  /** Release any model-held resources on shutdown/reload. */
  dispose?(): void | Promise<void>;
}

/**
 * A simulated device definition. `createModel` is declared as a method so a
 * definition typed with a concrete state shape stays assignable to the erased
 * {@link AnyDeviceDefinition} the registry stores.
 */
export interface SimulatedDeviceDefinition<TState extends SimulatedState = SimulatedState> {
  /** Stable simulator-local key. */
  key: string;
  /** Human-readable name. */
  name: string;
  /** Concrete state topic the device publishes on. */
  stateTopic: string;
  /** Concrete command topic the device subscribes to, when it accepts commands. */
  commandTopic?: string;
  /** Initial coherent state published on startup/connect. */
  initialState: TState;
  /** Retain current-state publications (default true). Commands are never retained. */
  retainState?: boolean;
  /** Command capability metadata used by bootstrap/profile configuration. */
  commandProfile?: SimulatedCommandProfile;
  /** Build the device model bound to its per-device state controller. */
  createModel(ctx: DeviceModelFactoryContext<TState>): SimulatedDeviceModel<TState>;
}

/** The erased device-definition type stored heterogeneously by the registry. */
export type AnyDeviceDefinition = SimulatedDeviceDefinition<SimulatedState>;

/** Read-only device access exposed to scenario stimulus handlers. */
export interface ScenarioDeviceView {
  getModel(key: string): SimulatedDeviceModel | undefined;
  getController(key: string): SimulatedStateController | undefined;
}

/**
 * Deterministic, bounded fault behaviour for one device (design §6.1). One-shot
 * faults consume on the next command; latency overrides persist until cleared.
 * A fault changes ONLY simulator wire behaviour — it never writes an Aeolus
 * lifecycle state directly (Req 5.8).
 */
export interface SimulatedFaultState {
  /** Reject the next command with this reason (negative ACK, no success state). */
  rejectNext?: { reason: string };
  /** Suppress the next acknowledgement (drives an Aeolus ACK timeout). */
  dropNextAck?: boolean;
  /** Suppress the next resulting-state publish (drives an observation timeout). */
  suppressNextState?: boolean;
  /** Publish this patch instead of the accepted state (drives a state mismatch). */
  mismatchNextState?: SimulatedState;
  /** Bounded ACK latency override (ms, clamped to the runtime max). */
  ackDelayMs?: number;
  /** Bounded resulting-state latency override (ms, clamped to the runtime max). */
  stateDelayMs?: number;
}

/** The narrow fault-arming surface exposed to trusted scenario stimuli/tests. */
export interface FaultArmer {
  /** Arm (merge) fault behaviour for a named device. Delays are clamped. */
  arm(deviceKey: string, fault: Partial<SimulatedFaultState>): void;
  /** Clear all fault behaviour for a device. */
  clear(deviceKey: string): void;
}

/** Context passed to a scenario stimulus handler. */
export interface ScenarioStimulusContext {
  stimulus: ScenarioStimulus;
  devices: ScenarioDeviceView;
  /** Arm bounded fault behaviour (Req 5.6 — activated only through trusted stimuli). */
  faults: FaultArmer;
  logger: Logger;
}

/**
 * A scenario: a small collection of related device models plus the bounded set
 * of Automation Event stimulus names it explicitly accepts (design §5.2).
 */
export interface SimulatorScenario {
  key: string;
  devices: AnyDeviceDefinition[];
  /** Declared stimulus handlers, keyed by the exact accepted event name. */
  stimuli: Record<string, (ctx: ScenarioStimulusContext) => void | Promise<void>>;
  dispose?(): void | Promise<void>;
}
