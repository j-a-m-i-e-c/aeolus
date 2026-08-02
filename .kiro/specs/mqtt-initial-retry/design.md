# Design: MQTT Initial-Connection Retry

## Overview

The reconnection machinery already exists and is correct; it is simply never
started when the *first* connection attempt fails. The fix adds one
startup-oriented method to `MqttService` that reuses the existing
`attemptConnection()` and `startReconnectionLoop()` primitives, and points the
composition root at it. A Mosquitto healthcheck is added to Compose for
observability.

## Components and Interfaces

### `MqttService.connectWithRetry()`

A new public method used by startup. It mirrors `connect()` (resets
`intentionalDisconnect`/`reconnectAttempt`, attempts one connection) but, on
failure, enters the reconnection loop instead of propagating the error:

```ts
/**
 * Startup connect that never leaves the broker permanently down. Attempts one
 * connection; on success the disconnect handler owns future reconnection, on
 * failure it enters the same exponential-backoff Reconnection_Loop in the
 * background (indefinite retries) and resolves, so application startup is never
 * blocked by an unavailable broker (e.g. a boot race where the backend starts
 * before Mosquitto is ready).
 */
async connectWithRetry(): Promise<void> {
  this.intentionalDisconnect = false;
  this.reconnectAttempt = 0;
  try {
    await this.attemptConnection();
  } catch (err) {
    logger.warn(
      { error: (err as Error).message, broker: redactBrokerUrl(this.config.brokerUrl) },
      "Initial MQTT connection failed — scheduling background reconnection",
    );
    this.startReconnectionLoop();
  }
}
```

- On the first failure, `reconnectAttempt` is 0; `startReconnectionLoop()`
  increments it to 1 and schedules the first retry at `baseRetryDelayMs`, then
  reschedules with exponential backoff on each subsequent failure — identical to
  the mid-session disconnect path (R1.1).
- It resolves rather than rejects, so the startup caller is never blocked or
  aborted (R1.2).
- A retry that succeeds runs `attemptConnection()`'s `onConnect`, which
  subscribes and wires the disconnect handler (R1.3).
- `connect()` is left unchanged, so credentialed reconnection flows
  (`reconnectWithCredentials`) keep their throw-on-failure contract (out of
  scope note).
- `disconnect()` already clears `reconnectTimer` and sets
  `intentionalDisconnect`, so it cancels a pending initial-failure retry (R1.5);
  `startReconnectionLoop()` already returns early when `intentionalDisconnect`.

### Composition root (`src/index.ts`)

The startup block becomes non-blocking and no longer treats a broker outage as a
handled-fatal condition:

```ts
// 8. Connect MQTT — never blocks startup. If the broker is unavailable at boot,
// the service enters a background reconnection loop instead of staying down.
await mqttService.connectWithRetry();
```

`connectWithRetry()` does not reject for connection failures, so the previous
`try/catch … "running without MQTT"` is no longer needed; the service logs the
initial failure and the scheduled retry itself.

### Compose healthcheck (`docker-compose.yml`)

Add a healthcheck to the `mosquitto` service reflecting reachability in the
default anonymous configuration, using the broker's own client shipped in the
image:

```yaml
mosquitto:
  # ...
  healthcheck:
    test: ["CMD-SHELL", "mosquitto_sub -p 1883 -t '$$SYS/broker/uptime' -C 1 -W 3 || exit 1"]
    interval: 30s
    timeout: 5s
    start_period: 5s
    retries: 3
```

The backend's `depends_on.mosquitto.condition` **stays** `service_started`
(not `service_healthy`): the code-level retry already guarantees recovery, and a
strict health gate would wrongly block startup when managed provisioning has
switched the broker to `allow_anonymous false` (the anonymous `$SYS` probe would
fail auth even though the broker is healthy). The healthcheck is therefore
observability, not a startup gate.

## Design Decisions

1. **New method, not a changed `connect()`.** `connect()`'s throw-on-failure
   contract is relied on by `reconnectWithCredentials`; adding a separate
   startup method avoids changing that behavior while fixing the startup path.
2. **Reuse the existing loop.** No new backoff/timer logic — the fix is purely
   "start the loop that already exists on the path that forgot to."
3. **Don't gate startup on broker health.** The retry makes gating unnecessary
   and a health gate is incorrect under the secured provisioning mode; the
   healthcheck is kept for visibility only.

## Testing Strategy

Unit tests in `src/mqtt/mqtt-service.test.ts` (fake timers, mocked `mqtt`):

- `connectWithRetry()` resolves (does not throw) when the initial connection
  emits `error`, and enters `waiting_retry`.
- After the initial failure, advancing the timer by `baseRetryDelayMs` triggers a
  second `mqtt.connect`; emitting `connect` on the new client transitions to
  `connected` and subscribes to the configured topics (proves the retry path
  fully connects).
- `connectWithRetry()` on a successful initial connection behaves like
  `connect()` (connected, subscribed, no extra reconnect scheduled).
- `disconnect()` after an initial failure cancels the pending retry (no further
  `mqtt.connect` after advancing timers).

Compose is validated by inspection (no runtime test harness for Compose in this
repo).
