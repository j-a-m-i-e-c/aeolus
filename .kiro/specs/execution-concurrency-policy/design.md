# Design: Execution Concurrency Policy

## Overview

Introduce an `ExecutionGate` — a pure, testable concurrency-control module that sits between rule-match evaluation and actual execution dispatch. It enforces a global active-execution cap, per-rule bounded FIFO queues, drop-on-overflow, and duplicate suppression. The gate is integrated into `AutomationEngine` at the single call-site where `executeRule()` is invoked.

## Architecture

```
evaluate() / fire() / cron callback
        │
        ▼
  ┌─────────────┐
  │ ExecutionGate │  ← admit / queue / drop / suppress
  └──────┬──────┘
         │ admitted
         ▼
   executeRule(rule, context)
         │
         ▼ completion callback
   gate.complete(handle)
```

The gate is stateless w.r.t. execution content — it only tracks slots, queues, and dedup keys. The actual `executeRule` logic is unchanged.

## Components and Interfaces

### ExecutionGate

```typescript
export interface GateConfig {
  maxActive: number;      // default 10
  maxQueuePerRule: number; // default 3
}

export interface ExecutionRequest {
  ruleId: string;
  deviceId: string;
  topic: string;
  execute: () => Promise<unknown>; // thunk — called when admitted
}

export type AdmitResult =
  | { status: "admitted"; handle: string }
  | { status: "queued" }
  | { status: "dropped"; reason: "queue_full" }
  | { status: "suppressed"; reason: "duplicate" };

export interface GateStats {
  activeCount: number;
  queueDepths: Record<string, number>; // ruleId → queue length
}

export interface ExecutionGateDeps {
  onDrop?: (ruleId: string, deviceId: string, topic: string) => void;
  onSuppress?: (ruleId: string, deviceId: string, topic: string) => void;
}
```

**Methods:**

- `submit(request: ExecutionRequest): AdmitResult` — synchronous decision: admit, queue, drop, or suppress.
- `complete(handle: string): void` — signals completion; triggers drain.
- `stats(): GateStats` — returns current active count and per-rule queue depths.

### Integration in AutomationEngine

The engine constructs `ExecutionGate` in its constructor (config from `AutomationEngineDeps`). The existing `void this.executeRule(rule, context)` call-sites are replaced with a `gate.submit(...)` call that wraps `executeRule` in a thunk. On script/direct execution completion (after `record()`), the engine calls `gate.complete(handle)`.

## Data Models

### Internal State (within ExecutionGate)

```typescript
// Active execution tracking
activeSet: Map<string, { ruleId: string; dedupKey: string }>  // handle → metadata
activeCount: number

// Per-rule FIFO queues
queues: Map<string, Array<{ request: ExecutionRequest; dedupKey: string; enqueuedAt: number }>>

// Dedup registry
dedupKeys: Set<string>  // "ruleId:deviceId:topic"
```

**Dedup key formula:** `${ruleId}:${deviceId}:${topic}`

### Drain Algorithm

On `complete(handle)`:
1. Remove handle from `activeSet`, decrement `activeCount`, remove its dedupKey from `dedupKeys`.
2. Scan rule queues round-robin (or just iterate the map — fairness is not a requirement for ~10–20 rules) for the oldest entry (by `enqueuedAt`).
3. If found: remove from queue, remove its dedupKey reservation (it gets a fresh active dedupKey), admit it (increment `activeCount`, add to `activeSet`, call its `execute` thunk).
4. Repeat step 2–3 until `activeCount === maxActive` or all queues empty.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Capacity Invariants

*For any* sequence of `submit` and `complete` operations on an ExecutionGate, the active count SHALL never exceed `maxActive` AND no rule's queue length SHALL ever exceed `maxQueuePerRule`.

**Validates: Requirements 1.1, 2.1**

### Property 2: Correct Routing Decision

*For any* gate state and execution request: if `activeCount < maxActive` and no duplicate exists, the request is admitted; if `activeCount === maxActive` and the rule's queue has room and no duplicate exists, the request is queued; if the rule's queue is full, the request is dropped; if a duplicate dedup key exists, the request is suppressed.

**Validates: Requirements 1.2, 1.3, 2.2, 2.3, 3.2**

### Property 3: FIFO Drain Order

*For any* gate state with queued executions, when `complete` is called, the next execution promoted to active SHALL be the one with the earliest `enqueuedAt` timestamp across all rule queues.

**Validates: Requirements 1.4, 2.4**

### Property 4: Dedup Lifecycle

*For any* execution that completes or is dropped, its dedup key SHALL be removed from the dedup set, and a subsequent request with the same ruleId + deviceId + topic SHALL be admitted or queued (not suppressed).

**Validates: Requirements 3.2, 3.3**

## Error Handling

- **Thunk rejection**: If an `execute` thunk rejects, the gate still calls `complete` internally (the gate wraps the thunk). This prevents slot leaks.
- **Stale handles**: Calling `complete` with an unknown handle is a no-op (idempotent).
- **Process restart**: All in-memory state is lost. The gate starts fresh with zero active executions. Documented as an accepted limitation.

## Testing Strategy

**Property-based tests** (fast-check, 100+ iterations each):
- Model the gate as a state machine. Generate random sequences of `submit` and `complete` commands with varying ruleIds, deviceIds, topics. Assert invariants (Properties 1–4) hold after every operation.

**Unit tests**:
- Specific examples: admit below cap, queue at cap, drop on overflow, suppress duplicate.
- Integration: verify `AutomationEngine` calls gate.submit and gate.complete correctly (mock gate).
- Edge cases: complete with empty queues, submit after dispose, zero-config defaults.

**Library**: fast-check (already in devDependencies).

**Configuration**: Each property test runs minimum 100 iterations. Each test is tagged:
- `Feature: execution-concurrency-policy, Property N: <title>`
