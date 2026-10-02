# ADR-0024: Reproducible showcase content and isolated hosted reset

- **Status:** Accepted (retrospective)
- **Date:** 2026-09-30

## Context

A public demonstration must repeatedly return to known devices, automations and dashboard layouts, yet Aeolus also uses the same codebase for real installations. A showcase seeder that deletes arbitrary user state would be unacceptable on a local install. A hosted snapshot that simply copies a live SQLite file while writes continue can also produce inconsistent state or preserve leftover session data. Product, simulator framework, scenario content, and hosted operations therefore require explicit ownership boundaries.

## Decision

Keep normal product runtime at the repository root, generic simulation in `src/simulator`, and showcase-only scenarios, seed data and deployment tooling under `demo/`. Seed declarations are idempotently reconciled against a **showcase-owned ledger** of resource IDs; on a local installation the seeder owns only its declared fixtures, not arbitrary personal tabs, collections or automations. Manual/unrestricted showcase and public/restricted showcase have separate Compose overlays/configuration.

For the hosted demonstration, create a vetted **golden SQLite snapshot** separate from the active database, with checksum and backup procedures. Nightly reset is an operational transaction: stop relevant writers, restore active DB from the verified golden (handling WAL/SHM), repair filesystem ownership as required, then restart services. Protect golden creation against overlap with the reset timer, and keep the golden outside the runtime data directory. A failed reset must report failure and attempt to restore service rather than silently announcing a clean demo.

## Alternatives considered

- **One general-purpose seeding script that drops all data:** straightforward, but dangerous when run against local user installations.
- **Ship scenario data inside the core product:** entangles product behaviour, test storytelling and deployment.
- **Reseed the live hosted database in place each night:** complicates partial-failure recovery and makes a deterministic reset harder.
- **Use one mutable SQLite database as both source and reset target:** cannot guarantee a clean trusted starting point.

## Consequences

Golden state needs an intentional promotion/checksum workflow, not silent overwriting. Hosted environment correctness cannot be inferred solely from the local showcase overlay; the actual hosted Compose, ingress, snapshot, timer and resource limits require their own release validation. A golden restores *demo state*, not the user's legitimate production state; these paths must remain distinct.

## Revisit when

Per-visitor ephemeral instances or a stateless simulator make the shared database snapshot unnecessary, or a distributed database replaces SQLite.

## Implementation anchors

- `demo/README.md`
- `demo/seed/seed.mjs`
- `demo/compose/local-showcase.yml`
- `demo/compose/hosted-runtime.yml`
- `demo/operations/create-golden.sh`
- `demo/operations/reset.sh`
- `demo/operations/systemd/`
- [ADR-0023](0023-public-demo-backend-isolation.md)
