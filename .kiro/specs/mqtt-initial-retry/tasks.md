# Implementation Plan: MQTT Initial-Connection Retry

## Overview

Start the existing reconnection loop when the initial connection fails, use it
from the composition root without blocking startup, and add a Mosquitto
healthcheck to Compose. No new backoff logic; reuses `attemptConnection()` and
`startReconnectionLoop()`.

Test sub-tasks are marked optional with `*`.

## Tasks

- [ ] 1. Add `connectWithRetry()` to `MqttService`
  - [ ] 1.1 Update `src/mqtt/mqtt-service.ts`
    - Add `async connectWithRetry(): Promise<void>` that resets
      `intentionalDisconnect`/`reconnectAttempt`, awaits `attemptConnection()`,
      and on failure logs a warning (redacted broker) and calls
      `startReconnectionLoop()` instead of rethrowing
    - Leave `connect()` unchanged
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
  - [ ]* 1.2 Unit-test `connectWithRetry()`
    - Initial `error` → resolves (no throw), state `waiting_retry`; advancing the
      timer by `baseRetryDelayMs` calls `mqtt.connect` again and a subsequent
      `connect` event reaches `connected` + subscribes
    - Initial success → `connected`, subscribed, no reconnect scheduled
    - `disconnect()` after initial failure cancels the pending retry
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [ ] 2. Use the non-blocking startup path
  - [ ] 2.1 Update `src/index.ts`
    - Replace the `try { await mqttService.connect() } catch …` block with
      `await mqttService.connectWithRetry();` and a short comment
    - _Requirements: 2.1, 2.2_

- [ ] 3. Add a Mosquitto healthcheck to Compose
  - [ ] 3.1 Update `docker-compose.yml`
    - Add a `healthcheck` to the `mosquitto` service using
      `mosquitto_sub` against `$SYS/broker/uptime` (anonymous, short timeout)
    - Keep the backend `depends_on.mosquitto.condition` as `service_started`
      (not `service_healthy`), documented inline
    - _Requirements: 3.1, 3.2_

- [ ] 4. Verify and document
  - [ ] 4.1 Run `tsc --noEmit` and the full backend suite; fix regressions
  - [ ] 4.2 Update `docs/BACKLOG.md` release-gate item 9 to DONE

## Notes

- Tasks marked `*` are optional test sub-tasks; core implementation is never optional.
- No change to backoff timing, credentials, or the mid-session reconnect path.
- The healthcheck is observability only; correctness comes from the code retry.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "3.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["4.1", "4.2"] }
  ]
}
```
