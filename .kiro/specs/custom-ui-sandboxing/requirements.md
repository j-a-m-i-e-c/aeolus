# Requirements Document

## Introduction

Aeolus lets users author custom UI components (TSX) for automations and panels. The `runtime-custom-ui` spec defines how that TSX is transpiled at save time and loaded at runtime: the backend serves compiled ES modules from `UI_Module_Endpoint` (`GET /api/automations/:id/ui-module` and the panels equivalent), and the frontend `Dynamic_Loader` (`frontend/src/hooks/useDynamicComponent.ts`) fetches the source, rewrites React import specifiers to `window.__AEOLUS_EXTERNALS__` (declared in `frontend/src/main.tsx`), builds a Blob, and calls `import(blobUrl)`.

The problem this spec addresses is a trust-boundary gap in that loading model. Today the imported module executes **directly in the dashboard page context**. Because it runs in the same JavaScript runtime as the rest of the dashboard, custom UI code can read the raw auth token from the Zustand `useAuthStore` (`frontend/src/store/auth-store.ts` exposes `accessToken`), issue authenticated requests as the signed-in user (the same mechanism `authFetch` uses), reach into other components' state, and touch the top-window DOM and browser APIs. The backend automation runtime is genuinely isolated (isolated-vm / V8), but the frontend is not — so any documentation claim that "both sides run in sandboxes" is inaccurate.

This feature adds the **security/isolation layer** on top of the existing runtime loading mechanism. It does not redefine transpilation, storage, the module endpoints, the `CustomComponentProps` contract, or the `CustomComponentBoundary` error boundary — those belong to `runtime-custom-ui` and are referenced, not restated. The target design isolates custom UI in a sandboxed browser context and exposes a minimal, capability-scoped `Aeolus_UI_SDK` over a controlled `RPC_Channel` as the *only* way custom UI interacts with Aeolus. A first-class constraint from the product owner is preserving the current experience: reactive state, the props contract, real-time updates, and styling must continue to work for legitimate components. A defined v1 fallback exists if full isolation is deferred.

## Glossary

- **Custom_UI_Component**: A user-authored TSX component compiled and loaded at runtime per the `runtime-custom-ui` spec. Rendered for an automation rule or a custom panel.
- **Host_Dashboard**: The trusted Aeolus single-page application (React app rooted at `frontend/src/main.tsx`) that holds the auth token in `useAuthStore`, makes authenticated API calls via `authFetch`, and owns the top-level DOM and WebSocket-backed state.
- **Trust_Boundary**: The security boundary that separates trusted Host_Dashboard code from untrusted Custom_UI_Component code. Code on the Host_Dashboard side may hold credentials and call authenticated APIs; code on the Custom_UI_Component side may not.
- **UI_Sandbox**: The isolated browser execution context in which a Custom_UI_Component executes. In v1 this is a sandboxed `<iframe>` configured with `allow-scripts` and deliberately WITHOUT `allow-same-origin`, which causes the browser to assign the iframe a unique opaque origin distinct from the Host_Dashboard origin — no second server, port, subdomain, or DNS entry is required. The compiled UI module is loaded and executed inside this opaque origin (e.g. via `srcdoc`/blob within the iframe). The component therefore has no direct access to the Host_Dashboard JavaScript runtime, `useAuthStore`, `authFetch`, `window.__AEOLUS_EXTERNALS__`, or the Host_Dashboard DOM.
- **Aeolus_UI_SDK**: The capability-scoped API made available to code inside the UI_Sandbox. It is the only interface through which a Custom_UI_Component may read state, persist state, fire logic events, control devices, and receive real-time updates. It exposes no raw auth token and no arbitrary network access.
- **RPC_Channel**: The controlled `postMessage`-based request/response and event channel between the UI_Sandbox and the Host_Dashboard that implements the Aeolus_UI_SDK. The Host_Dashboard side validates every message before acting on it.
- **SDK_Broker**: The Host_Dashboard-side handler that receives RPC_Channel messages, authorizes each requested capability against the specific rule or panel the UI_Sandbox was granted, performs the privileged operation using trusted credentials, and returns results or forwards state updates.
- **CustomComponentProps**: The existing props contract (`frontend/src/components/panes/custom/types.ts`) defining the interface between the Aeolus runtime and Custom_UI_Component code (`read`, `save`, `saveAndFire`, `fire`, `control`, `publish`, `devices`, `history`, `lastFired`, `enabled`, `ruleId`, `ruleName`). Defined by prior specs; referenced here as the surface that must be preserved through the Aeolus_UI_SDK.
- **Compatibility_Shim**: A Host_Dashboard-provided adapter loaded inside the UI_Sandbox that presents the existing CustomComponentProps interface to a Custom_UI_Component while routing every call through the Aeolus_UI_SDK over the RPC_Channel.
- **Trusted_Mode**: An operating posture in which Custom_UI_Component code is treated as authored by the single trusted administrator of the deployment.
- **Untrusted_Mode**: An operating posture in which Custom_UI_Component code may originate from a shared or third-party source (e.g. a marketplace) and must be assumed hostile.
- **Target_Platform**: The Raspberry-Pi-class hardware Aeolus is expected to run on, used as the performance reference for the isolation approach.

## Requirements

### Requirement 1: Trust Boundary and Threat Model

**User Story:** As a security-conscious operator, I want a documented trust boundary that constrains what custom UI code can do, so that a malicious or buggy custom component cannot steal my credentials or act as me.

#### Acceptance Criteria

1. THE Trust_Boundary SHALL be defined such that Custom_UI_Component code executes only within the UI_Sandbox and never within the Host_Dashboard JavaScript runtime.
2. WHERE a Custom_UI_Component attempts to read the raw authentication token, THE UI_Sandbox SHALL prevent access to `useAuthStore`, the `accessToken` value, and any variable holding the token.
3. WHERE a Custom_UI_Component attempts to issue an authenticated network request as the signed-in user, THE UI_Sandbox SHALL prevent access to `authFetch` and to any credential (cookie, header, or token) that would authenticate the request.
4. WHERE a Custom_UI_Component attempts to access the Host_Dashboard DOM or top window, THE UI_Sandbox SHALL restrict the component's DOM access to the UI_Sandbox document only.
5. WHERE a Custom_UI_Component attempts to read or modify the state of another Custom_UI_Component, THE SDK_Broker SHALL scope every state and event operation to the specific rule or panel identifier granted to the requesting UI_Sandbox.
6. THE requirements SHALL enumerate the prohibited capabilities for Custom_UI_Component code as: reading the raw auth token, making arbitrary authenticated requests as the user, exfiltrating credentials, accessing another component's state, and escaping to the Host_Dashboard top window or DOM.

### Requirement 2: Isolated Execution Context

**User Story:** As an operator, I want custom UI to run in an isolated browser context, so that it is technically incapable of reaching the dashboard's runtime, auth store, or DOM.

#### Acceptance Criteria

1. WHEN a Custom_UI_Component is rendered, THE Host_Dashboard SHALL execute the compiled module inside a UI_Sandbox rather than importing it into the Host_Dashboard runtime.
2. THE UI_Sandbox SHALL be an `<iframe>` configured with the `allow-scripts` sandbox token and WITHOUT `allow-same-origin`, so that the browser assigns the iframe a unique opaque origin distinct from the Host_Dashboard origin and the same-origin policy prevents the sandboxed context from scripting the Host_Dashboard.
3. THE UI_Sandbox iframe SHALL NOT be granted the `allow-same-origin` sandbox token, and SHALL NOT be granted any capability that depends on `allow-same-origin`.
4. THE UI_Sandbox iframe SHALL NOT be granted top-level navigation (`allow-top-navigation`), popup (`allow-popups`), or any other sandbox capability that the Custom_UI_Component does not require to render.
5. THE UI_Sandbox SHALL be configured so that code inside it cannot access `window.__AEOLUS_EXTERNALS__`, `useAuthStore`, or any Host_Dashboard global.
6. WHEN the compiled UI module is executed, THE Host_Dashboard SHALL load and run that module INSIDE the UI_Sandbox iframe's opaque origin (e.g. via `srcdoc` or a blob loaded within the iframe) rather than in the Host_Dashboard page.
7. IF a Custom_UI_Component throws during load or execution inside the UI_Sandbox, THEN THE Host_Dashboard SHALL contain the failure within the CustomComponentBoundary fallback and SHALL continue operating.
8. THE UI_Sandbox SHALL restrict outbound network access from within the sandboxed context so that a Custom_UI_Component cannot initiate arbitrary requests to Host_Dashboard APIs or external endpoints, except through the Aeolus_UI_SDK.
9. WHEN the compiled UI module is fetched for sandboxed rendering, THE Host_Dashboard SHALL continue to obtain it from the existing UI_Module_Endpoint defined by the `runtime-custom-ui` spec.
10. WHERE additional isolation hardening is pursued, THE deployment MAY serve the UI_Sandbox host page from a dedicated separate server origin as optional future defense-in-depth against sandbox-escape bugs; this dedicated server origin is explicitly OUT OF SCOPE for v1, and if ever adopted SHALL use a distinct port rather than a subdomain (a subdomain is impractical on a Raspberry-Pi-class Target_Platform accessed by bare IP with no DNS).

### Requirement 3: Capability-Scoped UI SDK

**User Story:** As a custom UI author, I want a small, explicit SDK for talking to Aeolus, so that my component has exactly the access it needs and nothing more.

#### Acceptance Criteria

1. THE Aeolus_UI_SDK SHALL be the only interface through which a Custom_UI_Component interacts with Aeolus.
2. THE Aeolus_UI_SDK SHALL expose an operation to read a state value by key, scoped to the component's own rule or panel.
3. THE Aeolus_UI_SDK SHALL expose an operation to persist a state key-value pair, scoped to the component's own rule or panel.
4. THE Aeolus_UI_SDK SHALL expose an operation to fire a named logic event with an optional payload, scoped to the component's own rule or panel.
5. THE Aeolus_UI_SDK SHALL expose an operation to subscribe to state updates for the component's own rule or panel and to receive those updates as they occur.
6. THE Aeolus_UI_SDK SHALL NOT expose the raw authentication token, `authFetch`, or any general-purpose network request function to the Custom_UI_Component.
7. WHEN a Custom_UI_Component invokes an Aeolus_UI_SDK operation that is not on the exposed capability list, THE SDK_Broker SHALL reject the operation and return an error without performing any privileged action.

### Requirement 4: Controlled RPC Channel

**User Story:** As a platform maintainer, I want all sandbox-to-host communication to go through one validated channel, so that the host is never tricked into performing an unauthorized action.

#### Acceptance Criteria

1. THE RPC_Channel SHALL carry all Aeolus_UI_SDK requests, responses, and events between the UI_Sandbox and the Host_Dashboard using `postMessage`.
2. WHEN the SDK_Broker receives a message on the RPC_Channel, THE SDK_Broker SHALL verify that the message originates from the expected UI_Sandbox before acting on it.
3. WHEN the SDK_Broker receives a message on the RPC_Channel, THE SDK_Broker SHALL validate the message against the known Aeolus_UI_SDK operation schema before acting on it.
4. IF a message received on the RPC_Channel fails origin or schema validation, THEN THE SDK_Broker SHALL discard the message and SHALL NOT perform any privileged operation.
5. WHEN the SDK_Broker performs a privileged operation on behalf of a UI_Sandbox, THE SDK_Broker SHALL use the Host_Dashboard's trusted credentials and SHALL constrain the operation to the rule or panel identifier associated with that UI_Sandbox.
6. THE SDK_Broker SHALL return the result or a structured error to the originating UI_Sandbox for every well-formed request.

### Requirement 5: Experience Parity

**User Story:** As a custom UI author, I want my components to behave exactly as they do today, so that sandboxing improves security without degrading the authoring or runtime experience.

#### Acceptance Criteria

1. THE Aeolus_UI_SDK SHALL provide functional equivalents for the existing CustomComponentProps operations `read`, `save`, `saveAndFire`, `fire`, `control`, and `publish`.
2. WHEN a state value that a Custom_UI_Component subscribes to changes via the WebSocket-backed state, THE Host_Dashboard SHALL deliver the updated value to the UI_Sandbox so that the component re-renders reactively.
3. THE Host_Dashboard SHALL supply the Custom_UI_Component with the props data defined in CustomComponentProps (including `devices`, `history`, `lastFired`, `enabled`, `ruleId`, and `ruleName`) through the Aeolus_UI_SDK.
4. THE UI_Sandbox SHALL render the Custom_UI_Component with its authored styling preserved.
5. WHEN a Custom_UI_Component persists state through the Aeolus_UI_SDK, THE observable result (persistence and broadcast) SHALL match the behavior of the current `save` and `saveAndFire` operations.
6. THE requirements SHALL define "same experience" as the measurable set: reactive re-render on subscribed state change, availability of all CustomComponentProps data, equivalent state-write and fire behavior, and preserved component styling.

### Requirement 6: Backward Compatibility and Migration

**User Story:** As an existing user, I want the custom components I already authored to keep working, so that enabling sandboxing does not force me to rewrite them.

#### Acceptance Criteria

1. THE Compatibility_Shim SHALL present the existing CustomComponentProps interface to a Custom_UI_Component while routing every call through the Aeolus_UI_SDK over the RPC_Channel.
2. WHEN an existing Custom_UI_Component authored against the current CustomComponentProps is loaded, THE Host_Dashboard SHALL run it inside the UI_Sandbox via the Compatibility_Shim without requiring source changes, OR THE requirements SHALL define an explicit migration path for that component.
3. WHERE a defined migration path is required for a Custom_UI_Component, THE migration path SHALL be documented with the specific source changes an author must make.
4. THE requirements SHALL state the trust model that applies during the transition period, including whether unmigrated components run in Trusted_Mode or Untrusted_Mode.

### Requirement 7: Performance on Constrained Hardware

**User Story:** As a Raspberry Pi user, I want sandboxing to run acceptably on my hardware, so that isolation does not make the dashboard sluggish.

#### Acceptance Criteria

1. THE isolation approach SHALL be validated as acceptable for the Target_Platform with respect to the number of concurrent UI_Sandbox instances a dashboard view creates.
2. THE requirements SHALL define an acceptable upper bound on RPC_Channel messaging overhead for state updates on the Target_Platform.
3. WHEN multiple Custom_UI_Component instances are displayed simultaneously, THE Host_Dashboard SHALL manage UI_Sandbox instances so that resource usage remains within the Target_Platform bound defined for concurrent sandboxes.
4. WHEN a Custom_UI_Component is removed from view, THE Host_Dashboard SHALL release the associated UI_Sandbox and its RPC_Channel resources.

### Requirement 8: Trusted versus Untrusted Operating Modes

**User Story:** As an operator, I want the isolation strength to reflect whether custom UI is self-authored or shared, so that single-admin setups stay simple while shared setups stay safe.

#### Acceptance Criteria

1. THE requirements SHALL distinguish Trusted_Mode (single-admin, self-authored components) from Untrusted_Mode (shared or third-party components).
2. WHILE operating in Untrusted_Mode, THE Host_Dashboard SHALL enforce full UI_Sandbox isolation and the Aeolus_UI_SDK capability restrictions for every Custom_UI_Component.
3. WHERE the deployment operates in Trusted_Mode, THE Host_Dashboard SHALL apply the isolation posture defined for Trusted_Mode as specified in the design.
4. THE requirements SHALL identify Untrusted_Mode (shared/marketplace usage) as the scenario that drives the need for full isolation.

### Requirement 9: V1 Fallback Position

**User Story:** As a product owner, I want a defined fallback if full isolation cannot ship in v1, so that we never leave an inaccurate security claim in place while isolation is pending.

#### Acceptance Criteria

1. THE full UI_Sandbox isolation with the Aeolus_UI_SDK SHALL be the target design.
2. IF full UI_Sandbox isolation is deferred past v1, THEN THE requirements SHALL support formally designating Custom_UI_Component code as trusted-administrator code.
3. WHERE Custom_UI_Component code is designated as trusted-administrator code, THE documentation SHALL state that custom UI runs with dashboard-level privileges and is not isolated from the auth token, authenticated requests, or the DOM.
4. WHEN the trusted-administrator fallback is adopted, THE documentation SHALL be corrected to remove any claim that custom UI runs in a sandbox.

### Requirement 10: Documentation Accuracy

**User Story:** As a reader of the Aeolus docs, I want statements about UI sandboxing to match the actual behavior, so that I can make correct security decisions.

#### Acceptance Criteria

1. THE documentation SHALL describe the isolation posture of Custom_UI_Component code in a way that matches the shipped behavior.
2. IF the shipped behavior does not isolate Custom_UI_Component code from the auth token, authenticated requests, or the DOM, THEN THE documentation SHALL NOT claim that custom UI is sandboxed.
3. WHEN the UI_Sandbox isolation is shipped, THE documentation SHALL describe the Trust_Boundary, the Aeolus_UI_SDK capability surface, and the prohibited capabilities defined in Requirement 1.
4. THE documentation SHALL accurately distinguish the backend automation isolation (isolated-vm, out of scope for this spec) from the frontend Custom_UI_Component isolation defined here.

### Requirement 11: Content Security Policy Hardening

**User Story:** As a security-conscious operator, I want the dashboard's Content Security Policy tightened once custom UI runs only inside the UI_Sandbox, so that the Host_Dashboard page itself can no longer execute dynamically-generated user code.

#### Acceptance Criteria

1. WHEN Custom_UI_Component code executes only inside the UI_Sandbox and no longer in the Host_Dashboard page, THE Host_Dashboard document's CSP `script-src` directive SHALL remove `'unsafe-eval'` and `blob:` (the directives in `frontend/nginx.conf` that currently permit the in-page `import(blobUrl)` loader) so that the Host_Dashboard can no longer execute dynamically-generated code.
2. THE Host_Dashboard CSP SHALL retain only the directives required for the Host_Dashboard's own legitimate operation, and the `worker-src 'self' blob:` directive needed for Monaco workers SHALL be evaluated separately from `script-src`, because the tightening targets `script-src` execution of user code and not worker sourcing.
3. THE UI_Sandbox document SHALL be served with its own CSP scoped to what a Custom_UI_Component legitimately needs to render (permitting execution of the compiled component module within the opaque origin) while restricting network egress, such that the Aeolus_UI_SDK over the RPC_Channel remains the sanctioned interaction path.
4. THE `frontend/nginx.conf` CSP SHALL be updated to implement the tightened Host_Dashboard `script-src` and the UI_Sandbox CSP, and `frontend/nginx.conf` SHALL be the location of the change.
5. IF removing `'unsafe-eval'` or `blob:` from the Host_Dashboard `script-src` would break a legitimate Host_Dashboard feature (e.g. Monaco), THEN THE feature's need SHALL be satisfied by a narrower CSP directive rather than by re-permitting arbitrary `eval` of user code in `script-src`.
