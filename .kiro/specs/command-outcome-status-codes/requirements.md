# Requirements Document

## Introduction

The device action route (`POST /api/devices/:id/action`) returns HTTP 200 for every domain outcome — success, rejection, timeout, transport failure. The `Command_Result` body carries the truthful `lifecycleState` and `error`, but the HTTP status does not, so a timed-out or rejected command looks like a successful HTTP call to any client that inspects status codes (proxies, monitoring, generic HTTP clients). This is a truthfulness gap at the transport layer.

This feature maps command outcomes to expressive HTTP status codes while keeping the `Command_Result` object as the authoritative detail. It adds a small, explicit failure classification (`failureKind`) so the route can distinguish a client-side rejection from a transport failure without fragile error-string matching.

## Glossary

- **Action_Route**: `POST /api/devices/:id/action`.
- **Command_Result**: The `ActionResult` object returned by the command path — `{ success, lifecycleState?, error?, data?, correlationId?, failureKind? }`.
- **Lifecycle_State**: The terminal `CommandLifecycleState` — success: `DISPATCHED`, `ACKNOWLEDGED`, `OBSERVED`; failure: `FAILED`, `TIMED_OUT`, `STATE_MISMATCH`.
- **Failure_Kind**: A coarse classification of a `FAILED` outcome: `not_found`, `unsupported`, `invalid_params`, `transport`, `execution`.
- **Authoritative_Body**: The full `Command_Result` returned as the JSON body regardless of status code.

## Requirements

### Requirement 1: Preserve the authoritative result body

**User Story:** As an API client, I want the full command result in the body regardless of status, so that existing readers of `success`/`lifecycleState`/`error` keep working.

#### Acceptance Criteria

1. THE Action_Route SHALL return the complete Command_Result as the JSON body for every outcome, unchanged in shape.
2. THE status-code mapping SHALL NOT remove or rename any existing Command_Result field.
3. Pre-existing pre-flight responses SHALL be unchanged: a missing/empty action type SHALL remain HTTP 400, and an authorization failure SHALL remain HTTP 403.

### Requirement 2: Map successful outcomes

**User Story:** As an API client, I want a 2xx status only when the command actually succeeded, so that success is truthful at the HTTP layer.

#### Acceptance Criteria

1. WHEN the Command_Result has `success: true` (Lifecycle_State `DISPATCHED`, `ACKNOWLEDGED`, or `OBSERVED`), THE Action_Route SHALL respond with HTTP 200.
2. THE Action_Route SHALL treat `DISPATCHED` for a dispatch-only command as success (HTTP 200), because dispatch is that command's truthful terminal state.

### Requirement 3: Map failure outcomes to expressive codes

**User Story:** As an API client, I want distinct status codes for timeout, rejection, and transport failure, so that I can react correctly without parsing error strings.

#### Acceptance Criteria

1. WHEN Lifecycle_State is `TIMED_OUT`, THE Action_Route SHALL respond with HTTP 504.
2. WHEN Lifecycle_State is `STATE_MISMATCH`, THE Action_Route SHALL respond with HTTP 409.
3. WHEN Lifecycle_State is `FAILED` with Failure_Kind `not_found`, THE Action_Route SHALL respond with HTTP 404.
4. WHEN Lifecycle_State is `FAILED` with Failure_Kind `unsupported` or `invalid_params`, THE Action_Route SHALL respond with HTTP 422.
5. WHEN Lifecycle_State is `FAILED` with Failure_Kind `transport`, THE Action_Route SHALL respond with HTTP 503.
6. WHEN Lifecycle_State is `FAILED` with Failure_Kind `execution`, THE Action_Route SHALL respond with HTTP 502.
7. WHEN Lifecycle_State is `FAILED` with no Failure_Kind, THE Action_Route SHALL respond with HTTP 422 as a safe default for an unclassified rejection.

### Requirement 4: Classify failures at their source

**User Story:** As a maintainer, I want failures classified where they occur, so that the route does not infer meaning from error text.

#### Acceptance Criteria

1. THE command path SHALL set Failure_Kind `not_found` when the target device does not exist.
2. THE command path SHALL set Failure_Kind `unsupported` when the action type is not supported for the device (no handler, or not in the device's action catalog).
3. THE command path SHALL set Failure_Kind `invalid_params` when action parameters fail validation.
4. THE command path SHALL set Failure_Kind `transport` when the broker or owning connector is unavailable (MQTT not connected, owning instance disabled, no enabled connector).
5. THE command path SHALL set Failure_Kind `execution` when a connector handler throws while executing an otherwise-valid command.
6. Failure_Kind SHALL propagate through the command service to the Action_Route unchanged.

### Requirement 5: Status-mapping is pure and tested

**User Story:** As a maintainer, I want the mapping isolated and unit-tested, so that it is easy to verify and change.

#### Acceptance Criteria

1. THE status-code mapping SHALL be a pure function of the Command_Result, with no side effects.
2. THERE SHALL be unit tests asserting the status code for each Lifecycle_State and Failure_Kind combination, and that the body is preserved.

### Requirement 6: 202 is intentionally not used

**User Story:** As a maintainer, I want the async-accepted case documented, so that its absence is a decision rather than an omission.

#### Acceptance Criteria

1. BECAUSE the Action_Route awaits a terminal Lifecycle_State within the REST action timeout, THE route SHALL NOT return HTTP 202; an unconfirmed-but-dispatched command already resolves to `DISPATCHED` (200) or `TIMED_OUT` (504). This decision SHALL be recorded in the design.
