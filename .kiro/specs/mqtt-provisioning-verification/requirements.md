# Requirements Document

## Introduction

The MQTT provisioning framework (spec `mqtt-device-provisioning`) can write Mosquitto config and password files and trigger a broker reload, but it reports success the instant those files are written — it never confirms the broker actually applied the change. Under the default `MQTT_RELOAD_STRATEGY=none`, the reload is delegated to an external sidecar and `reload()` returns `true` unconditionally. This violates the platform's truthfulness principle: a dashboard-managed security transition can be reported as active while the broker is still enforcing the previous policy.

This feature adds a broker-side verification step. After writing files and triggering a reload, the Provisioning_Service probes the live broker with throwaway MQTT connections to confirm the new security policy is actually enforced before reporting success. It also fixes the Compose sidecar so it reliably observes the atomic (rename-based) password-file replacement it is meant to watch. Together these close the gap that keeps managed provisioning gated behind `MQTT_MANAGED_PROVISIONING_ENABLED`.

## Glossary

- **Provisioning_Service**: `MqttProvisioningService` — orchestrates security-level changes, credential lifecycle, file writes and reloads.
- **Broker_Verifier**: New component that opens short-lived MQTT connections to the broker to confirm an expected authentication outcome.
- **Verification_Probe**: A single throwaway connection attempt against the broker with a specific credential (or anonymously), classified as accepted, rejected, or unreachable.
- **Positive_Probe**: A probe that must succeed to confirm a change (e.g. a new credential connects).
- **Negative_Probe**: A probe that must be rejected to confirm a change (e.g. anonymous access is refused, a revoked credential is refused).
- **Verification_Budget**: The maximum total time the Broker_Verifier will poll for the expected outcome before giving up.
- **Reload_Sidecar**: The `aeolus-mosquitto-reloader` Compose service that watches the shared config volume and sends `SIGHUP` to Mosquitto.
- **Applied**: The broker has re-read its config and password file and is enforcing the current security policy.

## Requirements

### Requirement 1: Broker verification primitive

**User Story:** As the platform, I want to probe the broker with a throwaway connection, so that I can observe whether a credential is accepted or rejected without disturbing the backend's live connection.

#### Acceptance Criteria

1. THE Broker_Verifier SHALL open a Verification_Probe using a dedicated short-lived MQTT client that is always closed after the attempt, never the live ingestion client.
2. THE Broker_Verifier SHALL classify each Verification_Probe as `accepted` (CONNACK success), `rejected` (broker refused the credential), or `unreachable` (transport-level failure such as connection refused, DNS failure, or timeout).
3. THE Broker_Verifier SHALL apply a per-attempt connection timeout so a probe cannot hang indefinitely.
4. THE Broker_Verifier SHALL never throw from a probe; a failed attempt SHALL resolve to `rejected` or `unreachable`.

### Requirement 2: Polling within a bounded budget

**User Story:** As the platform, I want to poll the broker until it reflects the requested change, so that asynchronous reload mechanisms (the sidecar) are tolerated without reporting premature success or hanging forever.

#### Acceptance Criteria

1. WHEN verifying an expected outcome, THE Broker_Verifier SHALL retry the Verification_Probe until the expected outcome is observed or the Verification_Budget is exhausted.
2. THE Broker_Verifier SHALL space retries by a configurable poll interval.
3. WHEN the Verification_Budget is exhausted without the expected outcome, THE Broker_Verifier SHALL report verification failure rather than success.
4. THE Verification_Budget and poll interval SHALL be configurable via environment variables with sensible defaults.

### Requirement 3: Verified security-level transitions

**User Story:** As an admin, I want a security-level change to be confirmed against the broker before the dashboard reports it as active, so that the reported state is always truthful.

#### Acceptance Criteria

1. WHEN the Provisioning_Service switches to Open_Mode, THE Provisioning_Service SHALL confirm via a Positive_Probe that anonymous access is accepted before reporting success.
2. WHEN the Provisioning_Service switches to Shared_Password_Mode or Per_Device_Mode, THE Provisioning_Service SHALL confirm via a Negative_Probe that anonymous access is rejected AND via a Positive_Probe that the Backend_Credential is accepted before reporting success.
3. WHEN the Provisioning_Service regenerates the shared password, THE Provisioning_Service SHALL confirm via a Positive_Probe that the new shared credential is accepted before reporting success.
4. IF verification fails within the Verification_Budget, THEN the Provisioning_Service SHALL surface a distinct error indicating the change was written but not confirmed, and SHALL NOT roll back the written files or persisted settings (the broker will apply them on its next start).
5. THE Provisioning_Service SHALL persist the requested Security_Level regardless of verification outcome, so a subsequent broker start or reload converges to the intended state.

### Requirement 4: Verified credential lifecycle

**User Story:** As an admin, I want per-device credential creation and revocation confirmed against the broker, so that I know a new device can connect and a revoked device genuinely cannot.

#### Acceptance Criteria

1. WHEN the Provisioning_Service creates a device credential, THE Provisioning_Service SHALL confirm via a Positive_Probe that the new credential is accepted before reporting success.
2. WHEN the Provisioning_Service revokes a device credential, THE Provisioning_Service SHALL confirm via a Negative_Probe that the revoked credential is rejected before reporting success.
3. WHEN confirming a revocation, THE Provisioning_Service SHALL additionally confirm via a Positive_Probe that the Backend_Credential is still accepted, so that broker-unreachable is not mistaken for successful revocation.
4. IF a credential-lifecycle verification fails within the Verification_Budget, THEN the Provisioning_Service SHALL surface the same distinct not-confirmed error without rolling back the credential store.

### Requirement 5: Reload sidecar reliability

**User Story:** As an operator, I want the reload sidecar to reliably notice the atomic password-file replacement, so that verified transitions actually converge in the recommended Compose deployment.

#### Acceptance Criteria

1. THE Reload_Sidecar SHALL watch the shared config directory for file move/replace events, not a single fixed file path, so that atomic temp-file-plus-rename writes are observed.
2. WHEN the password file is atomically replaced, THE Reload_Sidecar SHALL send `SIGHUP` to the broker.
3. THE Reload_Sidecar SHALL continue watching after each event, re-arming for subsequent replacements.

### Requirement 6: Configuration and safety

**User Story:** As an operator, I want verification to be configurable and safe, so that it fits deployments where the backend cannot reach the broker for a probe.

#### Acceptance Criteria

1. THE verification behaviour SHALL be governed only when `MQTT_MANAGED_PROVISIONING_ENABLED` is true; when managed provisioning is disabled, no verification is performed.
2. THE Verification_Budget, poll interval, and per-attempt timeout SHALL each be configurable via environment variables.
3. THE Broker_Verifier SHALL derive the broker URL from the existing MQTT broker configuration, requiring no separate endpoint config.
4. A Verification_Probe SHALL NOT publish, subscribe, or otherwise mutate broker state; it connects and immediately disconnects.
