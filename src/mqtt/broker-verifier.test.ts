// src/mqtt/broker-verifier.test.ts — Unit tests for the connection-based verifier.
//
// The real `mqtt` module is mocked so we can drive connect/error/close events
// deterministically and assert probe classification, that every client is
// always closed, and that polling honours the budget.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";

vi.mock("../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

interface MockClient extends EventEmitter {
  end: ReturnType<typeof vi.fn>;
}

/** A mock mqtt client that records end() and lets tests emit lifecycle events. */
function createMockClient(): MockClient {
  const emitter = new EventEmitter() as MockClient;
  emitter.end = vi.fn((_force?: boolean, cb?: () => void) => {
    if (cb) cb();
    return emitter;
  });
  return emitter;
}

const mockConnect = vi.fn();
vi.mock("mqtt", () => ({
  default: { connect: (...args: unknown[]) => mockConnect(...args) },
  connect: (...args: unknown[]) => mockConnect(...args),
}));

import { BrokerVerifier } from "./broker-verifier.js";

/**
 * Arrange the next `mqtt.connect(...)` call to return a fresh client that emits
 * the given lifecycle event once listeners are attached. Emitting on the call
 * (not at queue time) guarantees the probe's listeners are in place first.
 */
function queueClientEmitting(event: string, arg?: unknown): MockClient {
  const client = createMockClient();
  mockConnect.mockImplementationOnce(() => {
    queueMicrotask(() => client.emit(event, arg));
    return client;
  });
  return client;
}

describe("BrokerVerifier", () => {
  beforeEach(() => {
    mockConnect.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("probe classification", () => {
    it("classifies a successful CONNACK as accepted", async () => {
      const client = queueClientEmitting("connect");
      const verifier = new BrokerVerifier({ brokerUrl: "mqtt://localhost:1883" });

      const outcome = await verifier.probe({ username: "u", password: "p" });

      expect(outcome).toBe("accepted");
      expect(client.end).toHaveBeenCalledWith(true, expect.any(Function));
    });

    it("classifies a broker auth refusal as rejected", async () => {
      queueClientEmitting("error", Object.assign(new Error("Not authorized"), { code: 135 }));
      const verifier = new BrokerVerifier({ brokerUrl: "mqtt://localhost:1883" });

      expect(await verifier.probe({ username: "u", password: "bad" })).toBe("rejected");
    });

    it("classifies a transport error as unreachable", async () => {
      queueClientEmitting("error", Object.assign(new Error("refused"), { code: "ECONNREFUSED" }));
      const verifier = new BrokerVerifier({ brokerUrl: "mqtt://localhost:1883" });

      expect(await verifier.probe(null)).toBe("unreachable");
    });

    it("classifies a close-before-connect as unreachable", async () => {
      queueClientEmitting("close");
      const verifier = new BrokerVerifier({ brokerUrl: "mqtt://localhost:1883" });

      expect(await verifier.probe(null)).toBe("unreachable");
    });

    it("always closes the client, even on rejection", async () => {
      const client = queueClientEmitting("error", new Error("nope"));
      const verifier = new BrokerVerifier({ brokerUrl: "mqtt://localhost:1883" });

      await verifier.probe({ username: "u", password: "p" });

      expect(client.end).toHaveBeenCalledTimes(1);
    });

    it("passes credentials through to mqtt.connect", async () => {
      queueClientEmitting("connect");
      const verifier = new BrokerVerifier({ brokerUrl: "mqtt://broker:1883" });

      await verifier.probe({ username: "alice", password: "secret" });

      expect(mockConnect).toHaveBeenCalledWith(
        "mqtt://broker:1883",
        expect.objectContaining({ username: "alice", password: "secret", reconnectPeriod: 0 }),
      );
    });

    it("omits credentials for an anonymous probe", async () => {
      queueClientEmitting("connect");
      const verifier = new BrokerVerifier({ brokerUrl: "mqtt://broker:1883" });

      await verifier.probe(null);

      const opts = mockConnect.mock.calls[0][1] as Record<string, unknown>;
      expect(opts).not.toHaveProperty("username");
      expect(opts).not.toHaveProperty("password");
    });
  });

  describe("waitForAccepted / waitForRejected", () => {
    it("returns true as soon as the expected outcome is observed", async () => {
      queueClientEmitting("connect");
      const verifier = new BrokerVerifier({ brokerUrl: "mqtt://localhost:1883", budgetMs: 5000 });

      expect(await verifier.waitForAccepted({ username: "u", password: "p" })).toBe(true);
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });

    it("polls until the outcome flips, then returns true", async () => {
      // First two attempts unreachable (broker mid-reload), third accepted.
      queueClientEmitting("close");
      queueClientEmitting("close");
      queueClientEmitting("connect");
      const verifier = new BrokerVerifier({
        brokerUrl: "mqtt://localhost:1883",
        budgetMs: 5000,
        pollIntervalMs: 1,
      });

      expect(await verifier.waitForAccepted(null)).toBe(true);
      expect(mockConnect).toHaveBeenCalledTimes(3);
    });

    it("returns false when the budget is exhausted without the expected outcome", async () => {
      // Every attempt is unreachable; a tiny budget forces quick give-up.
      mockConnect.mockImplementation(() => {
        const client = createMockClient();
        queueMicrotask(() => client.emit("close"));
        return client;
      });
      const verifier = new BrokerVerifier({
        brokerUrl: "mqtt://localhost:1883",
        budgetMs: 5,
        pollIntervalMs: 1,
      });

      expect(await verifier.waitForAccepted(null)).toBe(false);
    });

    it("waitForRejected succeeds when the broker refuses the credential", async () => {
      queueClientEmitting("error", Object.assign(new Error("bad auth"), { code: 135 }));
      const verifier = new BrokerVerifier({ brokerUrl: "mqtt://localhost:1883", budgetMs: 5000 });

      expect(await verifier.waitForRejected({ username: "revoked", password: "x" })).toBe(true);
    });
  });
});
