// src/mqtt/broker-verifier.ts — Confirm the broker actually enforces a policy.
//
// The provisioning service writes Mosquitto's config/password files and triggers
// a reload, but under the recommended `MQTT_RELOAD_STRATEGY=none` deployment the
// reload is delegated to a sidecar and is inherently asynchronous. Trusting that
// a reload was *dispatched* is not the same as knowing the broker has *applied*
// the change. The BrokerVerifier closes that gap by observing the broker's
// actual behaviour: it opens throwaway MQTT connections and classifies whether a
// credential is accepted or rejected, polling within a bounded budget so an
// async reload is tolerated without reporting premature success.
//
// This is deliberately connection-based rather than reload-mechanism-based, so
// it works identically whether the reload arrives via the sidecar, a signal, or
// a custom command.

import mqtt from "mqtt";
import logger from "../logger.js";

/** The observed result of a single connection attempt. */
export type ProbeOutcome = "accepted" | "rejected" | "unreachable";

export interface BrokerVerifierOptions {
  brokerUrl: string;
  /** Per-attempt connection timeout. Default 3000ms. */
  connectTimeoutMs?: number;
  /** Total polling budget across retries. Default 12000ms. */
  budgetMs?: number;
  /** Gap between poll attempts. Default 500ms. */
  pollIntervalMs?: number;
}

type Credentials = { username?: string; password?: string } | null;

/** Transport-level failures that mean "broker not reachable", not "credential refused". */
const TRANSPORT_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
]);

const DEFAULT_CONNECT_TIMEOUT_MS = 3000;
const DEFAULT_BUDGET_MS = 12000;
const DEFAULT_POLL_INTERVAL_MS = 500;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Opens short-lived MQTT connections to confirm an expected authentication
 * outcome. Never disturbs the backend's live ingestion client — every probe
 * uses its own throwaway client that is always closed.
 */
export class BrokerVerifier {
  private readonly brokerUrl: string;
  private readonly connectTimeoutMs: number;
  private readonly budgetMs: number;
  private readonly pollIntervalMs: number;

  constructor(options: BrokerVerifierOptions) {
    this.brokerUrl = options.brokerUrl;
    this.connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this.budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  /**
   * Attempt one throwaway connection and classify the outcome. Never throws:
   * failures resolve to `rejected` (broker refused the credential) or
   * `unreachable` (transport-level failure or timeout). The client is always
   * force-closed exactly once before resolving.
   */
  probe(credentials: Credentials): Promise<ProbeOutcome> {
    return new Promise<ProbeOutcome>((resolve) => {
      const client = mqtt.connect(this.brokerUrl, {
        reconnectPeriod: 0, // one shot — the verifier drives its own retries
        connectTimeout: this.connectTimeoutMs,
        protocolVersion: 5,
        ...(credentials?.username !== undefined ? { username: credentials.username } : {}),
        ...(credentials?.password !== undefined ? { password: credentials.password } : {}),
      });

      let settled = false;
      const finish = (outcome: ProbeOutcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(guard);
        // Force-close; swallow any close error — the outcome is already decided.
        try {
          client.end(true, () => resolve(outcome));
        } catch {
          resolve(outcome);
        }
      };

      // Absolute guard in case neither connect nor error fires within budget.
      const guard = setTimeout(() => finish("unreachable"), this.connectTimeoutMs + 500);

      client.on("connect", () => finish("accepted"));
      client.on("error", (err: Error) => {
        // Transport failures carry a string errno code (e.g. ECONNREFUSED);
        // broker CONNACK refusals carry a numeric MQTT reason code. Only the
        // former means "not reachable"; anything else is an auth refusal.
        const code = (err as { code?: unknown }).code;
        const isTransport = typeof code === "string" && TRANSPORT_ERROR_CODES.has(code);
        finish(isTransport ? "unreachable" : "rejected");
      });
      // A close before any connect/error is a transport failure, not a refusal.
      client.on("close", () => finish("unreachable"));
    });
  }

  /** Poll until a connection with these credentials is accepted, else false at budget. */
  waitForAccepted(credentials: Credentials): Promise<boolean> {
    return this.waitFor(credentials, "accepted");
  }

  /** Poll until a connection with these credentials is rejected, else false at budget. */
  waitForRejected(credentials: Credentials): Promise<boolean> {
    return this.waitFor(credentials, "rejected");
  }

  /**
   * Retry `probe` until it yields `expected` or the budget is exhausted.
   * `unreachable` is treated as "not yet" for either target, since a broker
   * mid-reload (or briefly restarting) can appear unreachable transiently.
   */
  private async waitFor(credentials: Credentials, expected: ProbeOutcome): Promise<boolean> {
    const deadline = Date.now() + this.budgetMs;
    let attempts = 0;

    for (;;) {
      attempts += 1;
      const outcome = await this.probe(credentials);
      if (outcome === expected) {
        logger.debug({ expected, attempts }, "Broker verification satisfied");
        return true;
      }
      if (Date.now() + this.pollIntervalMs >= deadline) {
        logger.warn(
          { expected, lastOutcome: outcome, attempts, budgetMs: this.budgetMs },
          "Broker verification not satisfied within budget",
        );
        return false;
      }
      await sleep(this.pollIntervalMs);
    }
  }
}
