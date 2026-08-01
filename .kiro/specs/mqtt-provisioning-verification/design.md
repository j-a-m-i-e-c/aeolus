# Design Document

## Overview

We add a `BrokerVerifier` that opens short-lived MQTT connections to the broker and classifies the outcome, plus a bounded polling helper. `MqttProvisioningService` calls the verifier after each write-and-reload so it only reports success once the broker demonstrably enforces the new policy. We also fix the Compose reload sidecar to watch the config *directory* for move events so atomic renames are seen.

The verifier is intentionally connection-based rather than reload-mechanism-based: it works identically whether the reload arrives via the `none` sidecar path, a `signal`, or a `command`, because it observes the broker's actual behaviour rather than trusting that a reload was dispatched.

## Architecture

```
setSecurityLevel / regenerate / create / revoke
        │  (write files)
        ▼
   reloader.reload()          ── dispatches reload (or no-op under "none")
        │
        ▼
   BrokerVerifier.waitFor(...) ── polls throwaway connections until the
        │                          expected outcome or budget exhausted
        ▼
   persist settings + return status   (or throw BrokerNotConfirmedError)
```

### New component: `src/mqtt/broker-verifier.ts`

```ts
export type ProbeOutcome = "accepted" | "rejected" | "unreachable";

export interface BrokerVerifierOptions {
  brokerUrl: string;
  connectTimeoutMs?: number;  // per attempt (default 3000)
  budgetMs?: number;          // total polling budget (default 12000)
  pollIntervalMs?: number;    // gap between attempts (default 500)
}

export class BrokerVerifier {
  constructor(options: BrokerVerifierOptions);

  /** One throwaway connection. Never throws. */
  probe(credentials: { username?: string; password?: string } | null): Promise<ProbeOutcome>;

  /** Poll until probe(credentials) === "accepted", else false at budget. */
  waitForAccepted(credentials): Promise<boolean>;

  /** Poll until probe(credentials) === "rejected", else false at budget. */
  waitForRejected(credentials): Promise<boolean>;
}
```

**Probe classification.** A dedicated `mqtt.connect` client with `reconnectPeriod: 0` and `connectTimeout` set:
- `connect` event → `accepted`.
- `error` event: if `err.code` is a known transport code (`ECONNREFUSED`, `ENOTFOUND`, `ETIMEDOUT`, `EAI_AGAIN`, `ECONNRESET`) → `unreachable`; otherwise (broker-level CONNACK refusal / bad auth) → `rejected`.
- `close` before any `connect`/`error` → `unreachable`.
- Overall timeout guard → `unreachable`.
In all cases the client is force-closed (`client.end(true)`) exactly once before resolving.

**Polling.** `waitForAccepted`/`waitForRejected` loop: probe, check outcome, and if not matched sleep `pollIntervalMs` and retry until `Date.now()` exceeds the start + `budgetMs`. `unreachable` is treated as "not yet" for both (a not-yet-reloaded or briefly-restarting broker looks unreachable), so the loop keeps trying within budget.

### New error: `BrokerNotConfirmedError`

A dedicated error (mapped to HTTP 503) meaning "the change was written and a reload was triggered, but the broker did not confirm it within the budget; it will apply on the broker's next reload/restart." Placed alongside the existing API error classes so the error handler renders it consistently. It carries the operation name for diagnostics.

### Wiring into `MqttProvisioningService`

The service gains an optional injected `BrokerVerifier` (constructor dependency, defaulting to one built from `config.mqttBrokerUrl`). Verification runs only when managed provisioning is enabled — the service already receives that flag via composition; we pass a `verificationEnabled` boolean so unit tests and the disabled deployment skip probing.

Per operation, after `reload()` and the existing backend reconnect:

| Operation | Probe(s) |
|---|---|
| `setOpenMode` | Positive: anonymous accepted |
| `setSharedPasswordMode` | Negative: anonymous rejected; Positive: backend credential accepted |
| `setPerDeviceMode` | Negative: anonymous rejected; Positive: backend credential accepted |
| `regenerateSharedPassword` | Positive: new shared credential accepted |
| `createDeviceCredential` | Positive: new device credential accepted |
| `revokeDeviceCredential` | Negative: revoked credential rejected; Positive: backend credential accepted |

If any required probe fails within budget, the method throws `BrokerNotConfirmedError` **after** persisting settings/credentials and writing files (Req 3.5, 4.4). Ordering per operation becomes: write files → reload → (reconnect backend where already done) → persist DB → verify → return or throw. Persisting before verifying guarantees convergence on the next broker start even when the live confirmation is delayed.

Note on credential create/revoke: these currently delegate to the credential service (`createCredential`/`deleteCredential`) which regenerates the password file and fires a fire-and-forget reload internally. The provisioning-service wrapper will, after that delegation, run the appropriate probe using the returned/known credential. The device password needed for a positive create-probe is available from `createCredential`'s return value; for revoke we probe with the just-revoked username using any password (a rejected outcome is expected regardless of password because the username is gone).

### Config additions (`src/config.ts`)

```ts
mqttProvisioningVerify: {
  budgetMs: number;        // MQTT_PROVISIONING_VERIFY_BUDGET_MS   default 12000
  pollIntervalMs: number;  // MQTT_PROVISIONING_VERIFY_POLL_MS     default 500
  connectTimeoutMs: number;// MQTT_PROVISIONING_VERIFY_TIMEOUT_MS  default 3000
}
```

No separate endpoint: the verifier uses `config.mqttBrokerUrl`.

### Sidecar fix (`docker-compose.yml`)

Current command watches a single file:
```
while inotifywait -e close_write -e moved_to /watch/password_file; do kill -HUP 1; done
```
An atomic temp-file-plus-rename replaces the file's inode, so `close_write` on the final path never fires and `moved_to` is a directory event — the watch effectively misses managed writes. Fix: watch the **directory** for the rename target and re-arm each iteration:
```
while inotifywait -e close_write -e moved_to -e create /watch; do
  echo "reloader: config dir changed, SIGHUP mosquitto"
  kill -HUP 1
done
```
The directory holds only `mosquitto.conf` and `password_file`, so reloading on any change there is correct and simpler than filtering. The initial "wait for password_file to appear" guard is retained.

## Error handling

- Probes never throw; they resolve to an outcome.
- Verification failure throws `BrokerNotConfirmedError` (503). The write/persist has already happened, so state is not lost.
- When managed provisioning is disabled, verification is skipped entirely, preserving current behaviour.

## Testing strategy

- **Unit — BrokerVerifier**: mock the `mqtt` module (as existing MqttService tests do) to emit `connect`/`error`/`close` and assert `probe` classification and that the client is always ended. Assert `waitForAccepted`/`waitForRejected` poll within budget, succeed when the outcome flips mid-poll, and fail at budget exhaustion. Use small budgets/intervals for fast tests.
- **Unit — MqttProvisioningService**: inject a fake verifier; assert the correct probes are requested per operation, that success returns status, and that a failing probe throws `BrokerNotConfirmedError` while files/settings were still written.
- **Integration (real broker, Docker-gated)**: extend the existing `mqtt-broker-provisioning.integration.test.ts` to drive the real `BrokerVerifier` against the throwaway `eclipse-mosquitto:2` container — confirming accepted/rejected classification end to end. Remains auto-skipped without Docker.
- No new e2e; the feature is backend + broker only.

## Rollout

Verification lands enabled-by-default *within* managed provisioning, but managed provisioning itself stays gated behind `MQTT_MANAGED_PROVISIONING_ENABLED`. Once verified in a real deployment, ungating is a separate follow-up decision; the backlog item is satisfied when the backend can prove application against the broker.
