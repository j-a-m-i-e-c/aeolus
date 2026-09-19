# ADR-0015: First run trust and MQTT security model

* **Status:** Accepted
* **Date:** 2026-09-20

## Context

Aeolus is a self hosted edge automation platform aimed at developers and technically capable operators. It is expected to run on infrastructure the operator controls, commonly a Raspberry Pi or similar host on a home, workshop, farm, laboratory or other site network.

Aeolus is not limited to trusted networks. The normal application security model includes authenticated dashboard and API access, authorization, authenticated WebSocket connections, isolated automation Logic, sandboxed custom UI, and configurable MQTT authentication. Those controls are intended to remain meaningful when other hosts or users on the surrounding network are not fully trusted.

Two narrower questions arise during first use:

1. Before the first administrator exists, any client that can reach an unconfigured Aeolus HTTP service can attempt the first administrator setup.
2. The bundled MQTT broker can run in Open mode, which permits anonymous MQTT clients on networks that can reach the broker.

Aeolus could add a separate one time bootstrap secret for first administrator creation and could force MQTT credential provisioning before the platform becomes usable. Those measures would reduce exposure during first setup and when using Open MQTT, but they would also add ceremony and device provisioning work to the common development path.

The project needs an explicit trust model so these behaviours are deliberate architectural choices without implying that all Aeolus deployments require a trusted network.

## Decision

The trusted network assumption is **narrowly scoped**.

Aeolus assumes that **first administrator creation** happens while the unconfigured HTTP service is reachable only by the operator or by a trusted or appropriately segmented local network. Aeolus will not require a separate bootstrap or setup token at this stage. Operators must not expose an unconfigured instance to untrusted peers or the public internet before the first administrator exists.

After initial setup, Aeolus does **not** require the surrounding network to be trusted. Normal application authentication, authorization, WebSocket authentication, sandbox boundaries and other security controls remain part of the deployment boundary.

Open MQTT remains a supported mode for development and trusted or isolated local networks. It is intentionally not the mode to use when arbitrary clients can reach the broker. For shared or less trusted networks, operators should use Shared Password or Per Device MQTT authentication. When MQTT crosses an untrusted link, use TLS or an appropriately private transport as documented by the deployment environment.

The MQTT broker should not be exposed directly to the public internet. Internet reachable Aeolus deployments should expose only the intended application ingress and should retain the normal authentication and transport protections for that environment.

The project may later change the default MQTT mode to Shared Password if that can be done without making custom device onboarding disproportionately complex. That is a separate product default decision and is not required by this ADR.

## Why this fits Aeolus

Aeolus is not currently a consumer appliance designed for unattended installation on an adversarial network. Its users are expected to understand the host and deployment environment they operate, just as they are responsible for host patching, backups and physical safety controls.

A bootstrap secret would mainly protect the short interval before first administrator creation from another actor who can already reach the unconfigured service. Requiring operators to retrieve a one time value from Docker logs or the host console on every fresh installation adds friction to the primary setup path for a comparatively narrow threat.

The MQTT decision is different from a blanket trusted network assumption. Anonymous local MQTT is useful when developing custom hardware, experimenting with ESP32 devices, or operating on an isolated site network. Aeolus also provides authenticated MQTT modes specifically so deployments do not have to trust every client that can reach the broker.

The resulting boundary is explicit:

* first administrator creation assumes temporary control of the unconfigured endpoint;
* Open MQTT assumes a trusted or isolated broker network;
* authenticated application access and authenticated MQTT modes are available for deployments where surrounding clients are not trusted.

## Alternatives considered

### One time first administrator bootstrap code

Generate a random setup code when no administrator exists, keep it in memory, expose it only through the local console or container logs, and require it alongside the first administrator credentials.

This would protect first setup from another client that can reach Aeolus but cannot access the host. It was not selected because it complicates the most common installation path and addresses a short lived first setup condition rather than the normal post setup security model.

### Mandatory Shared Password MQTT on first run

Generate or request a shared broker credential before external MQTT devices can connect.

This gives a stronger default broker boundary, but it also means every development device must be provisioned with credentials before the operator can experiment with Aeolus. Shared Password remains available and may become the default later if onboarding can stay simple.

### Mandatory Per Device MQTT credentials

Require individually provisioned credentials for every MQTT device.

This provides stronger identity and revocation properties, but imposes the highest provisioning cost. It remains appropriate for deployments that need that level of isolation, not as a mandatory baseline for every Aeolus installation.

## Consequences

### Positive

* Fresh installations remain quick to bring up and understand.
* Custom MQTT hardware can be developed with minimal provisioning overhead on trusted or isolated networks.
* Aeolus remains deployable on shared or less trusted networks when the appropriate application and MQTT security controls are enabled.
* Security findings can distinguish first setup and Open MQTT assumptions from the normal authenticated runtime model.
* Operators retain Shared Password and Per Device MQTT modes when the broker needs stronger access control.
* The project can focus security effort on meaningful boundaries such as authentication, authorization, sandbox escape, unauthorized command execution and accidental public exposure.

### Negative / accepted trade offs

* A hostile peer that can reach a brand new, unconfigured Aeolus instance may be able to claim the first administrator account before the intended operator.
* Open MQTT permits any client that can reach the broker to connect unless the operator selects a stronger mode or isolates the broker network.
* Operators must choose a deployment and MQTT security mode appropriate to who can reach those services.
* An unconfigured installation and an Open MQTT broker are not suitable for direct public internet exposure.

## Revisit when

Reconsider the first administrator decision if Aeolus targets nontechnical consumer installation, ships as a plug and play appliance, gains automatic internet exposure during setup, or if a low friction bootstrap flow can materially improve security without harming the developer experience.

Reconsider the MQTT default independently if Shared Password can become the shipped default while preserving straightforward onboarding for custom hardware.

## Implementation anchors

* `src/auth/`
* `src/api/routes/auth.routes.ts`
* `mosquitto/mosquitto.conf`
* `docs/how-to/first-run-setup.md`
* `docs/security/authentication.md`
* `docs/security/mqtt.md`
* `SECURITY.md`
