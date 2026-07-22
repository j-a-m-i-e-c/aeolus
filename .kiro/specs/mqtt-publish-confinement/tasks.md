# Implementation Plan: MQTT Publish Confinement

## Overview

This plan confines the raw publish endpoint (`POST /api/mqtt/publish`) by
partitioning the topic space. Work is bottom-up: the pure `Publish_Policy`
module and its config first, then `retain` support in `MqttService.publish` and
the 413 error type, then the request schema and route wiring, then the
composition root that derives the reserved namespace from the ack filter, and
finally documentation. Enforcement lives only at the HTTP boundary, so internal
publishers are untouched.

Property tests use **fast-check** with a minimum of **100 iterations**, follow
`src/core/device-registry.property.test.ts`, and are tagged
`// Feature: mqtt-publish-confinement, Property N: <text>`. Test sub-tasks are
marked optional with `*`.

## Tasks

- [ ] 1. Add publish-policy configuration
  - [ ] 1.1 Extend `src/config.ts` with an `mqttPublish` block
    - Add `mqttPublish: { userNamespacePrefix: string; maxPayloadBytes: number }` to `Config`
    - Defaults from env: `MQTT_PUBLISH_USER_NAMESPACE` → `"aeolus/pub/"`, `MQTT_PUBLISH_MAX_BYTES` → `262144`
    - _Requirements: 8.1_

- [ ] 2. Implement the pure Publish_Policy module
  - [ ] 2.1 Create `src/mqtt/publish-policy.ts`
    - Export `TopicClass`, `PublishPolicyConfig`, `PublishDecision`
    - `segmentBoundaryMatch(topic, prefix)`: normalize trailing `/`, match `topic === base || topic.startsWith(base + "/")`
    - `classifyTopic(topic, config)`: reserved-system precedence over user-namespace, else other
    - `isPolicyConfigValid(config)`: false when the user namespace falls within any reserved prefix (segment-boundary)
    - `evaluatePublish({ role, topic, retain, payloadBytes }, config)`: order = wildcard→400; invalid config→non-admin 403; reserved-system→403; non-admin & other→403; non-admin & retain→403; payloadBytes>max→413; else allow
    - Pure and dependency-free
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 3.1, 3.2, 3.3, 4.1, 4.2, 5.2, 5.3, 6.1, 6.2, 7.3, 8.3_
  - [ ]* 2.2 Write property tests `src/mqtt/publish-policy.property.test.ts` (Properties 1–10)
    - **Property 1** classification precedence/determinism — Validates 1.1,1.2,1.3,1.4,1.6
    - **Property 2** segment-boundary matching — Validates 1.5
    - **Property 3** reserved-system denied for all roles — Validates 2.1,2.2,2.3
    - **Property 4** non-admin confinement — Validates 3.1,3.2,3.3
    - **Property 5** admin latitude — Validates 4.1,4.2
    - **Property 6** retain guardrail — Validates 5.2,5.3
    - **Property 7** payload size guardrail — Validates 6.1,6.2
    - **Property 8** wildcard rejection — Validates 7.3
    - **Property 9** fail-closed on invalid config — Validates 8.3
    - **Property 10** decision independent of request-supplied hints — Validates 1.6
  - [ ]* 2.3 Write unit tests `src/mqtt/publish-policy.test.ts`
    - `segmentBoundaryMatch("aeolus/public/x", "aeolus/pub")` is false; classification precedence; each decision branch
    - _Requirements: 1.5, 2.1, 3.2, 5.2, 6.2, 7.3_

- [ ] 3. Add retain support and the 413 error type
  - [ ] 3.1 Add `retain?: boolean` to `MqttService.publish` options
    - Pass `{ retain: options?.retain ?? false, properties }` to `client.publish`; existing callers unaffected
    - _Requirements: 5.3, 5.4, 9.1_
  - [ ] 3.2 Add `PayloadTooLargeError` (HTTP 413) to `src/api/middleware/error-handler.ts`
    - Follow the existing typed-error pattern so the error handler renders a consistent JSON body
    - _Requirements: 6.2, 7.5_
  - [ ]* 3.3 Write a unit test for retain plumbing
    - Assert `client.publish` receives `retain: true` only when requested, and `retain: false`/absent otherwise
    - _Requirements: 5.3, 5.4_

- [ ] 4. Add the request schema and wire the route
  - [ ] 4.1 Create `src/api/schemas/mqtt.schemas.ts` with `publishBodySchema`
    - `{ topic: z.string().trim().min(1), payload: z.unknown().optional(), retain: z.boolean().optional() }`
    - _Requirements: 7.1, 7.2_
  - [ ] 4.2 Update `createMqttRoutes` in `src/api/routes/mqtt.routes.ts`
    - Add a `PublishPolicyConfig` parameter; remove `requireTabPermission("interact")` from the route
    - Apply `validate({ body: publishBodySchema })`; serialize payload as today and compute `Buffer.byteLength`
    - Call `evaluatePublish({ role: req.user.role, topic, retain: retain ?? false, payloadBytes }, policyConfig)`; map `400/403/413` to the typed errors; log `{ userId, role, topic, reason }` at warn on any denial
    - On allow, call `mqttService.publish(topic, message, { retain })`
    - _Requirements: 2.1, 2.4, 3.1, 3.2, 3.4, 4.1, 4.2, 5.2, 5.3, 6.2, 7.4, 7.5, 9.2, 9.3_
  - [ ]* 4.3 Extend `src/api/routes/mqtt.routes.test.ts`
    - non-admin allowed in `aeolus/pub/#`; non-admin 403 on `other` and `aeolus/acks/#`; admin 403 on `aeolus/acks/#`, allowed on `home/...`; non-admin `retain` → 403; admin `retain` → publishes with retain; oversized → 413; wildcard → 400; missing topic → 400; publish not called on denial
    - _Requirements: 2.1, 2.3, 3.1, 3.2, 4.1, 4.2, 5.2, 5.3, 6.2, 7.3_

- [ ] 5. Wire the composition root
  - [ ] 5.1 Assemble `PublishPolicyConfig` in `src/index.ts` and pass it to `createMqttRoutes`
    - Derive `reservedSystemPrefixes` by stripping the trailing `/#` from the same `ackTopicFilter` given to `MqttService` (default `aeolus/acks/#` → `aeolus/acks/`), so the denied namespace tracks the ingested ack namespace
    - Build `{ userNamespacePrefix, reservedSystemPrefixes, maxPayloadBytes }` from `config.mqttPublish` + the ack prefix
    - Update `src/__test-helpers__/app-factory.ts` if it mounts the MQTT routes, so existing suites keep compiling
    - _Requirements: 8.1, 8.2_

- [ ] 6. Checkpoint — enforcement complete
  - Ensure `npx tsc --noEmit`, lint, and the full backend suite pass; ask the user if questions arise

- [ ] 7. Documentation
  - [ ] 7.1 Update `docs/security/mqtt.md`
    - Document the user namespace (`aeolus/pub/`), the reserved-system denial (all roles), the retain and payload guardrails, and the status codes
    - _Requirements: 2.1, 3.1, 5.2, 6.2_

## Notes

- Tasks marked `*` are optional test sub-tasks; core implementation sub-tasks are never optional.
- Confinement is enforced only at the HTTP endpoint; `MqttService.publish` semantics for internal callers are unchanged.
- The reserved-system prefix is derived from the ack topic filter at composition so it cannot drift from the forged-ack surface.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "3.1", "3.2"] },
    { "id": 1, "tasks": ["2.2", "2.3", "3.3", "4.1"] },
    { "id": 2, "tasks": ["4.2"] },
    { "id": 3, "tasks": ["4.3", "5.1"] },
    { "id": 4, "tasks": ["6", "7.1"] }
  ]
}
```
