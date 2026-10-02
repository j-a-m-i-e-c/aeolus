# ADR-0023: Public showcase restrictions belong at the backend boundary

- **Status:** Accepted (retrospective)
- **Date:** 2026-09-30

## Context

Aeolus's hosted public showcase must let visitors inspect and try bounded interactions without acquiring administrative powers or changing the shared demonstration for other visitors. A hidden button or read-only React component is trivial to bypass with a direct HTTP request; a globally read-only API would prevent useful demonstrations. The unrestricted local showcase and hardened hosted public showcase serve different purposes.

## Decision

Issue a constrained **public-demo session** with a distinct session claim; never expose the normal admin refresh cookie to anonymous visitors. Install an additive, fail-closed public-demo guard after authentication and before route handlers. Only specifically allowlisted requests proceed, and mutation routes receive narrowly scoped server-side validators. Even an allowlisted request still faces normal resource authorization; the demo guard cannot grant rights the caller did not otherwise have. The frontend hides or locally simulates disallowed operations for usability, but it is not the security boundary.

The public-demo deployment is a deliberate launch-time mode; it is not a runtime toggle of the normal production installation. The local showcase remains unrestricted, and its simulator/seed assets are separate from the generic product.

## Alternatives considered

- **Hide privileged controls in the frontend:** no protection against API clients.
- **Use a real admin identity shared among visitors:** total compromise of the demo's trust boundary.
- **Copy/fork product endpoints into demo-only handlers:** duplicates security semantics and makes drift likely.
- **Disable every mutation:** sacrifices the interactive aspects of the showcase.

## Consequences

Every newly exposed endpoint must be considered explicitly in the public-demo policy: default is deny. Test representative direct HTTP bypasses, payload bounding and standard authorization together. Build-time frontend demo configuration and backend demo configuration must agree. This ADR records the security envelope; ADR-0024 explains reproducible state and reset mechanics.

## Revisit when

Public visitors receive private workspaces, per-visitor persistent databases or authenticated personal accounts rather than sharing a demonstrator.

## Implementation anchors

- `src/demo/public-demo-guard.ts`
- `src/demo/demo-policy.ts`
- `src/demo/demo-validators.ts`
- `src/__integration__/public-demo.integration.test.ts`
- `demo/compose/hosted-runtime.yml`
- `demo/README.md`
- [ADR-0024](0024-reproducible-demo-and-reset.md)
