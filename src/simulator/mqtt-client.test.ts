// src/simulator/mqtt-client.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import type { Logger } from "pino";
import type { MqttClient } from "mqtt";
import { SimulatorMqttClient, computeRetryDelay, type MqttConnectFn } from "./mqtt-client.js";

function stubLogger(): Logger {
  const noop = (): void => undefined;
  return { info: noop, warn: noop, error: noop, debug: noop } as unknown as Logger;
}

/** Minimal in-memory stand-in for an mqtt.js client. */
class FakeMqttClient extends EventEmitter {
  subscribed: string[] = [];
  published: Array<{ topic: string; payload: string; opts: Record<string, unknown> }> = [];
  ended = false;

  subscribe(topic: string, cb: (err: Error | null) => void): void {
    this.subscribed.push(topic);
    cb(null);
  }

  publish(topic: string, payload: string, opts: Record<string, unknown>, cb: (err?: Error) => void): void {
    this.published.push({ topic, payload, opts });
    cb();
  }

  end(_force?: boolean, opts?: unknown, cb?: () => void): this {
    this.ended = true;
    const done = typeof opts === "function" ? (opts as () => void) : cb;
    if (done) done();
    return this;
  }
}

/** Build a connect factory that yields a fresh fake per attempt and records them. */
function fakeConnectFactory(): { connectFn: MqttConnectFn; clients: FakeMqttClient[]; calls: () => number } {
  const clients: FakeMqttClient[] = [];
  const connectFn: MqttConnectFn = () => {
    const client = new FakeMqttClient();
    clients.push(client);
    return client as unknown as MqttClient;
  };
  return { connectFn, clients, calls: () => clients.length };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("computeRetryDelay", () => {
  it("grows exponentially and clamps to the maximum", () => {
    expect(computeRetryDelay(1, 1000, 30000)).toBe(1000);
    expect(computeRetryDelay(2, 1000, 30000)).toBe(2000);
    expect(computeRetryDelay(3, 1000, 30000)).toBe(4000);
    expect(computeRetryDelay(10, 1000, 30000)).toBe(30000);
  });
});

describe("SimulatorMqttClient", () => {
  it("resolves connect and reports connected once the broker acknowledges", async () => {
    const { connectFn, clients } = fakeConnectFactory();
    const client = new SimulatorMqttClient({
      brokerUrl: "mqtt://localhost:1883",
      clientId: "test",
      baseRetryDelayMs: 1000,
      maxBackoffMs: 30000,
      logger: stubLogger(),
      connectFn,
    });

    const pending = client.connect();
    expect(client.getState()).toBe("connecting");
    clients[0].emit("connect");
    await pending;

    expect(client.isConnected()).toBe(true);
  });

  it("restores tracked subscriptions on every (re)connect", async () => {
    const { connectFn, clients } = fakeConnectFactory();
    const client = new SimulatorMqttClient({
      brokerUrl: "mqtt://localhost:1883",
      clientId: "test",
      baseRetryDelayMs: 1000,
      maxBackoffMs: 30000,
      logger: stubLogger(),
      connectFn,
    });

    // Subscribe before connecting — the topic is remembered.
    await client.subscribe("sensor/reference-water/source-tank");

    const pending = client.connect();
    clients[0].emit("connect");
    await pending;

    expect(clients[0].subscribed).toContain("sensor/reference-water/source-tank");
  });

  it("issues an immediate subscription while connected", async () => {
    const { connectFn, clients } = fakeConnectFactory();
    const client = new SimulatorMqttClient({
      brokerUrl: "mqtt://localhost:1883",
      clientId: "test",
      baseRetryDelayMs: 1000,
      maxBackoffMs: 30000,
      logger: stubLogger(),
      connectFn,
    });

    const pending = client.connect();
    clients[0].emit("connect");
    await pending;

    await client.subscribe("switch/reference-water/transfer-pump/command");
    expect(clients[0].subscribed).toContain("switch/reference-water/transfer-pump/command");
  });

  it("maps MQTT 5 properties and qos onto the publish options", async () => {
    const { connectFn, clients } = fakeConnectFactory();
    const client = new SimulatorMqttClient({
      brokerUrl: "mqtt://localhost:1883",
      clientId: "test",
      baseRetryDelayMs: 1000,
      maxBackoffMs: 30000,
      logger: stubLogger(),
      connectFn,
    });

    const pending = client.connect();
    clients[0].emit("connect");
    await pending;

    const correlationData = Buffer.from("corr-1", "utf8");
    client.publish("aeolus/acks/pump", JSON.stringify({ correlationId: "corr-1", success: true }), {
      qos: 1,
      correlationData,
      responseTopic: "aeolus/acks/pump",
    });

    expect(clients[0].published).toHaveLength(1);
    const sent = clients[0].published[0];
    expect(sent.topic).toBe("aeolus/acks/pump");
    expect(sent.opts.qos).toBe(1);
    const properties = sent.opts.properties as { correlationData?: Buffer; responseTopic?: string };
    expect(properties.correlationData).toEqual(correlationData);
    expect(properties.responseTopic).toBe("aeolus/acks/pump");
  });

  it("throws when publishing while disconnected", () => {
    const { connectFn } = fakeConnectFactory();
    const client = new SimulatorMqttClient({
      brokerUrl: "mqtt://localhost:1883",
      clientId: "test",
      baseRetryDelayMs: 1000,
      maxBackoffMs: 30000,
      logger: stubLogger(),
      connectFn,
    });

    expect(() => client.publish("some/topic", "{}")).toThrow(/not connected/i);
  });

  it("ends the client and reports disconnected on shutdown", async () => {
    const { connectFn, clients } = fakeConnectFactory();
    const client = new SimulatorMqttClient({
      brokerUrl: "mqtt://localhost:1883",
      clientId: "test",
      baseRetryDelayMs: 1000,
      maxBackoffMs: 30000,
      logger: stubLogger(),
      connectFn,
    });

    const pending = client.connect();
    clients[0].emit("connect");
    await pending;

    await client.disconnect();
    expect(clients[0].ended).toBe(true);
    expect(client.getState()).toBe("disconnected");
  });

  it("reconnects with backoff after an unintentional close and restores subscriptions", async () => {
    vi.useFakeTimers();
    const { connectFn, clients, calls } = fakeConnectFactory();
    const client = new SimulatorMqttClient({
      brokerUrl: "mqtt://localhost:1883",
      clientId: "test",
      baseRetryDelayMs: 1000,
      maxBackoffMs: 30000,
      logger: stubLogger(),
      connectFn,
    });

    await client.subscribe("sensor/reference-water/source-tank");

    const pending = client.connect();
    clients[0].emit("connect");
    await pending;
    expect(calls()).toBe(1);

    // Broker drops the connection unexpectedly.
    clients[0].emit("close");
    expect(client.getState()).toBe("waiting_retry");

    // The first backoff is baseRetryDelayMs (1000ms).
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls()).toBe(2);

    clients[1].emit("connect");
    await Promise.resolve();

    expect(client.isConnected()).toBe(true);
    expect(clients[1].subscribed).toContain("sensor/reference-water/source-tank");
  });

  it("does not reconnect after an intentional disconnect", async () => {
    vi.useFakeTimers();
    const { connectFn, clients, calls } = fakeConnectFactory();
    const client = new SimulatorMqttClient({
      brokerUrl: "mqtt://localhost:1883",
      clientId: "test",
      baseRetryDelayMs: 1000,
      maxBackoffMs: 30000,
      logger: stubLogger(),
      connectFn,
    });

    const pending = client.connect();
    clients[0].emit("connect");
    await pending;

    await client.disconnect();
    clients[0].emit("close"); // a close arriving after intentional disconnect

    await vi.advanceTimersByTimeAsync(60000);
    expect(calls()).toBe(1); // no further connection attempts
  });
});
