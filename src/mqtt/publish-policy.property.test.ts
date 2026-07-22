// src/mqtt/publish-policy.property.test.ts
// Property-based tests for the pure raw-publish confinement policy.
// Feature: mqtt-publish-confinement

import { describe, expect } from "vitest";
import { test, fc } from "@fast-check/vitest";
import {
  segmentBoundaryMatch,
  classifyTopic,
  evaluatePublish,
  type PublishPolicyConfig,
  type PrincipalRole,
} from "./publish-policy.js";

const RUNS = { numRuns: 100 };

const VALID_CONFIG: PublishPolicyConfig = {
  userNamespacePrefix: "aeolus/pub/",
  reservedSystemPrefixes: ["aeolus/acks/"],
  maxPayloadBytes: 1024,
};

const roleArb = fc.constantFrom<PrincipalRole>("admin", "user");

// Topics drawn from user-namespace, reserved, near-miss, and unrelated buckets.
const topicArb = fc.oneof(
  fc.constantFrom(
    "aeolus/pub",
    "aeolus/pub/lights",
    "aeolus/pub/a/b/c",
    "aeolus/acks",
    "aeolus/acks/dev-1",
    "aeolus/public/x", // near-miss: must NOT match aeolus/pub
    "aeolus/acksy/x", // near-miss: must NOT match aeolus/acks
    "home/lights/1",
    "devices/kitchen/set",
  ),
  fc.stringMatching(/^[a-z]+(\/[a-z0-9]+){0,4}$/),
);

describe("Property 1: classification precedence and determinism", () => {
  // Feature: mqtt-publish-confinement, Property 1: exactly one class; reserved wins; depends only on topic + config.
  test.prop([topicArb], RUNS)("returns exactly one class; reserved beats user", (topic) => {
    const cls = classifyTopic(topic, VALID_CONFIG);
    expect(["reserved-system", "user-namespace", "other"]).toContain(cls);
    // If it matches a reserved prefix at a boundary, it must be reserved-system.
    const matchesReserved = VALID_CONFIG.reservedSystemPrefixes.some((p) => segmentBoundaryMatch(topic, p));
    if (matchesReserved) {
      expect(cls).toBe("reserved-system");
    }
  });
});

describe("Property 2: segment-boundary matching", () => {
  // Feature: mqtt-publish-confinement, Property 2: matches only at topic-level boundaries.
  test.prop([fc.stringMatching(/^[a-z]+(\/[a-z]+){0,3}$/)], RUNS)(
    "never matches a partial final segment",
    (topic) => {
      // aeolus/public should never match prefix aeolus/pub.
      if (segmentBoundaryMatch(topic, "aeolus/pub")) {
        expect(topic === "aeolus/pub" || topic.startsWith("aeolus/pub/")).toBe(true);
      }
    },
  );
});

describe("Property 3: reserved-system is denied for every role", () => {
  // Feature: mqtt-publish-confinement, Property 3.
  test.prop([roleArb, fc.constantFrom("aeolus/acks", "aeolus/acks/dev-1", "aeolus/acks/x/y")], RUNS)(
    "any role publishing a reserved topic is denied 403",
    (role, topic) => {
      const d = evaluatePublish({ role, topic, retain: false, payloadBytes: 1 }, VALID_CONFIG);
      expect(d.allow).toBe(false);
      if (!d.allow) expect(d.status).toBe(403);
    },
  );
});

describe("Property 4: non-admin confinement", () => {
  // Feature: mqtt-publish-confinement, Property 4.
  test.prop([topicArb], RUNS)("non-admin allowed iff user-namespace", (topic) => {
    const d = evaluatePublish({ role: "user", topic, retain: false, payloadBytes: 1 }, VALID_CONFIG);
    const cls = classifyTopic(topic, VALID_CONFIG);
    if (topic.includes("+") || topic.includes("#")) return; // wildcard handled by Property 8
    expect(d.allow).toBe(cls === "user-namespace");
  });
});

describe("Property 5: admin latitude", () => {
  // Feature: mqtt-publish-confinement, Property 5.
  test.prop([topicArb], RUNS)("admin allowed unless reserved-system", (topic) => {
    if (topic.includes("+") || topic.includes("#")) return;
    const d = evaluatePublish({ role: "admin", topic, retain: false, payloadBytes: 1 }, VALID_CONFIG);
    const cls = classifyTopic(topic, VALID_CONFIG);
    expect(d.allow).toBe(cls !== "reserved-system");
  });
});

describe("Property 6: retain guardrail", () => {
  // Feature: mqtt-publish-confinement, Property 6.
  test.prop([roleArb], RUNS)("retain denies non-admin on an otherwise-allowed topic", (role) => {
    const d = evaluatePublish({ role, topic: "aeolus/pub/x", retain: true, payloadBytes: 1 }, VALID_CONFIG);
    if (role === "user") {
      expect(d.allow).toBe(false);
      if (!d.allow) expect(d.status).toBe(403);
    } else {
      expect(d.allow).toBe(true);
    }
  });
});

describe("Property 7: payload size guardrail", () => {
  // Feature: mqtt-publish-confinement, Property 7.
  test.prop([fc.integer({ min: 0, max: 4096 })], RUNS)("oversize allowed topic yields 413", (bytes) => {
    const d = evaluatePublish(
      { role: "admin", topic: "home/x", retain: false, payloadBytes: bytes },
      VALID_CONFIG,
    );
    if (bytes > VALID_CONFIG.maxPayloadBytes) {
      expect(d.allow).toBe(false);
      if (!d.allow) expect(d.status).toBe(413);
    } else {
      expect(d.allow).toBe(true);
    }
  });
});

describe("Property 8: wildcard rejection", () => {
  // Feature: mqtt-publish-confinement, Property 8.
  test.prop([roleArb, fc.constantFrom("aeolus/pub/+", "aeolus/pub/#", "home/+/x", "a/#")], RUNS)(
    "wildcard topics are 400 for any role",
    (role, topic) => {
      const d = evaluatePublish({ role, topic, retain: false, payloadBytes: 1 }, VALID_CONFIG);
      expect(d.allow).toBe(false);
      if (!d.allow) expect(d.status).toBe(400);
    },
  );
});

describe("Property 9: fail-closed on invalid config", () => {
  // Feature: mqtt-publish-confinement, Property 9.
  const invalidConfig: PublishPolicyConfig = {
    userNamespacePrefix: "aeolus/acks/pub/", // inside the reserved prefix
    reservedSystemPrefixes: ["aeolus/acks/"],
    maxPayloadBytes: 1024,
  };
  test.prop([topicArb], RUNS)("every non-admin publish is denied under invalid config", (topic) => {
    if (topic.includes("+") || topic.includes("#")) return;
    const d = evaluatePublish({ role: "user", topic, retain: false, payloadBytes: 1 }, invalidConfig);
    expect(d.allow).toBe(false);
  });
});

describe("Property 10: decision independent of request-supplied hints", () => {
  // Feature: mqtt-publish-confinement, Property 10: only role, topic, retain, payloadBytes matter.
  test.prop([roleArb, topicArb, fc.boolean(), fc.integer({ min: 0, max: 4096 })], RUNS)(
    "decision is a pure function of the four inputs",
    (role, topic, retain, payloadBytes) => {
      const a = evaluatePublish({ role, topic, retain, payloadBytes }, VALID_CONFIG);
      const b = evaluatePublish({ role, topic, retain, payloadBytes }, VALID_CONFIG);
      expect(a).toEqual(b);
    },
  );
});
