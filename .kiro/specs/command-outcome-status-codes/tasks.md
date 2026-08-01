# Implementation Plan

- [ ] 1. Add `failureKind` to the result model
  - Add `CommandFailureKind` and the optional `failureKind` field to `ActionResult` in `src/core/types.ts`.
  - _Requirements: 4.6_

- [ ] 2. Classify failures at their source in ActionRouter
  - Set `failureKind` on device-not-found (`not_found`), unsupported action (`unsupported`), param validation (`invalid_params`), MQTT-not-connected / owner-disabled / no-connector (`transport`), and connector/MQTT throw (`execution`).
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [ ] 3. Classify failures in CommandService
  - No-handler → `unsupported`; observed-device-not-found → `not_found`; confirm `...dispatchResult` spread preserves an upstream `failureKind`.
  - _Requirements: 4.2, 4.1, 4.6_

- [ ] 4. Add the pure status-mapping function
  - Create `src/api/routes/command-status.ts` with `httpStatusForCommandResult(result)` and unit tests for every lifecycle/failureKind combination.
  - _Requirements: 2.1, 2.2, 3.1–3.7, 5.1, 5.2, 6.1_

- [ ] 5. Apply the mapping in the Action_Route
  - Change `POST /api/devices/:id/action` to `res.status(httpStatusForCommandResult(result)).json(result)`; leave validateAction (400) and requireDevice (403) unchanged.
  - _Requirements: 1.1, 1.2, 1.3_

- [ ] 6. Update route + router tests
  - Update `device.routes.test.ts` action cases for the new codes (404 not-found, 200 success, 504 timeout, 503 transport) asserting the body is preserved; add ActionRouter `failureKind` assertions.
  - _Requirements: 3.1–3.7, 4.1–4.5_

- [ ] 7. Docs
  - Document the status mapping in `docs/reference/api.md`; remove the resolved item from `docs/BACKLOG.md`.
  - _Requirements: 1.1_
