# ADR-0008: Modular monolith with a small number of explicit process boundaries

- **Status:** Accepted
- **Date:** 2026-08-28

## Context

Aeolus contains many domains — authentication, devices, MQTT, connectors, automations, commands, storage, REST/WebSocket and observability — but normally runs on one edge host for one site.

Splitting every domain into a network service would add deployment, discovery, authentication, tracing and failure modes that are disproportionate to the expected scale.

Some boundaries are nevertheless valuable because they represent genuinely different trust/runtime concerns: the MQTT broker, browser frontend, optional simulator and optional ingress tunnel.

## Decision

Keep the Aeolus backend as a **modular monolith** with explicit internal service boundaries and a typed event bus. Use separate processes/containers only where the boundary has operational or security value:

- Eclipse Mosquitto for MQTT;
- Aeolus backend for platform runtime;
- frontend web server/browser application;
- simulator only for demo/integration use;
- Cloudflare Tunnel only for the hosted public demo/optional ingress.

Do not create microservices merely to mirror code modules.

## Why this fits Aeolus

A modular monolith keeps local deployment understandable and resource-efficient while still allowing strong interfaces inside the codebase. It also makes transactional SQLite persistence and in-process event coordination natural.

Real process boundaries remain visible where they represent external protocols or trust boundaries rather than organisational fashion.

## Alternatives considered

### Microservice per subsystem

This can support independent scaling and team ownership, but Aeolus currently has neither requirement. It would turn local installation into a distributed system and make failure handling substantially harder.

### One process including an embedded MQTT broker and frontend

This reduces container count but couples unrelated lifecycles and would require Aeolus to own broker implementation/security rather than using a mature MQTT broker.

### Serverless/cloud functions

This conflicts with local-first/offline execution and would externalise the core physical control path.

## Consequences

### Positive

- Simple deployment and debugging on an edge host.
- Low inter-service latency and no internal network protocol for every domain call.
- Strong internal module boundaries can evolve without distributed-system overhead.
- Separate broker/UI boundaries remain explicit.

### Negative / accepted trade-offs

- Backend domains scale together rather than independently.
- A backend process failure affects multiple platform functions.
- Internal interfaces need discipline because the language does not enforce process isolation.

## Revisit when

Split a subsystem only when there is a concrete independent scaling, fault-isolation, deployment or security requirement that outweighs the cost of another distributed boundary.

## Implementation anchors

- `src/index.ts`
- `src/core/event-bus.ts`
- `docker-compose.yml`
- `docs/reference/architecture.md`
