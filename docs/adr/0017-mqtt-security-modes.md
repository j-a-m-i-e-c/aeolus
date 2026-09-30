# ADR-0017: Three first-class MQTT security modes

* **Status:** Accepted
* **Date:** 2026-09-27

## Context

Aeolus is local-first and is used both as a development environment for custom hardware and as an operational automation platform. Those contexts need different broker trust boundaries.

A single mandatory MQTT policy creates the wrong trade-off somewhere: anonymous MQTT is extremely convenient during hardware bring-up but inappropriate on a shared network; one shared password is easy to provision but cannot revoke one device; individual credentials provide identity and revocation but add provisioning work.

The standard Docker Compose deployment now has the infrastructure needed to change Mosquitto policy safely at runtime: a private mutable config volume, atomic config/password-file writes, a narrowly scoped reload sidecar, backend credentials separate from device credentials, and broker-side verification after changes. How that runtime broker management works — and why it needs no Docker socket — is a separate decision recorded in [ADR-0018](0018-mosquitto-reload-sidecar.md). Open, Shared Password and Per-Device mode transitions, restart persistence and Per-Device revocation have been exercised successfully on a real Raspberry Pi deployment.

## Decision

Aeolus treats **Open**, **Shared Password**, and **Per-Device** as three supported first-class MQTT security modes. None is hidden behind a feature flag.

### Open

Open allows anonymous MQTT connections. It exists for development, device bring-up and trusted/isolated broker networks.

### Shared Password

Shared Password gives external devices one generated site credential while Aeolus itself uses a separate backend credential. It is the low-friction authenticated mode for sites that need to block anonymous clients but do not need individual device revocation.

### Per-Device

Per-Device gives each device its own generated credential. Credentials can be created and revoked independently, so a lost or retired device does not require rotating the entire fleet.

Changing between modes is an administrative action. Aeolus owns the corresponding runtime Mosquitto config/password-file state in the standard Compose deployment and verifies that the broker converges after a change.

Open remains the first-run default for now. Changing an existing installation automatically to Shared Password would break already-deployed anonymous devices without giving the operator a chance to copy credentials first. A future onboarding flow may explicitly recommend or select Shared Password for new installations without changing existing sites implicitly.

## Why three modes instead of one

The modes form a deliberate progression of operational cost and isolation:

| Mode | Device setup | Blocks anonymous clients | Individual revocation |
|---|---:|---:|---:|
| Open | none | no | no |
| Shared Password | one fleet credential | yes | no |
| Per-Device | one credential per device | yes | yes |

Aeolus does not pretend that a Per-Device password is hardware-bound. A copied credential can be reused by another MQTT client. Per-Device means independent broker identity and revocation, not device attestation. Hardware-backed identity or client-certificate authentication would be a separate security mechanism if Aeolus later needs it.

## Alternatives considered

### Shared Password as the only authenticated mode

Simpler UI and implementation, but insufficient when one device must be revoked without touching every other device.

### Per-Device as the only mode

Strongest built-in identity boundary, but unnecessarily cumbersome for experiments, small trusted sites and early device development.

### Remove Open mode

A stronger default posture but a meaningful regression for local hardware bring-up and isolated lab/farm networks. Open remains explicitly scoped rather than being presented as safe on arbitrary networks.

### Feature flags for authenticated modes

Useful during implementation, but wrong after successful field verification. Feature flags made normal security choices look deployment-dependent and required operators to edit environment variables for functionality already supported by the standard stack.

## Consequences

### Positive

* The dashboard accurately reflects the capabilities of the standard installation.
* Operators can move from frictionless bring-up to stronger broker identity without replacing the broker or editing Mosquitto by hand.
* Shared Password and Per-Device changes are applied and verified through one path.
* Per-Device credentials can be revoked independently.
* No Docker socket is required for runtime broker management ([ADR-0018](0018-mosquitto-reload-sidecar.md)).

### Negative / accepted trade-offs

* Open mode can be unsafe on an untrusted broker network.
* Shared Password compromise affects every device using that fleet credential.
* Per-Device provisioning requires securely transferring and retaining a secret per device.
* MQTT username/password credentials are copyable and are not cryptographic hardware identity.
* Custom non-Compose runtimes still need equivalent writable config/password paths and broker reload plumbing before Aeolus can apply security changes.

## Revisit when

Revisit the first-run default when Aeolus has an onboarding flow that can provision credentials before devices connect without surprising existing installations.

Revisit the authentication mechanisms if deployments need broker ACLs, username-to-client-ID binding, mutual TLS/client certificates, hardware-backed keys, or fleet-scale certificate lifecycle management.

## Implementation anchors

* `src/mqtt/mqtt-provisioning-service.ts`
* `src/mqtt/broker-verifier.ts`
* `src/mqtt/mosquitto-config-writer.ts`
* `src/auth/mqtt-credential-service.ts`
* `src/api/routes/provisioning.routes.ts`
* `frontend/src/pages/MqttSecurityPage.tsx`
* `docs/security/mqtt.md`
* `docker-compose.yml`, `mosquitto/reloader.Dockerfile` — the broker runtime plumbing, decided in [ADR-0018](0018-mosquitto-reload-sidecar.md)
