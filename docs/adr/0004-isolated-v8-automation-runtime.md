# ADR-0004: Isolated V8 contexts for user-authored Logic

- **Status:** Accepted
- **Date:** 2026-08-28

## Context

Aeolus lets an administrator author JavaScript/TypeScript Logic that can inspect site state and request physical actions. Running that source directly in the backend process would expose Node globals, filesystem/process capabilities and the backend's own memory space.

The product also wants a familiar general-purpose language rather than a narrowly constrained rules DSL.

## Decision

Compile authored Logic to JavaScript and execute it through **`isolated-vm` V8 isolates**. Create a fresh isolate per execution with explicit memory and CPU-time limits. Do not expose Node globals. Instead, inject a small host-mediated API (`devices`, `mqtt`, `events`, `http`, `state`, `db`, `log`, `context`) through controlled references and copied/serialised data.

The current runtime uses a 32 MB isolate memory limit and a 5-second synchronous execution timeout, with a separate bounded completion window for asynchronous physical commands.

## Why this fits Aeolus

Node already runs V8 and the product authors in TypeScript/JavaScript, so V8 isolates preserve a natural language/tooling experience while creating a substantially stronger boundary than executing user code in the application's normal global context.

The host-reference model also forces privileged operations back through Aeolus' authorization and command services instead of giving the script direct access to internal objects.

## Alternatives considered

### Node `vm`

`vm` is useful for contexts but is not treated as a security boundary for untrusted code. It does not provide the isolation properties Aeolus wants for authored automation Logic.

### Worker threads

Workers provide concurrency but share the same process and do not by themselves create the desired capability/security boundary.

### Child process or container per execution

OS-level isolation is stronger, but process/container startup and IPC overhead are much higher for frequent edge automations on small hardware. It would also make local development and deployment materially heavier.

### A custom rules DSL

A DSL could provide a smaller attack surface and easier static validation, but would sharply limit expressiveness and make complex real-world automation harder to author. Aeolus uses JavaScript/TypeScript Automation Projects as the first-party code-authoring model; retained form rules are a runtime compatibility path for historical records.

## Consequences

### Positive

- Authored code cannot directly import Node APIs or reach backend globals.
- Memory and CPU budgets are explicit per execution.
- TypeScript/JavaScript remains the authoring language.
- Every privileged operation can be mediated by a host service.

### Negative / accepted trade-offs

- `isolated-vm` is a native addon and complicates platform builds; Windows development may not have the runtime available while Docker/Linux does.
- Crossing the isolate boundary has transfer restrictions, so object/function values often require explicit copying or serialisation.
- Async completion across a native isolate boundary needs careful lifecycle handling.
- An in-process V8 isolate is not the same security boundary as an OS container; Aeolus should not market this as arbitrary hostile multi-tenant code execution.

## Revisit when

Reconsider if third-party/untrusted code becomes a product requirement, stronger tenant isolation is needed, isolate crashes become a reliability issue, or the runtime moves away from Node/V8.

## Implementation anchors

- `src/automations/sandbox.ts`
- `src/automations/sandbox-types.d.ts`
- `docs/reference/automations.md`
- `README.md`
