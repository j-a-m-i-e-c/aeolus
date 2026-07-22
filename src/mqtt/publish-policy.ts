// src/mqtt/publish-policy.ts — Pure topic-space confinement policy for the raw
// MQTT publish endpoint (mqtt-publish-confinement spec).
//
// This module is pure and dependency-free so it is directly unit- and
// property-testable. It is the single source of the raw-publish authorization
// decision; the HTTP route is a thin adapter over `evaluatePublish`.

/** Classification of a publish topic against the configured namespaces. */
export type TopicClass = "reserved-system" | "user-namespace" | "other";

export interface PublishPolicyConfig {
  /** User-namespace prefix non-admin publishes are confined to, e.g. "aeolus/pub/". */
  userNamespacePrefix: string;
  /** Reserved system prefixes denied for all roles, e.g. ["aeolus/acks/"]. */
  reservedSystemPrefixes: string[];
  /** Maximum serialized payload size in bytes. */
  maxPayloadBytes: number;
}

/** Allow/deny decision. On deny, `status` maps to the HTTP status the route returns. */
export type PublishDecision =
  | { allow: true }
  | { allow: false; status: 400 | 403 | 413; reason: string };

/** Role of the requesting principal (mirrors `req.user.role`). */
export type PrincipalRole = "admin" | "user";

/**
 * Segment-boundary prefix match. A prefix matches a topic only at an MQTT
 * topic-level boundary: `aeolus/pub` matches `aeolus/pub` and `aeolus/pub/x`,
 * but NOT `aeolus/public/x`. A trailing slash on the prefix is normalized away
 * so `aeolus/pub/` and `aeolus/pub` behave identically.
 */
export function segmentBoundaryMatch(topic: string, prefix: string): boolean {
  const base = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  if (base.length === 0) {
    return false;
  }
  return topic === base || topic.startsWith(base + "/");
}

/**
 * Classify a topic. `reserved-system` takes precedence over `user-namespace`,
 * so a topic that somehow matches both is treated as reserved (fail-safe).
 * Depends only on the topic and the configured prefixes.
 */
export function classifyTopic(topic: string, config: PublishPolicyConfig): TopicClass {
  for (const prefix of config.reservedSystemPrefixes) {
    if (segmentBoundaryMatch(topic, prefix)) {
      return "reserved-system";
    }
  }
  if (segmentBoundaryMatch(topic, config.userNamespacePrefix)) {
    return "user-namespace";
  }
  return "other";
}

/**
 * True iff the configured user namespace does NOT fall within any reserved
 * system prefix. When false, the configuration is unsafe and the policy fails
 * closed for non-admins (see `evaluatePublish`).
 */
export function isPolicyConfigValid(config: PublishPolicyConfig): boolean {
  return !config.reservedSystemPrefixes.some((prefix) =>
    segmentBoundaryMatch(config.userNamespacePrefix, prefix),
  );
}

/** True when a topic contains an MQTT wildcard, which is invalid for publishing. */
function hasWildcard(topic: string): boolean {
  return topic.includes("+") || topic.includes("#");
}

/**
 * The complete allow/deny decision for a raw publish request. Assumes the topic
 * already passed schema validation (a non-empty string).
 *
 * Order (matches the requirements' status precedence):
 *  1. wildcard in topic            → 400
 *  2. invalid config (fail-closed) → non-admin 403
 *  3. reserved-system topic        → 403 (every role)
 *  4. non-admin & `other`          → 403
 *  5. non-admin & retain           → 403
 *  6. payload over the size limit  → 413
 *  7. otherwise                    → allow
 *
 * Authorization (403) is decided before the size guard (413) so an unauthorized
 * caller cannot probe the size limit.
 */
export function evaluatePublish(
  input: { role: PrincipalRole; topic: string; retain: boolean; payloadBytes: number },
  config: PublishPolicyConfig,
): PublishDecision {
  const { role, topic, retain, payloadBytes } = input;

  if (hasWildcard(topic)) {
    return { allow: false, status: 400, reason: "topic must not contain MQTT wildcards (+ or #)" };
  }

  const isAdmin = role === "admin";

  // Fail closed: a misconfigured user namespace inside a reserved prefix must
  // never open the control plane to non-admins.
  if (!isAdmin && !isPolicyConfigValid(config)) {
    return { allow: false, status: 403, reason: "publish namespace configuration is invalid" };
  }

  const topicClass = classifyTopic(topic, config);

  // Reserved system namespace is denied for every role (forged-ack protection).
  if (topicClass === "reserved-system") {
    return { allow: false, status: 403, reason: "topic is in a reserved system namespace" };
  }

  // Non-admins are confined to the user namespace.
  if (!isAdmin && topicClass === "other") {
    return { allow: false, status: 403, reason: "non-admin publish outside the user namespace" };
  }

  // Non-admins may not set retain (prevents planting a persistent fake state).
  if (!isAdmin && retain) {
    return { allow: false, status: 403, reason: "non-admin publish may not set the retain flag" };
  }

  if (payloadBytes > config.maxPayloadBytes) {
    return { allow: false, status: 413, reason: "payload exceeds the maximum size" };
  }

  return { allow: true };
}
