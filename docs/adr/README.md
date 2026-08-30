# Architecture Decision Records

Aeolus uses Architecture Decision Records (ADRs) to preserve the reasoning behind important technical choices.

The implementation and tests remain the authority for current behaviour. ADRs answer a different question: **why is Aeolus shaped this way, which alternatives were considered, and what trade-offs were accepted?**

This is especially useful for decisions that are easy to misunderstand from code alone, such as using V8 isolates rather than Node's `vm`, choosing SQLite instead of a network database, or keeping MQTT and vendor connectors behind one device model.

## Status

- **Proposed** — under discussion; not yet a project commitment.
- **Accepted** — current architectural direction.
- **Superseded** — replaced by a later ADR; retained for history.
- **Deprecated** — still present for compatibility but no longer preferred.

## Index

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-local-first-single-site.md) | Local-first, single-site deployment model | Accepted |
| [0002](0002-mqtt-and-connectors.md) | MQTT for custom hardware, connectors for external ecosystems | Accepted |
| [0003](0003-sqlite-local-persistence.md) | SQLite with `better-sqlite3`, WAL and versioned migrations | Accepted |
| [0004](0004-isolated-v8-automation-runtime.md) | Isolated V8 contexts for user-authored Logic | Accepted |
| [0005](0005-opaque-origin-ui-sandbox.md) | Opaque-origin iframe plus capability-scoped host RPC for custom UI | Accepted |
| [0006](0006-truthful-command-lifecycle.md) | One command boundary with evidence-based completion tiers | Accepted |
| [0007](0007-automation-projects-esbuild.md) | Bounded multi-file Automation Projects bundled in memory with esbuild | Accepted |
| [0008](0008-modular-monolith-process-boundaries.md) | Modular monolith with a small number of explicit process boundaries | Accepted |

## Writing a new ADR

Copy [0000-template.md](0000-template.md), assign the next number, and keep it focused on one decision.

Good ADRs explain:

1. the constraint or problem;
2. the chosen approach;
3. meaningful alternatives;
4. consequences, including the bad ones;
5. the condition that would justify revisiting the decision.

Do not turn ADRs into implementation manuals. Link to the narrow reference document or code path for current mechanics.
