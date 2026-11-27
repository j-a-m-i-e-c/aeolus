# ADR-0020: Separate outbound HTTP trust boundaries for authored code and connectors

- **Status:** Accepted (retrospective)
- **Date:** 2026-09-30

## Context

Aeolus must reach private LAN devices through its trusted connector implementations, while automation authors can also request HTTP or configure generic webhooks. Giving these two callers identical unrestricted network access would turn authored scripts into a way to contact routers, host infrastructure, metadata endpoints and otherwise private services. Simply disallowing all egress would rule out legitimate cloud API automations.

## Decision

Use a **shared bounded public-HTTP policy** for authored HTTP and general outbound webhook actions, distinct from deliberately configured trusted connector networking. Parse destinations; permit HTTP(S) only; reject URL-embedded credentials; reject private, loopback, link-local, reserved and other non-public IP destinations. Resolve hostnames and reject them if any DNS answer is non-public, at the moment the connection is made. Enforce bounded body sizes, response sizes and timeouts; do not automatically follow redirects. Connectors retain their ability to reach operator-configured LAN hardware because their implementation and configuration path are trusted separately.

Timeouts are bounded per request, not fixed. The default is 10 seconds. Authored code may request a longer or shorter one with `timeoutMs`, which the host clamps to 1–25 seconds (`resolveOutboundTimeoutMs`): the ceiling keeps a single request inside the 30-second completion budget of an automation run, because a request still waiting when the run ends is abandoned with it. Some public services take longer than 10 seconds to answer even a small query, and a fixed limit made them unusable rather than safer. Webhook actions are configured data rather than code and keep the default. A timeout is reported as `Outbound request timed out after N ms` rather than the transport's bare abort message.

**Connection-time enforcement (hardening H1).** The original implementation checked DNS answers before calling `fetch()`, which resolved the name again when it connected, so a rebinding DNS answer could reach a private address (DNS rebinding / TOCTOU; reproduced against the old code). Requests now go through `src/security/guarded-request.ts` on `node:http`/`node:https`. The name is resolved once, inside the `lookup` hook that `net.connect` calls: every answer is checked there and only checked addresses are dialled. IP literals are checked before connecting, and the connected socket's address is checked again. TLS verification is Node's default against the URL host. Each request sets its own dual-stack attempts (2.5 s per address) and connection deadline (5 s, never longer than the request timeout); nothing process-wide changes; sockets are not pooled and environment proxies are not used. The policy is a required argument: authored code and webhooks use the public-only policy, and the Aeolus Remote connector uses its own configured-peer policy through the same core, so neither inherits the other's reach.

This remains an **application egress boundary**, not a network sandbox: it governs what Aeolus's own HTTP clients dial. A deployment that needs a hard guarantee against every process on the host must still enforce egress at the network layer.

## Alternatives considered

- **Unrestricted `fetch` everywhere:** easy for connector authors, unsafe for user-authored code.
- **Block all external HTTP:** strong isolation but eliminates useful integrations.
- **Treat every RFC1918 request as safe because the Pi is local:** inverts the intended trust boundary; the operator's local infrastructure is precisely what authored code must not reach by default.
- **Implement independent rules in each automation/webhook caller:** policies would diverge and a new call site could accidentally omit a critical check.

## Consequences

There is a deliberate asymmetry: a Hue connector can contact a configured bridge on the LAN, while a generic authored request cannot use that same network path. The shared policy must remain covered by tests for DNS mixed answers, mapped IPv6, redirect handling, oversized bodies and timeouts, including the clamp on an authored `timeoutMs` and that the ceiling stays below the run's completion budget. Do not weaken it for one connector's convenience; expose a named trusted connector integration instead. Review whether network-level egress enforcement is needed before supporting untrusted third-party project packages (ADR-0012).

## Revisit when

Aeolus supports vetted private-network HTTP grants, untrusted third-party package distribution, or host-network isolation that can provide stronger connection-time guarantees.

## Implementation anchors

- `src/security/outbound-http.ts`
- `src/security/guarded-request.ts` (connection-time enforcement, shared with the Aeolus Remote connector)
- `src/security/outbound-http.test.ts`
- `src/__integration__/sandbox-http-timeout.integration.test.ts` (authored `timeoutMs` across the real isolate boundary)
- `src/connectors/`
- [ADR-0012](0012-automation-project-portability.md)
