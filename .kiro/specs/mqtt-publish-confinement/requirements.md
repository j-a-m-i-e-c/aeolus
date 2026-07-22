# Requirements Document

## Introduction

Aeolus is a local-first IoT/automation platform for small, mostly-trusted deployments (a household, farm, or single site). It exposes a raw MQTT publish endpoint, `POST /api/mqtt/publish`, that lets an authenticated user publish an arbitrary topic and payload directly to the broker.

Today that endpoint is gated only by `requireTabPermission("interact")` and forwards any caller-supplied topic straight to `MqttService.publish`. It accepts `{ topic, payload }`, performs no namespace checks, does not bound payload size, and does not model the MQTT `retain` flag. As a result, any non-admin holding `interact` on any tab can publish to any topic, bypassing the command lifecycle and connector validation. Two concrete problems follow, matched to the platform's threat model:

- **Accidental cross-tab device operation.** A curious or mistaken user can drive devices they were never granted, because raw publish is unconstrained by the resource-level authorization boundary that now governs device and automation routes.
- **A truthfulness footgun (forged acknowledgements).** The backend subscribes to an acknowledgement namespace (`aeolus/acks/#`) and routes any message there to the `PendingCommandTracker`, which marks a pending command `ACKNOWLEDGED` based on the message's `correlationId` and `status`. A user can publish to `aeolus/acks/#` and forge a device acknowledgement, making a command look confirmed when the device never acted.

This feature confines the raw publish endpoint by **partitioning the topic space**, rather than locking raw publish behind admin-only. Non-admin publishes are confined to a reserved user namespace (`aeolus/pub/`), keeping raw publish useful for driving automations that deliberately listen there while making user-originated traffic unambiguous to humans, automations, and future broker ACLs. A reserved system-namespace denylist (starting with the acknowledgement namespace) is refused for every role, closing the forged-ack surface. Admins retain broad publish latitude for diagnostics, still subject to the system-namespace denylist. Guardrails bound payload size and forbid non-admins from setting `retain` (which would plant a persistent fake state).

**Threat model context:** The target is small local-first deployments with a handful of mostly-trusted users, not a large multi-tenant public SaaS. The goal is to make user-originated MQTT traffic bounded and unambiguous, prevent accidental cross-scope device operation, and eliminate the forged-acknowledgement truthfulness violation. Priorities are correctness of the advertised trust model first, hardening against determined insiders second.

**Design foundation:** This builds on the resource-level-authorization work: role semantics (`admin` vs `user`) and `req.user` are unchanged, and confinement is enforced at the HTTP endpoint boundary. It does not alter `MqttService.publish` itself, so internal publishers (the `CommandService` dispatching device commands, the acknowledgement responders, connectors) are unaffected.

**In scope:**
- Server-side classification of a publish topic into reserved-system, user-namespace, or other.
- Confinement of non-admin raw publishes to the reserved user namespace.
- A reserved system-namespace denylist refused for all roles (initially the acknowledgement namespace).
- Admin publish latitude outside the user namespace, still subject to the system denylist.
- Guardrails: a maximum payload size for all publishes, and rejection of the `retain` flag for non-admins.
- Request validation (schema) and consistent, distinguishable error responses.
- Audit logging of denied publishes.
- Configuration of the user-namespace prefix, the reserved system prefixes, and the payload cap, with a fail-closed invariant that the user namespace never falls inside a reserved system prefix.

**Out of scope:**
- Broker-level ACLs (Mosquitto per-credential topic ACLs). The `aeolus/pub/` prefix is chosen to make these trivial later, but wiring them is separate.
- WebSocket fail-closed visibility filtering — a separate critical backlog item.
- Routing raw device commands through the command lifecycle, or removing the raw publish endpoint. This feature bounds raw publish; it does not replace it.
- Changing `MqttService.publish` semantics for internal (non-HTTP) callers.
- Retain/QoS support for internal command dispatch beyond what the endpoint needs.

## Glossary

- **Aeolus**: The local-first IoT/automation platform being secured.
- **Raw_Publish_Endpoint**: The HTTP route `POST /api/mqtt/publish` that publishes a caller-supplied topic and payload to the MQTT broker.
- **User**: An authenticated principal with a role (`admin` or `user`).
- **Admin**: A User whose role is `admin`.
- **Non_Admin**: A User whose role is `user`.
- **Publish_Topic**: The MQTT topic string a caller asks the Raw_Publish_Endpoint to publish to.
- **Publish_Request**: The body submitted to the Raw_Publish_Endpoint: a `topic`, an optional `payload`, and an optional `retain` flag.
- **User_Namespace**: The reserved topic subtree Non_Admin publishes are confined to, identified by a configured prefix (default `aeolus/pub/`).
- **Reserved_System_Namespace**: A configured set of topic prefixes that no role may publish to through the Raw_Publish_Endpoint. It initially contains the Acknowledgement_Namespace and never overlaps the User_Namespace.
- **Acknowledgement_Namespace**: The response-topic subtree Aeolus consumes for device acknowledgements (default `aeolus/acks/`), whose messages are routed to the pending-command tracker. It is a member of the Reserved_System_Namespace.
- **Topic_Classifier**: The server-side component that classifies a Publish_Topic as `reserved-system`, `user-namespace`, or `other`, using segment-boundary prefix matching against the configured prefixes.
- **Topic_Class**: The classification result: `reserved-system`, `user-namespace`, or `other`.
- **Payload_Size_Limit**: The configured maximum byte length of a serialized publish payload.
- **Retain_Flag**: The optional MQTT `retain` flag on a Publish_Request; when true, the broker stores the message as the last-known value for the topic.
- **Segment_Boundary_Match**: A prefix match that only succeeds when the prefix aligns with an MQTT topic level boundary — `aeolus/pub` matches `aeolus/pub` and `aeolus/pub/x` but not `aeolus/public/x`.

## Requirements

### Requirement 1: Server-side topic classification

**User Story:** As a security reviewer, I want every raw publish topic classified server-side against configured namespaces, so that authorization decisions derive from the topic itself and cannot be influenced by caller-supplied role or tab claims.

#### Acceptance Criteria

1. THE Topic_Classifier SHALL classify a Publish_Topic as exactly one Topic_Class: `reserved-system`, `user-namespace`, or `other`.
2. WHEN a Publish_Topic matches any Reserved_System_Namespace prefix by Segment_Boundary_Match, THE Topic_Classifier SHALL classify it as `reserved-system`, regardless of whether it also matches the User_Namespace prefix.
3. WHEN a Publish_Topic matches the User_Namespace prefix by Segment_Boundary_Match AND does not match any Reserved_System_Namespace prefix, THE Topic_Classifier SHALL classify it as `user-namespace`.
4. WHEN a Publish_Topic matches neither the User_Namespace prefix nor any Reserved_System_Namespace prefix, THE Topic_Classifier SHALL classify it as `other`.
5. THE Topic_Classifier SHALL match prefixes only at MQTT topic-level boundaries, so that a prefix `aeolus/pub` matches `aeolus/pub` and `aeolus/pub/...` but does not match `aeolus/public/...`.
6. THE Topic_Classifier SHALL derive the Topic_Class solely from the Publish_Topic and the server-side configured prefixes, and SHALL NOT read any role, tab, or namespace hint from the request body, params, or query.

### Requirement 2: Reserved system namespace is denied for all roles

**User Story:** As a security reviewer, I want publishes to reserved system namespaces refused for every role, so that no user — admin or not — can forge an acknowledgement or inject into Aeolus's control plane through the raw publish endpoint.

#### Acceptance Criteria

1. IF a Publish_Topic classifies as `reserved-system`, THEN THE Raw_Publish_Endpoint SHALL reject the request with HTTP status 403 and SHALL NOT call the publish path.
2. THE Raw_Publish_Endpoint SHALL apply the `reserved-system` denial to Admin requests identically to Non_Admin requests.
3. THE Reserved_System_Namespace SHALL include the Acknowledgement_Namespace, so that a publish to any topic under the acknowledgement subtree is refused for every role.
4. WHEN the Raw_Publish_Endpoint rejects a `reserved-system` publish, THE Raw_Publish_Endpoint SHALL record a log entry identifying the User and the rejected Publish_Topic.

### Requirement 3: Non-admin confinement to the user namespace

**User Story:** As a security reviewer, I want non-admin raw publishes confined to the reserved user namespace, so that user-originated traffic is bounded and unambiguous and cannot drive arbitrary topics.

#### Acceptance Criteria

1. IF a Non_Admin submits a Publish_Request whose Publish_Topic classifies as `user-namespace`, THEN THE Raw_Publish_Endpoint SHALL allow the publish (subject to the guardrails in Requirements 5 and 6).
2. IF a Non_Admin submits a Publish_Request whose Publish_Topic classifies as `other`, THEN THE Raw_Publish_Endpoint SHALL reject the request with HTTP status 403.
3. IF a Non_Admin submits a Publish_Request whose Publish_Topic classifies as `reserved-system`, THEN THE Raw_Publish_Endpoint SHALL reject the request with HTTP status 403 (per Requirement 2).
4. WHEN the Raw_Publish_Endpoint rejects a Non_Admin publish for being outside the User_Namespace, THE Raw_Publish_Endpoint SHALL record a log entry identifying the User and the rejected Publish_Topic.

### Requirement 4: Admin publish latitude

**User Story:** As an administrator, I want to publish outside the user namespace for diagnostics, so that I can operate and troubleshoot the broker without being confined to the user namespace, while still being blocked from the control plane.

#### Acceptance Criteria

1. IF an Admin submits a Publish_Request whose Publish_Topic classifies as `user-namespace` or `other`, THEN THE Raw_Publish_Endpoint SHALL allow the publish (subject to the guardrails in Requirements 5 and 6).
2. IF an Admin submits a Publish_Request whose Publish_Topic classifies as `reserved-system`, THEN THE Raw_Publish_Endpoint SHALL reject the request with HTTP status 403 (per Requirement 2).

### Requirement 5: Retain flag guardrail

**User Story:** As a security reviewer, I want the retain flag forbidden for non-admins, so that a user cannot plant a persistent fake state that the broker replays to future subscribers.

#### Acceptance Criteria

1. THE Raw_Publish_Endpoint SHALL accept an optional boolean Retain_Flag on the Publish_Request, defaulting to false when absent.
2. IF a Non_Admin submits a Publish_Request with the Retain_Flag set to true, THEN THE Raw_Publish_Endpoint SHALL reject the request with HTTP status 403 and SHALL NOT publish.
3. WHEN an Admin submits an allowed Publish_Request with the Retain_Flag set to true, THE Raw_Publish_Endpoint SHALL publish the message with the broker retain option set.
4. WHEN any allowed Publish_Request omits the Retain_Flag or sets it to false, THE Raw_Publish_Endpoint SHALL publish the message without the broker retain option.

### Requirement 6: Payload size guardrail

**User Story:** As an operator, I want a bound on raw publish payload size, so that a single request cannot push an unreasonably large message onto the broker.

#### Acceptance Criteria

1. THE Raw_Publish_Endpoint SHALL enforce a configurable Payload_Size_Limit on the serialized publish payload for every role.
2. IF the serialized payload of a Publish_Request exceeds the Payload_Size_Limit, THEN THE Raw_Publish_Endpoint SHALL reject the request with HTTP status 413 and SHALL NOT publish.
3. WHEN a Publish_Request's serialized payload is within the Payload_Size_Limit, THE Raw_Publish_Endpoint SHALL treat the payload as it does today (a string payload is published verbatim; a non-string payload is JSON-serialized).

### Requirement 7: Publish request validation

**User Story:** As a developer, I want the publish request validated with a schema, so that malformed or hostile inputs are rejected consistently before any authorization or publish logic runs.

#### Acceptance Criteria

1. THE Raw_Publish_Endpoint SHALL validate the Publish_Request body against a schema that requires a non-empty string `topic`, an optional `payload`, and an optional boolean `retain`.
2. IF the `topic` is missing, empty, whitespace-only, or not a string, THEN THE Raw_Publish_Endpoint SHALL reject the request with HTTP status 400.
3. IF the Publish_Topic contains an MQTT wildcard character (`+` or `#`), THEN THE Raw_Publish_Endpoint SHALL reject the request with HTTP status 400, because publishing to a wildcard topic is invalid.
4. THE Raw_Publish_Endpoint SHALL evaluate request validation (Requirement 7) before namespace authorization (Requirements 2–4), so that a malformed request yields 400 rather than 403.
5. WHEN the Raw_Publish_Endpoint rejects a request for validation, authorization, retain, or size reasons, THE Raw_Publish_Endpoint SHALL return a distinguishable error (400 for validation, 403 for authorization/retain, 413 for size) with a JSON error body consistent with the rest of the API.

### Requirement 8: Configuration and fail-closed namespace invariant

**User Story:** As an operator, I want the namespaces and payload cap configurable with a safe default, so that the confinement can be tuned without code changes and a misconfiguration cannot silently open the control plane.

#### Acceptance Criteria

1. THE Raw_Publish_Endpoint SHALL obtain the User_Namespace prefix, the Reserved_System_Namespace prefixes, and the Payload_Size_Limit from server-side configuration, defaulting to `aeolus/pub/` for the User_Namespace and a set containing the Acknowledgement_Namespace for the Reserved_System_Namespace.
2. THE Reserved_System_Namespace SHALL be derived so that it stays consistent with the acknowledgement subtree the broker ingestion path actually consumes, so the denied namespace and the forged-ack surface cannot drift apart.
3. IF the configured User_Namespace prefix falls within any Reserved_System_Namespace prefix by Segment_Boundary_Match, THEN THE system SHALL treat the configuration as invalid and SHALL fail closed by denying all Non_Admin publishes rather than allowing publishes into a reserved subtree.

### Requirement 9: No regression for internal publishers and legitimate use

**User Story:** As an existing user, I want internal command dispatch and legitimate automation-facing publishes to keep working, so that confining the raw endpoint does not break the platform's own MQTT traffic.

#### Acceptance Criteria

1. THE confinement SHALL apply only to the Raw_Publish_Endpoint and SHALL NOT change the behavior of `MqttService.publish` for internal callers (the command dispatch path, acknowledgement responders, and connectors).
2. WHEN a Non_Admin publishes to a topic within the User_Namespace, THE Raw_Publish_Endpoint SHALL deliver the message to the broker so that automations subscribed to the User_Namespace continue to receive user-originated events.
3. THE Raw_Publish_Endpoint SHALL continue to require an authenticated User and SHALL reject an unauthenticated request with HTTP status 401.
