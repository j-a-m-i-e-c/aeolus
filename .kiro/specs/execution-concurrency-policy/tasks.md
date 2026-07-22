# Implementation Plan: Execution Concurrency Policy

## Overview

Implement `ExecutionGate` as a pure module, integrate it into `AutomationEngine`, and validate with property-based tests. TypeScript, following existing patterns (cf. `pending-command-tracker.ts`).

## Tasks

- [x] 1. Create ExecutionGate module
  - [x] 1.1 Implement `src/automations/execution-gate.ts` with `GateConfig`, `ExecutionRequest`, `AdmitResult`, `GateStats` interfaces and the `ExecutionGate` class
    - Implement `submit()`: dedup check → active cap check → queue check → admit/queue/drop/suppress
    - Implement `complete()`: remove from active set, clear dedup key, drain oldest queued entry
    - Implement `stats()`: return active count and per-rule queue depths
    - Wrap thunk execution to guarantee `complete` is called even on rejection (slot-leak prevention)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 4.1_

  - [ ]* 1.2 Write property tests for ExecutionGate
    - **Property 1: Capacity Invariants** — generate random submit/complete sequences, assert activeCount ≤ maxActive and queue depths ≤ maxQueuePerRule after every operation
    - **Property 2: Correct Routing Decision** — for generated gate states + requests, verify admit/queue/drop/suppress matches expected decision
    - **Property 3: FIFO Drain Order** — generate queues with multiple items, verify drain promotes oldest-enqueued first
    - **Property 4: Dedup Lifecycle** — verify dedup key freed on complete/drop, subsequent same-key request not suppressed
    - **Validates: Requirements 1.1–1.4, 2.1–2.4, 3.2, 3.3**

- [x] 2. Integrate ExecutionGate into AutomationEngine
  - [x] 2.1 Add `GateConfig` to `AutomationEngineDeps` (optional, defaults: maxActive=10, queueDepth=3)
    - Construct `ExecutionGate` in `AutomationEngine` constructor
    - _Requirements: 4.3_

  - [x] 2.2 Replace direct `executeRule` invocations with gate submission
    - In `evaluate()`: wrap `executeRule(rule, context)` in a thunk, call `gate.submit()`; handle returned status (log drops/suppressions)
    - In cron callback: same pattern
    - In `fire()`: submit through gate; if admitted, await the thunk's promise; if queued/dropped/suppressed, return appropriate result
    - Call `gate.complete(handle)` after `record()` in both `executeScriptRule` and `executeDirectRule`
    - _Requirements: 1.2, 1.3, 2.3, 3.2, 4.2_

  - [ ]* 2.3 Write unit tests for AutomationEngine integration
    - Test that engine constructs gate with default config when none provided
    - Test that gate.submit is called for each matched rule
    - Test that gate.complete is called after execution finishes (success and failure)
    - Test drop/suppress logging via mock logger
    - _Requirements: 4.2, 4.3_

- [x] 3. Expose gate stats for observability
  - [x] 3.1 Add `getGateStats()` method to AutomationEngine, wire into health endpoint
    - Return `gate.stats()` from a new engine accessor
    - Add gate stats to the existing `/api/health` or `/api/automations/status` response
    - _Requirements: 4.1_

- [x] 4. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- `ExecutionGate` follows the same pure-module pattern as `PendingCommandTracker`
- Property tests use fast-check (already available in the project)
- The gate is in-memory only — no persistence, lost on restart (documented)
