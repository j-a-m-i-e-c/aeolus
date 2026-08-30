# ADR-0003: SQLite with `better-sqlite3`, WAL and versioned migrations

- **Status:** Accepted
- **Date:** 2026-08-28

## Context

Aeolus needs durable storage for configuration, users, devices, layouts, automations, command history, automation state and the Data Store. The normal deployment is one backend process on one local host.

Running a separate database server would add operational weight to an edge installation without providing much benefit for the expected write volume or single-node topology.

## Decision

Use **SQLite** through `better-sqlite3` as the primary durable store. Enable foreign keys and WAL mode. Apply ordered, versioned migrations before normal backend services start.

Database files live on persistent host storage rather than inside an ephemeral container layer.

## Why this fits Aeolus

SQLite gives transactions, indexing and relational integrity while preserving the appliance-like deployment model: the database is a local file, needs no daemon and is easy to back up or move.

`better-sqlite3` gives a simple synchronous API that suits Aeolus' single-process coordination model and avoids creating an artificial asynchronous network-database abstraction.

## Alternatives considered

### PostgreSQL

PostgreSQL would be a strong choice for a multi-node or multi-tenant service, but it adds another server, credentials, lifecycle and backup system to every small edge install.

### JSON/files per subsystem

Files are operationally simple at first but become poor at transactional updates, referential integrity, querying and schema evolution as the platform grows.

### Embedded key-value database

A KV store could work for state, but Aeolus has relational data such as users/groups, layouts, device ownership and command history. SQLite handles both state-like and relational workloads in one store.

## Consequences

### Positive

- One-file local persistence with transactional semantics.
- Simple backup/restore story.
- No separate database service.
- Strong fit for Raspberry Pi and single-site deployments.
- Versioned migrations preserve schema evolution.

### Negative / accepted trade-offs

- Aeolus is not designed for multiple backend writers against the same database.
- WAL creates `-wal` / `-shm` sidecars and therefore requires correct directory ownership and permissions.
- Heavy analytical workloads or horizontal scale would eventually outgrow this model.
- `better-sqlite3` is a native dependency and therefore part of the platform build matrix.

## Revisit when

Reconsider if one site needs multiple active backend instances, write throughput becomes database-bound, or a managed fleet architecture requires a central shared database.

## Implementation anchors

- `src/db/database.ts`
- `src/db/migration-runner.ts`
- `src/db/migrations/`
- `docs/reference/data-and-storage.md`
