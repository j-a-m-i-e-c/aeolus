# Design Document

## Overview

Two changes: (1) add a coarse `failureKind` to `ActionResult`, set at each failure source so meaning is explicit rather than parsed from error text; (2) map the resulting `Command_Result` to an HTTP status via a pure function, applied in the Action_Route while still returning the full result as the body.

The command semantics, lifecycle model, and result body are unchanged — only the HTTP status becomes truthful.

## Failure classification

Add to `ActionResult` (`src/core/types.ts`):

```ts
export type CommandFailureKind =
  | "not_found"      // target (or observed) device does not exist
  | "unsupported"    // no handler / action not in the device's catalog
  | "invalid_params" // parameters failed validation
  | "transport"      // broker/connector unavailable (not connected, disabled, none)
  | "execution";     // connector handler threw while executing

export interface ActionResult {
  // ...existing...
  /** Coarse cause when success is false; drives the route's HTTP status. */
  failureKind?: CommandFailureKind;
}
```

Set at source:

| Site | Current return | Add |
|---|---|---|
| `ActionRouter` device-not-found | `{success:false,error}` | `failureKind:"not_found"` |
| `ActionRouter` unsupported action | `{success:false,error}` | `failureKind:"unsupported"` |
| `ActionRouter` param validation | `{success:false,error}` | `failureKind:"invalid_params"` |
| `ActionRouter` MQTT not connected | `{success:false,error}` | `failureKind:"transport"` |
| `ActionRouter` owner disabled / no connector | `{success:false,error}` | `failureKind:"transport"` |
| `ActionRouter` connector `execute` throws | `{success:false,error}` | `failureKind:"execution"` |
| `ActionRouter` MQTT publish throws | `{success:false,error}` | `failureKind:"execution"` |
| `CommandService` no handler for type | `{success:false,lifecycleState:"FAILED"}` | `failureKind:"unsupported"` |
| `CommandService` observed device not found | `{success:false,lifecycleState:"FAILED"}` | `failureKind:"not_found"` |

`CommandService.execute` already spreads `...dispatchResult` when a handler reports failure, so a `failureKind` set by the ActionRouter propagates unchanged. `TIMED_OUT` and `STATE_MISMATCH` come from the tracker resolution and need no `failureKind` — they are mapped by `lifecycleState` directly.

## Status mapping (pure function)

New `src/api/routes/command-status.ts`:

```ts
import type { ActionResult } from "../../core/types.js";

/** Map a terminal Command_Result to an expressive HTTP status. Body stays authoritative. */
export function httpStatusForCommandResult(result: ActionResult): number {
  if (result.success) return 200;                       // DISPATCHED | ACKNOWLEDGED | OBSERVED

  switch (result.lifecycleState) {
    case "TIMED_OUT": return 504;                        // upstream did not confirm in time
    case "STATE_MISMATCH": return 409;                   // observed state conflicts with request
    case "FAILED":
    default:
      switch (result.failureKind) {
        case "not_found": return 404;
        case "transport": return 503;                    // broker/connector unavailable
        case "execution": return 502;                    // connector/device errored downstream
        case "unsupported":
        case "invalid_params": return 422;               // request invalid for this device
        default: return 422;                             // unclassified rejection
      }
  }
}
```

Pure, no imports beyond the type, trivially unit-testable.

## Route change

`POST /api/devices/:id/action` keeps its `withTimeout(commandService.execute(...))` call and the `TIMED_OUT` fallback. The only change is the response line:

```ts
// before: res.json(result)  (always 200)
res.status(httpStatusForCommandResult(result)).json(result);
```

`validateAction` (400 for missing type) and `requireDevice("interact")` (403) run before the handler and are unchanged (Req 1.3). The body is the untouched `Command_Result` (Req 1.1).

## Why not 202

The route awaits the terminal lifecycle state within `restActionTimeoutMs` (the startup assertion guarantees this budget is >= the confirmation timeout). There is no "accepted, still pending" response: a dispatch-only command resolves to `DISPATCHED` (200), and a command still awaiting confirmation when the budget expires resolves to `TIMED_OUT` (504). So 202 has no truthful place here; it is intentionally omitted (Req 6.1).

## Testing strategy

- **Unit — `httpStatusForCommandResult`**: one assertion per lifecycle/failureKind combination (200 for each success state, 504, 409, 404, 503, 502, 422, and the unclassified-FAILED default).
- **Route tests** (`device.routes.test.ts`): update the existing action-endpoint cases — a `FAILED` not-found now returns 404, a `DISPATCHED` success stays 200 — and add cases for `TIMED_OUT` → 504 and a `transport` failure → 503, asserting the body still carries `success`/`lifecycleState`/`error`.
- **ActionRouter tests**: assert `failureKind` is set on the not-found, unsupported, invalid-params, transport, and execution paths.
- No new e2e.

## Rollout

Backward-compatible in body shape; clients that only read the JSON body are unaffected. Clients that branch on HTTP status get truthful codes. `failureKind` is optional and additive.
