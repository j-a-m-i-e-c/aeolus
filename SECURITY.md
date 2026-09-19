# Security policy

## Supported versions

Aeolus is still early software. Security fixes are made on the latest release and on `main`. Older snapshots should not be assumed to receive fixes.

## Reporting a vulnerability

Please do not open a public issue for a vulnerability that could expose credentials, bypass authentication, escape an automation or UI sandbox, publish unauthorized device commands, or compromise a host running Aeolus.

Use GitHub's private vulnerability reporting for the repository when it is available. Include the affected version or commit, the deployment shape, reproduction steps, impact, and any logs that can be shared safely.

## Security boundaries

Aeolus treats these as important boundaries:

* dashboard and API authentication
* resource and tab authorization
* WebSocket authentication and event filtering
* backend automation isolation
* custom UI iframe isolation and broker mediated RPC
* outbound network controls for user written logic
* MQTT credentials and command provenance
* the host and container boundary

Aeolus is not certified safety software. Do not use it as the sole safety control for equipment that can injure people, damage property, or create an environmental hazard.

## Deployment

Keep Aeolus and its MQTT broker on a trusted or segmented network, keep the host patched, use HTTPS for remotely accessible deployments, protect backups and credentials, and review release notes before upgrading.
