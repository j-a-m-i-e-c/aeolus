# ADR-0007: Bounded multi-file Automation Projects bundled in memory with esbuild

- **Status:** Accepted
- **Date:** 2026-08-28

## Context

A single Logic string plus a single UI string is sufficient for small rules but becomes difficult to maintain when an automation contains domain logic, UI components and shared types/helpers.

Aeolus needs multi-file authoring without turning every automation into an independently deployed service or widening the existing Logic/UI sandbox boundaries.

## Decision

Represent script automations as **Automation Projects** containing a bounded virtual source tree with conventional `logic/`, optional `ui/` and optional shared/supporting modules. Validate project paths and size limits, resolve only permitted relative imports, and bundle Logic/UI **in memory with esbuild** when the project is saved.

The compiled result continues through the existing isolated Logic and opaque-origin UI runtimes. Project authoring does not grant filesystem access or arbitrary npm imports.

The normal authoring UI leads with **Logic** and **UI**. The underlying file tree is progressive disclosure for automations that need more structure.

## Why this fits Aeolus

It gives complex automations normal software-engineering structure while preserving a small mental model for simple ones. In-memory bundling avoids creating per-project build directories or deployment artifacts on the edge host.

esbuild is fast enough for interactive saves and already understands the TypeScript/JSX module graph needed by both Logic and UI.

## Alternatives considered

### Keep one giant Logic/UI source string

Simple storage, but complexity scales poorly and discourages reusable helpers/components inside one automation.

### Store projects as real directories on disk

This would make conventional tooling easier, but creates path traversal, ownership, backup and deployment concerns and couples the API model to host filesystem layout.

### Give each automation its own package.json/npm dependencies

Powerful, but dramatically widens supply-chain and runtime privileges. It would also make deterministic edge builds and sandbox capability reasoning harder.

### Make every automation a separate service/container

This provides strong process isolation but is far too operationally heavy for the common case and undermines Aeolus' integrated authoring experience.

## Consequences

### Positive

- Complex automations can use real modules and UI components.
- Simple automations can remain effectively one Logic file plus optional UI.
- Compilation is fast and leaves no project build tree on disk.
- Existing runtime sandboxes remain the privilege boundary.

### Negative / accepted trade-offs

- Aeolus owns a virtual filesystem/import resolver and project validation rules.
- Arbitrary npm dependencies are intentionally unavailable.
- The editor must hide file-system complexity until the author needs it.
- Authored Project source and the compiled/runtime projection deliberately coexist. The projection is an execution/upgrade implementation detail, not a second authoring model.

## Revisit when

Reconsider dependency/import policy if a trusted package ecosystem becomes a deliberate product feature, or if projects grow large enough that full in-memory rebundling on save becomes a performance problem.

## Implementation anchors

- `src/automations/automation-project.ts`
- `frontend/src/components/AutomationProjectEditor.tsx`
- `docs/architecture/AUTOMATION_PROJECTS.md`
