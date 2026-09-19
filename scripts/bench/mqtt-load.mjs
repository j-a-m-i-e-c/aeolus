#!/usr/bin/env node
import mqtt from "mqtt";
import { monitorEventLoopDelay } from "node:perf_hooks";

const args = process.argv.slice(2);
const named = new Map();
const positional = [];
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg.startsWith("--")) {
    const value = args[i + 1];
    if (value === undefined || value.startsWith("--")) {
      console.error(`missing value for ${arg}`);
      process.exit(2);
    }
    named.set(arg.slice(2), value);
    i += 1;
  } else {
    positional.push(arg);
  }
}

function option(name, fallback, positionalIndex) {
  return named.get(name) ?? positional[positionalIndex] ?? fallback;
}

const devices = Number(process.env.DEVICES || option("devices", 100, 0));
const hz = Number(process.env.HZ || option("hz", 1, 1));
const seconds = Number(process.env.SECONDS || option("seconds", 60, 2));
const broker = process.env.MQTT_BROKER_URL || option("broker", "mqtt://127.0.0.1:1883", 3);
const username = process.env.MQTT_USERNAME;
const password = process.env.MQTT_PASSWORD;

if (!Number.isInteger(devices) || devices < 1 || !Number.isFinite(hz) || hz <= 0 || !Number.isFinite(seconds) || seconds <= 0) {
  console.error("usage: mqtt-load.mjs [--devices 100] [--hz 1] [--seconds 60] [--broker mqtt://127.0.0.1:1883]");
  process.exit(2);
}

const client = mqtt.connect(broker, { username, password, protocolVersion: 5 });
const loop = monitorEventLoopDelay({ resolution: 20 });
let published = 0;
let failed = 0;
const started = Date.now();

await new Promise((resolve, reject) => {
  client.once("connect", resolve);
  client.once("error", reject);
});
loop.enable();

const intervalMs = Math.max(1, Math.round(1000 / hz));
const timer = setInterval(() => {
  const ts = Date.now();
  for (let i = 0; i < devices; i++) {
    const topic = `bench/devices/sensor-${String(i).padStart(4, "0")}/state`;
    const payload = JSON.stringify({ value: (i + ts / 1000) % 100, online: true, timestamp: ts });
    client.publish(topic, payload, { qos: 0 }, (err) => {
      if (err) failed += 1;
    });
    published += 1;
  }
}, intervalMs);

await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
clearInterval(timer);
await new Promise((resolve) => client.end(false, {}, resolve));
loop.disable();

const elapsed = (Date.now() - started) / 1000;
const memory = process.memoryUsage();
console.log(JSON.stringify({
  devices,
  targetHz: hz,
  seconds: elapsed,
  published,
  failed,
  messagesPerSecond: Math.round(published / elapsed),
  processRssMb: Math.round(memory.rss / 1024 / 1024),
  eventLoopMs: {
    mean: Number((loop.mean / 1e6).toFixed(2)),
    p95: Number((loop.percentile(95) / 1e6).toFixed(2)),
    p99: Number((loop.percentile(99) / 1e6).toFixed(2)),
    max: Number((loop.max / 1e6).toFixed(2)),
  },
}, null, 2));
