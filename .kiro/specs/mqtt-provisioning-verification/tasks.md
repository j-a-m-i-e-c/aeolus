# Implementation Plan

- [x] 1. Add `BrokerVerifier` with probe + bounded polling
  - Create `src/mqtt/broker-verifier.ts` with `probe`, `waitForAccepted`, `waitForRejected`.
  - Classify outcomes accepted/rejected/unreachable; never throw; always close the client.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4_

- [x] 2. Add `BrokerNotConfirmedError` (HTTP 503) and unit-test verifier
  - Add the error class beside the existing API error classes; ensure the error handler renders it.
  - Unit test `BrokerVerifier` with a mocked `mqtt` module: classification, always-closed client, poll-until-flip, budget-exhaustion failure.
  - _Requirements: 1.2, 1.4, 2.3, 3.4_

- [x] 3. Add verification config
  - Add `mqttProvisioningVerify` (budgetMs, pollIntervalMs, connectTimeoutMs) to `config.ts` with env vars and defaults; cover in `config.test.ts`.
  - _Requirements: 2.4, 6.2, 6.3_

- [x] 4. Wire verification into security-level transitions
  - Inject `BrokerVerifier` + `verificationEnabled` into `MqttProvisioningService`.
  - Open → anonymous-accepted; Shared/Per-Device → anonymous-rejected + backend-accepted; persist before verify; throw `BrokerNotConfirmedError` on failure.
  - _Requirements: 3.1, 3.2, 3.4, 3.5, 6.1_

- [x] 5. Wire verification into regenerate + credential lifecycle
  - regenerate → new shared credential accepted.
  - createDeviceCredential → new credential accepted; revokeDeviceCredential → revoked rejected + backend still accepted.
  - _Requirements: 3.3, 4.1, 4.2, 4.3, 4.4_

- [x] 6. Unit-test provisioning verification paths
  - Inject a fake verifier; assert per-operation probes, success returns status, failure throws while writes/persists still occurred.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 4.4_

- [x] 7. Fix the reload sidecar to watch the directory
  - Update `docker-compose.yml` reloader command to watch `/watch` for move/create/close_write and re-arm.
  - _Requirements: 5.1, 5.2, 5.3_

- [x] 8. Extend the real-broker integration test
  - Drive the real `BrokerVerifier` against the Docker `eclipse-mosquitto:2` broker for accepted/rejected classification; keep Docker-gated skip.
  - _Requirements: 1.2, 3.2, 4.2_

- [x] 9. Docs + `.env.example`
  - Document the verification env vars and behaviour in `docs/security/mqtt.md` and `.env.example`; note the sidecar fix.
  - _Requirements: 6.1, 6.2_
