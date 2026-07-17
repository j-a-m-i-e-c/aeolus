# Implementation Plan: Custom UI Sandboxing

## Overview

Convert the design into incremental, dependency-ordered coding steps that move every custom UI component into an opaque-origin sandboxed iframe, expose a capability-scoped Aeolus UI SDK over a validated `postMessage`/`MessagePort` RPC channel, preserve the existing `CustomComponentProps` experience via a compatibility shim, tighten the host CSP, and correct the documentation.

Language/tooling: TypeScript + React 19, `vitest` for unit/property tests, `fast-check` for the seven correctness properties (min 100 runs each, tagged `Feature: custom-ui-sandboxing, Property N: <text>`), `@playwright/test` for browser-enforced isolation e2e (repo `e2e/` + `playwright.config.ts`), and a config/smoke check that parses `frontend/nginx.conf`.

All new code lives under `frontend/src/sandbox/` (host: `rpc-types.ts`, `sdk-broker.ts`, `useSandboxedComponent.ts`, `SandboxHost.tsx`; in-frame runtime: `runtime/{entry.ts,sdk-client.ts,shim.ts,module-loader.ts}`) plus `frontend/public/sandbox.html`.

Notes on repo reality used to ground these tasks:
- The only current consumer of `useDynamicComponent` is `AutomationPane.tsx` (`DynamicCustomSection`). `CustomPanelPane` (owned by the `custom-panels` spec) is not present in the repo yet, so its migration is conditional (Task 7.2); the panel path is nonetheless made ready via `buildPanelProps` (Task 4) and `SandboxHost entityType="panel"`.
- `fast-check` is not yet in `frontend/package.json` and is added in Task 1.

## Tasks

- [ ] 1. Shared RPC contract and op schema (`frontend/src/sandbox/rpc-types.ts`)
  - [ ] 1.1 Define the RPC envelope, props payload, capability allowlist, and per-op validators
    - Create `frontend/src/sandbox/rpc-types.ts` with `EntityType`, `RpcRequest`/`RpcResponse`/`RpcEvent`/`RpcInit`/`RpcMessage`, `RpcError` (codes `UNKNOWN_OP`/`BAD_SCHEMA`/`OP_FAILED`/`TIMEOUT`/`SANDBOX_DESTROYED`), `PropsPayload`, and the `SdkOp` union (`read`/`save`/`saveAndFire`/`fire`/`control`/`publish`/`subscribe`) that IS the allowlist
    - Add pure helpers `isRpcRequest(raw)` (checks `channel === "aeolus-sdk"`, `kind === "request"`, string non-empty `id`, `op ∈ SdkOp`) and `validateParams(op, params)` implementing the per-op schema table (non-empty string fields, JSON-serializable `value`, ignore unknown extra keys)
    - Add `fast-check` to `frontend/package.json` devDependencies (used by the property tests in later tasks)
    - _Requirements: 3.7, 4.3, 4.4_

  - [ ]* 1.2 Write unit tests for the envelope guard and op-schema validators
    - Create `frontend/src/sandbox/rpc-types.test.ts`
    - Cover malformed envelopes (wrong `channel`, wrong `kind`, missing/non-string `id`), unknown `op` strings, and valid/invalid `params` for every op
    - _Requirements: 3.7, 4.3, 4.4_

- [ ] 2. Host-side SDK broker (`frontend/src/sandbox/sdk-broker.ts`)
  - [ ] 2.1 Implement `SdkBroker` with grant-scoped validate/dispatch, state subscription, and teardown
    - Create `frontend/src/sandbox/sdk-broker.ts` defining `FrameGrant`, `BrokerDeps`, and the `SdkBroker` class
    - `register(grant)` wires the port's `onmessage`; `handleMessage` runs the 4-step algorithm: structural validate (discard on failure) → `validateParams` (`BAD_SCHEMA`, no effect) → execute the op via `deps` **always passing `grant.entityId`** (never a frame-supplied id) → post exactly one `RpcResponse` echoing the request `id` (`OP_FAILED` on throw/reject)
    - Reject `UNKNOWN_OP` for allowlist misses; never expose token/`authFetch`/generic-request op — `deps` is the entire privileged surface
    - `emitState` posts `state` events for the frame's granted entity only; wire `subscribeState` on register
    - `unregister(frameId)` unsubscribes the store listener, rejects all pending requests with `SANDBOX_DESTROYED`, and closes the port
    - Keep `handleMessage` drivable with a fake `MessagePort` + spy `BrokerDeps` for tests
    - _Requirements: 1.5, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 4.2, 4.3, 4.4, 4.5, 4.6, 7.4_

  - [ ]* 2.2 Write property test for operation scoping/attribution
    - File: `frontend/src/sandbox/sdk-broker.property.test.ts`
    - **Property 1: Every privileged operation is scoped to the frame's granted entity**
    - Generators: random `op`, random valid params (incl. spoofed `entityId`), 1–3 registered frames; assert the effect is invoked with `grant.entityId` (never the frame-supplied id) and messages are attributed only to their port's frame
    - **Validates: Requirements 1.5, 3.2, 3.3, 3.4, 4.2, 4.5**

  - [ ]* 2.3 Write property test for state-subscription scoping
    - File: `frontend/src/sandbox/sdk-broker.property.test.ts`
    - **Property 2: State subscriptions are delivered only for the granted entity**
    - Generator: granted id `G` + random list of `(entityId, key, value)` changes; assert a `state` event is delivered iff `entityId === G`
    - **Validates: Requirements 3.5, 5.2**

  - [ ]* 2.4 Write property test for invalid-message rejection
    - File: `frontend/src/sandbox/sdk-broker.property.test.ts`
    - **Property 3: Invalid messages are rejected with no privileged effect**
    - Generator: arbitrary malformed envelopes ∪ unknown op strings ∪ bad params; assert zero `BrokerDeps` effects and either discard or a structured error, never success
    - **Validates: Requirements 3.7, 4.3, 4.4**

  - [ ]* 2.5 Write property test for response totality and id correlation
    - File: `frontend/src/sandbox/sdk-broker.property.test.ts`
    - **Property 4: Every well-formed request yields exactly one correlated response**
    - Generator: list of well-formed requests with unique ids whose effects randomly succeed/throw; assert one response per id, ids echoed, each response a well-formed `{ok:true,result}` or `{ok:false,error}`
    - **Validates: Requirements 4.6, 5.1**

  - [ ]* 2.6 Write unit tests for the broker's privileged surface
    - File: `frontend/src/sandbox/sdk-broker.test.ts`
    - Assert the broker exposes no `token`/`fetch`/generic-request member (Req 3.6); `saveAndFire` triggers both the persist and fire effects; `UNKNOWN_OP` vs `BAD_SCHEMA` error codes are returned correctly
    - _Requirements: 3.6_

- [ ] 3. In-frame sandbox runtime (`frontend/src/sandbox/runtime/`)
  - [ ] 3.1 Relocate `rewriteImports` into the runtime module loader, retargeted to in-frame React
    - Create `frontend/src/sandbox/runtime/module-loader.ts`; move `rewriteImports` out of `frontend/src/hooks/useDynamicComponent.ts`, retargeting specifiers (`react`/`react-dom`/`react/jsx-runtime`) to the runtime's bundled in-frame React instead of `window.__AEOLUS_EXTERNALS__`
    - Add `loadModule(source)` that rewrites, builds a `Blob` in the frame's own realm, and `import()`s it there, returning the default export
    - _Requirements: 2.6_

  - [ ]* 3.2 Move and retarget the module-loader tests
    - Create `frontend/src/sandbox/runtime/module-loader.test.ts` by moving the existing `frontend/src/hooks/useDynamicComponent.test.ts` `rewriteImports` cases, retargeted to the in-frame React
    - _Requirements: 2.6_

  - [ ] 3.3 Implement the Aeolus UI SDK client (`sdk-client.ts`)
    - Create `frontend/src/sandbox/runtime/sdk-client.ts` implementing `AeolusUiSdk` over a `MessagePort`: `read`/`save`/`saveAndFire`/`fire`/`control`/`publish`/`subscribeState`/`subscribeProps`/`getProps`
    - Keep a `Map<id, {resolve, reject, timer}>` of pending requests, generate ids, apply a per-request timeout (default 8 s → `TIMEOUT`), and dispatch inbound `event` messages to listeners; `read` is served from a locally mirrored snapshot (no round-trip)
    - Expose no token/`authFetch`/generic-request member
    - _Requirements: 3.1, 3.6, 7.2_

  - [ ] 3.4 Implement the runtime bootstrap (`entry.ts`) and the static sandbox document
    - Create `frontend/src/sandbox/runtime/entry.ts`: post `handshake` to `window.parent` once, keep `event.ports[0]` as the dedicated port (ignore further `window` messages), receive `init` `{entityType, moduleSource, props}` over the port, `loadModule(moduleSource)` in-frame, build the SDK client + shim, and `createRoot(#sandbox-root).render(<Shim Component={mod.default} />)`
    - Create `frontend/public/sandbox.html` (root div + `<script type="module" src="/assets/sandbox-runtime.js">`, no inline privileged data)
    - _Requirements: 2.2, 2.5, 2.6, 3.1_

  - [ ]* 3.5 Write unit tests for the SDK client
    - File: `frontend/src/sandbox/runtime/sdk-client.test.ts`
    - Drive it with a fake `MessagePort`; assert `control` resolves only after the matching `response`, requests reject with `TIMEOUT` past the budget, `read` returns the mirrored snapshot value with no message sent, and the client exposes no `token`/`fetch` member
    - _Requirements: 3.6, 5.1, 7.2_

- [ ] 4. Compatibility shim (`frontend/src/sandbox/runtime/shim.ts`)
  - [ ] 4.1 Implement `buildAutomationProps`, `buildPanelProps`, and the reactive wrapper
    - Create `frontend/src/sandbox/runtime/shim.ts`; `buildAutomationProps(sdk)` reconstructs the exact `CustomComponentProps` (`frontend/src/components/panes/custom/types.ts`): `devices`/`ruleId`/`ruleName`/`lastFired`/`enabled`/`history` from the props snapshot, sync `read(key)` off a `stateMirror`, fire-and-forget `save`/`saveAndFire`/`fire`/`publish`, and `control` returning the SDK `Promise<void>`
    - Add the in-frame wrapper component that subscribes via `sdk.subscribeState`/`sdk.subscribeProps`, updates `stateMirror`, and bumps a `useState` version so state/props changes re-render (Req 5.2, 5.3)
    - Add `buildPanelProps(sdk)` mapping `CustomPanelProps` onto the same SDK: `deviceAction → control`, `mqttPublish → publish`, `state → mirrored Map`, `stateSet → save`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 6.1_

  - [ ]* 4.2 Write property test for props reconstruction
    - File: `frontend/src/sandbox/shim.property.test.ts`
    - **Property 5: The shim reconstructs the full CustomComponentProps surface**
    - Generator: random `PropsPayload`; assert `devices`/`ruleId`/`ruleName`/`lastFired`/`enabled`/`history` equal the payload, methods are callable, and `read(key)` returns the initial state value (or `undefined`)
    - **Validates: Requirements 5.3, 6.1**

  - [ ]* 4.3 Write property test for the save/read round-trip
    - File: `frontend/src/sandbox/shim.property.test.ts`
    - **Property 6: Save/read round-trip preserves values through the SDK**
    - Generator: non-empty key + JSON-serializable value; assert `read(key)` after `save(key,value)` equals the value and the broker issued the persist effect scoped to the granted entity id
    - **Validates: Requirements 5.5, 3.3**

  - [ ]* 4.4 Write a shim render unit test
    - File: `frontend/src/sandbox/runtime/shim.test.ts`
    - Mount the default UI template component through the shim and assert `aeolus.fire("clicked")` dispatches an SDK `fire`
    - _Requirements: 6.2_

- [ ] 5. Host hook and iframe wrapper (`frontend/src/sandbox/`)
  - [ ] 5.1 Implement `useSandboxedComponent`
    - Create `frontend/src/sandbox/useSandboxedComponent.ts` returning `{ status, error, frameRef, sendPropsPatch }`: idle when `!hasUiSource`; else `authFetch` the module from `/api/automations/:id/ui-module` or `/api/panels/:id/ui-module` (Req 2.9) into source text (non-OK → error); create/adopt an iframe with `sandbox="allow-scripts"` only (no `allow-same-origin`, no `allow-top-navigation`/`allow-popups`); await `handshake` (5 s timeout → error), create a `MessageChannel`, transfer `port2` to the frame and register `port1` with `SdkBroker`; post `init {entityType, moduleSource, props}`
    - Cleanup unregisters the broker entry and releases/pools the iframe; implement the `SANDBOX_POOL_CAP` (default 4) pool with LRU eviction and state-event coalescing per animation frame (Req 7.2, 7.3, 7.4)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.9, 7.2, 7.3, 7.4_

  - [ ] 5.2 Implement `SandboxHost` wrapped by the existing error boundary
    - Create `frontend/src/sandbox/SandboxHost.tsx` with `SandboxHostProps` (`entityType`, `entityId`, `hasUiSource`, `props`, `className`); render the `<iframe src="/sandbox.html">` from `useSandboxedComponent`, render the same inline error UI on `status:"error"`, and wrap the whole thing in `CustomComponentBoundary` so a host-side throw is caught (Req 2.7)
    - _Requirements: 2.7_

  - [ ]* 5.3 Write property test for the sandbox lifecycle
    - File: `frontend/src/sandbox/sdk-broker.property.test.ts`
    - **Property 7: Sandbox lifecycle releases resources and respects the pool bound**
    - Generator: random register/unregister (mount/unmount) sequences; assert live frames ≤ pool cap at every step, and unregistered frames leave no registration/subscription and have every pending request rejected with `SANDBOX_DESTROYED`
    - **Validates: Requirements 7.3, 7.4**

  - [ ]* 5.4 Write unit tests for the hook's frame creation and fetch
    - File: `frontend/src/sandbox/useSandboxedComponent.test.ts`
    - Assert the iframe `sandbox` token is exactly `allow-scripts` (Reqs 2.2–2.4), the module is fetched from `/api/automations/:id/ui-module` and (for panels) `/api/panels/:id/ui-module` (Req 2.9), and a non-OK fetch sets error status
    - _Requirements: 2.2, 2.3, 2.4, 2.9_

  - [ ]* 5.5 Write unit tests for `SandboxHost` error containment
    - File: `frontend/src/sandbox/SandboxHost.test.tsx`
    - Assert `status:"error"` renders the inline fallback and a host throw is caught by `CustomComponentBoundary` while the surrounding dashboard stays mounted
    - _Requirements: 2.7_

- [ ] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Integrate `SandboxHost` into the panes and remove the in-page loader
  - [ ] 7.1 Swap `DynamicCustomSection` in `AutomationPane.tsx` to render `SandboxHost`
    - In `frontend/src/components/panes/AutomationPane.tsx`, replace `useDynamicComponent(ruleId, hasUiSource)` + `<Component {...} />` with `<SandboxHost entityType="automation" entityId={ruleId} hasUiSource={hasUiSource} props={...} />`
    - Assemble the `PropsPayload` (devices, ruleId, ruleName, lastFired, enabled, history, initial state) and wire the pane's existing `control`/`publish`/`read`/`save`/`saveAndFire`/`fire` `authFetch` callbacks as the automation `BrokerDeps`
    - _Requirements: 5.1, 5.2, 5.3, 5.5, 6.2_

  - [ ] 7.2 Wire the panel path (conditional on `custom-panels`)
    - If `CustomPanelPane` (from the `custom-panels` spec) exists, apply the same swap with `entityType="panel"`, mapping `CustomPanelProps` callbacks (`deviceAction`/`mqttPublish`/`state`/`stateSet`) onto the panel `BrokerDeps`; otherwise verify the panel path is complete via `buildPanelProps` + `SandboxHost entityType="panel"` and leave a follow-up note (no orphaned code)
    - _Requirements: 5.1, 5.5, 6.2_

  - [ ] 7.3 Remove the obsolete in-page dynamic loader
    - Delete `frontend/src/hooks/useDynamicComponent.ts` (and its now-stale `useDynamicComponent.test.ts`) once the automation call site is migrated and `rewriteImports` has moved to `module-loader.ts`; remove the now-unused import in `AutomationPane.tsx`
    - _Requirements: 2.1_

  - [ ]* 7.4 Update `AutomationPane.test.tsx` to mock `SandboxHost`
    - `vi.mock("../../sandbox/SandboxHost")` returning a stub that renders `data-testid="sandbox-host"` and echoes `entityType`/`entityId`; convert the "renders dynamic component when uiSource present" test into "renders SandboxHost with entityType=automation and the rule id"; leave the pane's fetch/save/toggle/fire/mode tests unchanged
    - _Requirements: 2.1, 5.3_

- [ ] 8. CSP hardening in `frontend/nginx.conf`
  - [ ] 8.1 Tighten the host CSP and add the sandbox document CSP
    - In `frontend/nginx.conf`, remove `'unsafe-eval'` and `blob:` from the host `script-src`, keep `worker-src 'self' blob:` (Monaco), and add `frame-src 'self'`
    - Add `location = /sandbox.html` serving its own CSP: `default-src 'none'; script-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; base-uri 'none'; form-action 'none'`
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

  - [ ]* 8.2 Write the CSP config/smoke check
    - Create `frontend/src/sandbox/nginx-csp.test.ts` that parses the two CSP strings from `frontend/nginx.conf` and asserts: host `script-src` has neither `'unsafe-eval'` nor `blob:` (11.1); host `worker-src` still has `'self' blob:` (11.2); host has `frame-src 'self'`; and the `/sandbox.html` CSP has `connect-src 'none'` and `script-src 'self' blob:` (11.3)
    - _Requirements: 11.1, 11.2, 11.3, 11.5_

- [ ] 9. Sandbox-runtime bundling
  - [ ] 9.1 Add the `sandbox-runtime` build entry
    - Configure `frontend/vite.config.ts` (rollup input) to emit `assets/sandbox-runtime.js` bundling React 19 + `react-dom/client` + `jsx-runtime` + `sdk-client.ts` + `shim.ts` + `module-loader.ts` + `entry.ts`; confirm `public/sandbox.html` references the emitted asset path
    - _Requirements: 2.6, 3.1_

  - [ ]* 9.2 Write a bundling config assertion test
    - Create `frontend/src/sandbox/build-config.test.ts` asserting the Vite config declares the `sandbox-runtime` entry and output path `assets/sandbox-runtime.js`
    - _Requirements: 2.6_

- [ ] 10. Trusted/untrusted mode handling and v1 fallback wiring
  - [ ] 10.1 Thread the operating mode with identical v1 isolation
    - In `frontend/src/sandbox/useSandboxedComponent.ts`, accept a trusted/untrusted mode flag and ensure BOTH modes emit the identical `allow-scripts`-only frame and enforce the same broker allowlist in v1 (no relaxation); document the v1 trusted-administrator fallback path in code comments so it can be activated only via the documentation correction in Task 11
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 9.1, 9.2, 9.3, 9.4_

  - [ ]* 10.2 Write unit tests asserting mode-invariant isolation
    - File: `frontend/src/sandbox/useSandboxedComponent.test.ts`
    - Assert trusted and untrusted modes both produce a frame whose `sandbox` token is exactly `allow-scripts` and both go through the same broker allowlist
    - _Requirements: 8.2, 8.3_

- [ ] 11. Documentation accuracy (`docs/COMPREHENSIVE_DOCUMENTATION.md`)
  - [ ] 11.1 Update the custom-UI documentation to match shipped isolation
    - Replace the description of the in-page blob-URL `import()` loader with the opaque-origin iframe isolation; document the Trust_Boundary, the Aeolus_UI_SDK capability surface, and the prohibited capabilities from Requirement 1; correct any "sandboxed" overclaim; and clearly distinguish backend `isolated-vm` isolation (out of scope here) from this frontend isolation
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

- [ ] 12. End-to-end validation and final verification
  - [ ]* 12.1 Add the Playwright isolation e2e spec
    - Create `e2e/custom-ui-sandbox.spec.ts` against the Compose stack: a component trying `window.parent.useAuthStore`/token read/direct `fetch` to a host API is blocked (Reqs 1.2–1.4, 2.5, 2.8); a component `save`/`read`s state and re-renders on a live `automation-state` update (Reqs 5.2, 5.5); authored styling renders (Req 5.4); the rendered iframe carries `sandbox="allow-scripts"` without `allow-same-origin` (Req 2.2) and `/sandbox.html` responds with the sandbox CSP (Req 11.3)
    - _Requirements: 1.2, 1.3, 1.4, 2.2, 2.5, 2.8, 5.2, 5.4, 5.5, 11.3_

  - [ ] 12.2 Final checkpoint - build, typecheck, and full test run
    - Run the frontend build (`pnpm --filter aeolus-dashboard build`), `tsc` typecheck, and `vitest run`; ensure the updated `AutomationPane.test.tsx` passes and the Playwright isolation e2e is wired into `playwright.config.ts`; fix any failures. Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; core implementation tasks are never optional.
- Each of the seven correctness properties maps to exactly one property test, tagged `Feature: custom-ui-sandboxing, Property N: <text>`, run with `fast-check` at ≥ 100 iterations, and placed close to the implementation it validates (broker properties in `sdk-broker.property.test.ts`, shim properties in `shim.property.test.ts`).
- Browser-enforced isolation guarantees are validated by Playwright e2e (Task 12.1), not property tests; CSP is validated by a config/smoke check (Task 8.2).
- Every task builds on prior tasks and wires into an integration point (Tasks 7, 9, 12), so no code is left orphaned; `useDynamicComponent.ts` is removed only after its single call site migrates (Task 7.3).
- Out of scope (no tasks): the backend `isolated-vm` automation sandbox, a marketplace, the other two specs, and the optional dedicated separate-server-origin hardening (Requirement 2.10, future defense-in-depth).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "3.1", "8.1", "11.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "3.2", "3.3", "8.2"] },
    { "id": 2, "tasks": ["2.2", "2.6", "3.5", "4.1"] },
    { "id": 3, "tasks": ["2.3", "4.2", "5.1"] },
    { "id": 4, "tasks": ["2.4", "4.3", "3.4", "5.2"] },
    { "id": 5, "tasks": ["2.5", "4.4", "5.4", "5.5", "7.1", "7.2", "9.1", "10.1"] },
    { "id": 6, "tasks": ["5.3", "7.3", "7.4", "9.2", "10.2"] },
    { "id": 7, "tasks": ["12.1"] },
    { "id": 8, "tasks": ["12.2"] }
  ]
}
```
