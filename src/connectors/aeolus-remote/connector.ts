// src/connectors/aeolus-remote/connector.ts — read one published Project API route of
// another Aeolus installation and expose it as one read-only device.
//
// The device id is derived from the instance id, so it is stable across restarts and
// two instances pointing at the same endpoint never share a device. The device has no
// actions. Its state is the full RemoteObservation (observation.ts) on every poll.

import type { CapabilityDescriptor, Connector, ConnectorHealthStatus } from "../connector.interface.js";
import type { Action, Device } from "../../core/types.js";
import logger from "../../logger.js";
import { parseRemoteConfig, type RemoteConfig } from "./config.js";
import { fetchRemote, type FetchDeps, type TransportResult } from "./transport.js";
import { initialObservation, nextDelayMs, nextObservation, retryAfterMs, type RemoteObservation } from "./observation.js";

export const CONNECTOR_ID = "aeolus-remote";

export const PLAINTEXT_WARNING =
  "Plain HTTP: the API key and the readings cross the network unencrypted. Use this only on a trusted LAN or VPN, or switch the peer to HTTPS.";

export interface RemoteConnectorDeps extends FetchDeps {
  now?: () => number;
  fetch?: (config: RemoteConfig, signal: AbortSignal, deps: FetchDeps) => Promise<TransportResult>;
}

export class AeolusRemoteConnector implements Connector {
  private config: RemoteConfig;
  private observation: RemoteObservation;
  private failures = 0;
  private retryAfter: number | null = null;
  /** Outcome of the last completed poll; null before the first. */
  private lastPollSucceeded: boolean | null = null;
  private lifecycle = new AbortController();
  /** The origin a plaintext warning was last logged for, so it is logged once per connection. */
  private warnedPlaintextFor: string | null = null;
  private readonly deviceId: string;
  private readonly now: () => number;

  constructor(raw: Record<string, unknown>, instanceId: string, private readonly deps: RemoteConnectorDeps = {}) {
    const parsed = parseRemoteConfig(raw);
    // validateConfig refuses a bad config before an instance is created; a stored one
    // that no longer parses (edited by hand) fails closed here.
    if (!parsed.ok) throw new Error(`Invalid aeolus-remote configuration: ${parsed.problems.join("; ")}`);
    this.config = parsed.config;
    this.deviceId = `${CONNECTOR_ID}-${instanceId}`;
    this.now = deps.now ?? Date.now;
    this.observation = initialObservation(this.config);
  }

  async connect(): Promise<void> {
    if (this.lifecycle.signal.aborted) this.lifecycle = new AbortController();
    this.warnPlaintextOnce();
  }

  async disconnect(): Promise<void> {
    this.lifecycle.abort();
  }

  async dispose(): Promise<void> {
    this.lifecycle.abort();
  }

  /** One poll. Never throws: every failure becomes observation state. */
  async discoverDevices(signal?: AbortSignal): Promise<Device[]> {
    const cancel = signal ? AbortSignal.any([signal, this.lifecycle.signal]) : this.lifecycle.signal;
    const fetch = this.deps.fetch ?? fetchRemote;
    const config = this.config;
    const result = await fetch(config, cancel, this.deps);
    if (result.kind === "failure" && result.reason === "aborted") return [this.device()];
    // A config change during the request: its result describes the old endpoint.
    if (config !== this.config) return [this.device()];
    const at = this.now();
    const outcome = nextObservation(this.observation, config, result, at);
    this.observation = outcome.observation;
    this.lastPollSucceeded = outcome.succeeded;
    if (outcome.succeeded) {
      this.failures = 0;
      this.retryAfter = null;
    } else {
      this.failures += 1;
      this.retryAfter = result.kind === "response" && result.status === 429 ? retryAfterMs(result.retryAfter, at) : null;
    }
    return [this.device()];
  }

  getPollIntervalMs(): number {
    return nextDelayMs(this.config, this.failures, this.retryAfter);
  }

  /** Read-only: there is nothing to command. */
  async execute(_action: Action): Promise<void> {
    throw new Error("Remote Aeolus observations are read-only");
  }

  /** An empty catalogue, so no fallback action map applies to this device. */
  getActionCatalog(_deviceId: string): CapabilityDescriptor[] {
    return [];
  }

  getHealthStatus(): ConnectorHealthStatus {
    const { observation } = this;
    const warnings = this.config.protocol === "http:" ? [PLAINTEXT_WARNING] : undefined;
    const lastSeen = observation.lastSuccessAt ?? 0;
    if (this.lastPollSucceeded !== true) {
      return { status: "disconnected", lastSeen, ...(observation.error ? { errorMessage: observation.error } : {}), ...(warnings ? { warnings } : {}) };
    }
    if (observation.stale) {
      return { status: "degraded", lastSeen, ...(observation.error ? { errorMessage: observation.error } : {}), ...(warnings ? { warnings } : {}) };
    }
    return { status: "connected", lastSeen, ...(warnings ? { warnings } : {}) };
  }

  /**
   * Apply a resolved, validated config. A new endpoint or key starts again from no
   * reading, because the old one describes a different source or grant.
   */
  onConfigUpdate(raw: Record<string, unknown>): void {
    const parsed = parseRemoteConfig(raw);
    if (!parsed.ok) throw new Error(`Invalid aeolus-remote configuration: ${parsed.problems.join("; ")}`);
    const previous = this.config;
    const next = parsed.config;
    const sameSource = previous.origin === next.origin && previous.endpointPath === next.endpointPath && previous.apiKey === next.apiKey;
    this.config = next;
    this.failures = 0;
    this.retryAfter = null;
    if (sameSource) {
      this.observation = { ...this.observation, staleAfterMs: next.staleAfterMs };
    } else {
      this.observation = initialObservation(next);
      this.lastPollSucceeded = null;
    }
    if (previous.origin !== next.origin) this.warnedPlaintextFor = null;
    this.warnPlaintextOnce();
  }

  private warnPlaintextOnce(): void {
    if (this.config.protocol !== "http:" || this.warnedPlaintextFor === this.config.origin) return;
    this.warnedPlaintextFor = this.config.origin;
    logger.warn(
      { connector: CONNECTOR_ID, deviceId: this.deviceId, origin: this.config.origin },
      "Remote Aeolus connector uses plain HTTP: the API key crosses the network unencrypted",
    );
  }

  private device(): Device {
    return {
      id: this.deviceId,
      name: this.config.displayName,
      type: "sensor",
      capabilities: [],
      state: { ...this.observation } as unknown as Record<string, unknown>,
      integration: CONNECTOR_ID,
      lastSeen: this.observation.lastSuccessAt ?? 0,
    };
  }
}
