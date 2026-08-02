# Requirements Document

## Introduction

Aeolus connects to an MQTT broker at startup. `MqttService.connect()` calls
`attemptConnection()` exactly once. The indefinite exponential-backoff
reconnection loop (`startReconnectionLoop`) is only ever started from the
established client's `close` handler — which is wired **after** a successful
connection. Therefore, if the **first** connection attempt fails, `connect()`
rejects, `src/index.ts` catches it and logs "running without MQTT", and **no
retry is ever scheduled**. The backend stays MQTT-disconnected until someone
manually restarts it.

This happens in a normal boot race: under Docker Compose the backend only waits
for the broker's `service_started` (not readiness), and an external broker can
simply be briefly unavailable at boot. The result is a healthy-looking Aeolus
that silently never processes MQTT — a serious reliability gap for an IoT
platform whose primary transport is MQTT.

This feature makes an initial connection failure enter the **same** backoff
reconnection loop that a mid-session disconnect already uses, without blocking
application startup, so the backend recovers automatically once the broker
becomes reachable. It also adds a broker healthcheck to the default Compose
stack for operational visibility.

**Threat model / scope note:** This is a reliability fix, not a security change.
The existing reconnection loop, backoff math, credentials handling, and
intentional-disconnect semantics are unchanged; only the *initial-failure* path
is corrected and a Compose healthcheck is added.

**In scope:**
- Starting the existing reconnection loop when the initial connection attempt
  fails, in the background, without blocking startup.
- Using that behavior from the composition root's MQTT startup.
- A Mosquitto healthcheck in `docker-compose.yml` for observability.

**Out of scope:**
- Changing `connect()`'s existing throw-on-failure contract (used by
  credentialed reconnection flows).
- Gating backend startup on broker health (the retry makes this unnecessary and
  a strict gate would break the secured/anonymous-disabled provisioning mode).
- Any change to backoff timing, credentials, or the mid-session reconnect path.

## Glossary

- **MqttService**: The backend service managing the broker connection
  (`src/mqtt/mqtt-service.ts`).
- **Initial_Connection**: The first connection attempt performed at application
  startup.
- **Reconnection_Loop**: The existing indefinite exponential-backoff retry loop
  (`startReconnectionLoop`) that reschedules connection attempts.
- **Intentional_Disconnect**: A caller-requested `disconnect()`, which must
  suppress any further reconnection.

## Requirements

### Requirement 1: Initial connection failure enters the reconnection loop

**User Story:** As an operator, I want the backend to keep retrying the MQTT
broker after a failed initial connection, so that a broker that is briefly
unavailable at boot does not leave Aeolus permanently disconnected.

#### Acceptance Criteria

1. WHEN the Initial_Connection attempt fails, THE MqttService SHALL start the
   Reconnection_Loop with exponential backoff instead of leaving the connection
   permanently down.
2. WHEN the Initial_Connection attempt fails, THE MqttService SHALL NOT reject or
   throw to the caller of the startup connect path, so application startup is not
   aborted or blocked.
3. WHEN a subsequent Reconnection_Loop attempt succeeds, THE MqttService SHALL
   subscribe to its configured topics and wire the disconnect handler exactly as
   a first-time successful connection does.
4. WHEN the Initial_Connection attempt succeeds, THE MqttService SHALL behave
   exactly as before (connected state, subscriptions, disconnect handler) with no
   reconnection loop started.
5. IF `disconnect()` is called after an initial failure, THEN THE MqttService
   SHALL cancel any pending reconnection and SHALL NOT schedule further attempts.

### Requirement 2: Startup uses the non-blocking connect path

**User Story:** As a developer, I want the composition root to use the
non-blocking startup connect, so that the server finishes booting and serves
HTTP even when the broker is down.

#### Acceptance Criteria

1. THE composition root (`src/index.ts`) SHALL initiate the MQTT connection
   through the non-blocking startup path such that a broker outage at boot does
   not prevent the HTTP server from starting.
2. WHEN the broker is unreachable at startup, THE backend SHALL continue to a
   fully started HTTP server and SHALL reflect a disconnected/retrying MQTT state
   rather than a fatal error.

### Requirement 3: Broker healthcheck in the default Compose stack

**User Story:** As an operator, I want the Mosquitto container to report a
healthcheck, so that broker readiness is visible in the default deployment.

#### Acceptance Criteria

1. THE default `docker-compose.yml` SHALL define a healthcheck on the Mosquitto
   service that reflects broker reachability in the default (anonymous-enabled)
   configuration.
2. THE backend service dependency on Mosquitto SHALL remain non-blocking on
   broker health, so that the backend still starts (and relies on the
   Reconnection_Loop) even if the broker is not yet healthy or is running in a
   secured mode where an anonymous healthcheck would not pass.
