# Requirements Document

## Introduction

The Automation Engine currently fires rule executions without concurrency controls. On a resource-constrained Raspberry Pi (1–2 GB RAM), unbounded concurrent isolated-vm isolates can exhaust memory or starve device commands. This feature introduces a global execution cap, per-rule queuing with drop-on-overflow, and duplicate suppression to provide reliable backpressure.

## Glossary

- **Execution_Gate**: The pure concurrency-control module that admits, queues, drops, or suppresses execution requests before they reach the Sandbox or direct-action path.
- **Active_Execution**: An execution currently running (from the moment the Execution_Gate admits it until the completion callback fires).
- **Queued_Execution**: An execution waiting in a per-rule FIFO queue for an active slot to open.
- **Dedup_Key**: A composite key of `ruleId + deviceId + topic` used to identify duplicate triggers.
- **Automation_Engine**: The existing `AutomationEngine` class that evaluates rules and dispatches executions.

## Requirements

### Requirement 1: Global Execution Cap

**User Story:** As an operator, I want to limit the total number of concurrent automation executions, so that the Pi's CPU and memory are not exhausted.

#### Acceptance Criteria

1. THE Execution_Gate SHALL enforce a configurable maximum number of Active_Executions (default: 10)
2. WHEN an execution is requested and the Active_Execution count is below the cap, THE Execution_Gate SHALL admit the execution immediately
3. WHEN an execution is requested and the Active_Execution count equals the cap, THE Execution_Gate SHALL enqueue the execution in the originating rule's queue
4. WHEN an Active_Execution completes, THE Execution_Gate SHALL decrement the active count and attempt to drain the next Queued_Execution

### Requirement 2: Per-Rule Queue with Drop-on-Overflow

**User Story:** As an operator, I want each rule to have a bounded queue so that a single noisy rule cannot consume all available queue slots, and excess triggers are dropped with a warning.

#### Acceptance Criteria

1. THE Execution_Gate SHALL maintain a separate FIFO queue per rule with a configurable maximum depth (default: 3)
2. WHEN an execution is enqueued and the rule's queue depth is below the maximum, THE Execution_Gate SHALL append the execution to the queue
3. WHEN an execution is enqueued and the rule's queue is full, THE Execution_Gate SHALL drop the execution and log a warning containing the rule ID and queue depth
4. WHEN an Active_Execution completes, THE Execution_Gate SHALL drain queued executions in FIFO order (oldest first) until the global cap is reached or all queues are empty

### Requirement 3: Duplicate Suppression

**User Story:** As an operator, I want repeated triggers from the same sensor to be suppressed when an identical execution is already in-progress or queued, so that chatty devices do not flood the same automation.

#### Acceptance Criteria

1. THE Execution_Gate SHALL compute a Dedup_Key from the combination of ruleId, deviceId, and topic for each execution request
2. WHEN an execution request arrives and an Active_Execution or Queued_Execution with the same Dedup_Key already exists, THE Execution_Gate SHALL suppress the request and log a debug message
3. WHEN an execution completes or is dropped, THE Execution_Gate SHALL remove its Dedup_Key from the dedup set

### Requirement 4: Observability and Backward Compatibility

**User Story:** As an operator, I want visibility into queue state and confidence that existing automations work without configuration changes.

#### Acceptance Criteria

1. THE Execution_Gate SHALL expose the current active count and per-rule queue depths for health/metrics consumption
2. WHEN an execution is dropped, THE Execution_Gate SHALL emit a structured log at warn level with ruleId, deviceId, topic, and reason
3. WHEN no concurrency configuration is provided, THE Automation_Engine SHALL construct the Execution_Gate with default values (cap: 10, queue depth: 3) preserving existing fire-and-forget semantics under the cap
4. THE Execution_Gate SHALL be an in-memory structure; queued executions are lost on process restart (documented limitation)
