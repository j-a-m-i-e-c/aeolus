# ADR-0005: Opaque-origin iframe plus capability-scoped host RPC for custom UI

- **Status:** Accepted
- **Date:** 2026-08-28

## Context

Automation Projects can provide custom React UI. Rendering administrator-authored source directly in the main dashboard document would give that code access to the dashboard DOM and any browser state available to the application.

Custom UI still needs useful capabilities such as reading automation state, controlling permitted devices and publishing through Aeolus.

## Decision

Render custom UI in a sandboxed iframe using `sandbox="allow-scripts"` without `allow-same-origin`, giving the frame an opaque origin. The frame does not receive Aeolus authentication tokens. It communicates with the host through a MessageChannel/RPC SDK, and the host broker decides which operations are allowed.

## Why this fits Aeolus

The iframe provides a browser-native origin/DOM boundary while preserving rich React UI. A host-owned RPC layer means the iframe asks Aeolus to perform operations rather than holding direct credentials or a generic network bridge.

This mirrors the backend Logic design: authored code receives capabilities, not internal application authority.

## Alternatives considered

### Render custom React components directly in the dashboard tree

This is simple and fast, but gives authored code direct access to the host DOM and application runtime. It is unsuitable for a platform that treats custom UI as a bounded extension surface.

### Serve every custom UI from a separate real origin

A separate origin is a strong browser boundary, but requires per-project hosting/routing and complicates local-first deployment. Opaque-origin sandboxed frames provide the needed boundary without another web service.

### No custom code, fixed dashboard widgets only

This would reduce security complexity but remove a major Aeolus differentiator: automations can expose purpose-built operator interfaces.

## Consequences

### Positive

- Custom UI cannot directly read the dashboard DOM or token store.
- The host owns all privileged operations.
- Rich React/TSX UI remains possible.
- The same capability broker can enforce public-demo read-only behaviour.

### Negative / accepted trade-offs

- RPC and iframe lifecycle are more complex than direct React rendering.
- The host broker is a sensitive confused-deputy boundary: a UI authored by one person can request actions under the viewer's authority unless capabilities are narrowed further.
- Browser integration requires real-iframe end-to-end tests, not only jsdom unit tests.

## Revisit when

Reconsider the grant model before allowing untrusted third-party UI authors. At that point, add an explicit capability manifest per project/frame rather than relying mainly on viewer authority and automation identity.

## Implementation anchors

- `frontend/src/sandbox/`
- `frontend/sandbox.html`
- `docs/reference/automations.md`
- `docs/security/permissions.md`
