# ADR-0001: Local-first, single-site deployment model

- **Status:** Accepted
- **Date:** 2026-08-28

## Context

Aeolus controls and observes physical equipment. Its target environments include homes, farms, workshops, research sites and other small installations where the local network may remain available while the internet is slow or unavailable.

A cloud control plane would make basic automation depend on a remote service and would add fleet, tenancy and account infrastructure that the project does not currently need.

## Decision

Aeolus is a **self-hosted, local-first, single-site platform**. Core device ingestion, automation execution, command dispatch, storage, authentication and dashboard operation run locally. Internet connectivity is optional for integrations that themselves require it and for optional remote ingress such as the public demo's Cloudflare Tunnel.

Aeolus is not currently a multi-tenant SaaS control plane or fleet manager.

## Why this fits Aeolus

Physical automation should continue when the WAN does not. Keeping the decision loop local also gives predictable latency, keeps site data on the site by default, and makes a Raspberry Pi or similar host a viable deployment target.

The single-site assumption lets the project spend complexity on device truthfulness, automation and operator UX rather than distributed tenancy and fleet coordination.

## Alternatives considered

### Cloud-first SaaS

A hosted control plane simplifies central fleet management and remote access, but introduces internet dependency into the primary automation path and requires substantially more tenancy, billing, regional availability and cloud-operations work.

### Mandatory hybrid cloud control plane

A local agent with a required cloud coordinator preserves some local execution, but still creates a distributed consistency problem and a hard service dependency for administration. Aeolus can add optional fleet coordination later without making it a prerequisite now.

## Consequences

### Positive

- Automations and local integrations can operate without internet connectivity.
- Site data and credentials stay local by default.
- Deployment can remain small enough for edge hardware.
- The operating model matches the project's rural and physical-infrastructure use cases.

### Negative / accepted trade-offs

- The operator owns the host, backups, LAN security and upgrades.
- Multi-site fleet management is outside the current product boundary.
- Remote access must be added deliberately rather than being inherent to the architecture.
- Horizontal scaling is not a design goal for one site.

## Revisit when

Reconsider if Aeolus becomes a managed multi-site product, if organisations need central policy/fleet operations, or if cross-site automation becomes a first-class requirement.

## Implementation anchors

- `docker-compose.yml`
- `src/index.ts`
- `docs/WHY_AEOLUS.md`
- `docs/reference/architecture.md`
