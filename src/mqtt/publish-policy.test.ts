// src/mqtt/publish-policy.test.ts — unit tests for the raw-publish confinement policy.
// Feature: mqtt-publish-confinement

import { describe, it, expect } from "vitest";
import {
  segmentBoundaryMatch,
  classifyTopic,
  isPolicyConfigValid,
  evaluatePublish,
  type PublishPolicyConfig,
} from "./publish-policy.js";

const config: PublishPolicyConfig = {
  userNamespacePrefix: "aeolus/pub/",
  reservedSystemPrefixes: ["aeolus/acks/"],
  maxPayloadBytes: 1024,
};

describe("segmentBoundaryMatch", () => {
  it("matches at topic-level boundaries only", () => {
    expect(segmentBoundaryMatch("aeolus/pub", "aeolus/pub/")).toBe(true);
    expect(segmentBoundaryMatch("aeolus/pub/lights", "aeolus/pub/")).toBe(true);
    expect(segmentBoundaryMatch("aeolus/public/x", "aeolus/pub")).toBe(false);
    expect(segmentBoundaryMatch("aeolus/pubs", "aeolus/pub")).toBe(false);
    expect(segmentBoundaryMatch("home/x", "aeolus/pub")).toBe(false);
  });

  it("returns false for an empty prefix", () => {
    expect(segmentBoundaryMatch("anything", "")).toBe(false);
    expect(segmentBoundaryMatch("anything", "/")).toBe(false);
  });
});

describe("classifyTopic", () => {
  it("classifies reserved, user, and other", () => {
    expect(classifyTopic("aeolus/acks/dev-1", config)).toBe("reserved-system");
    expect(classifyTopic("aeolus/pub/lights", config)).toBe("user-namespace");
    expect(classifyTopic("home/lights/1", config)).toBe("other");
    expect(classifyTopic("devices/kitchen/set", config)).toBe("other");
  });
});

describe("isPolicyConfigValid", () => {
  it("is false when the user namespace falls within a reserved prefix", () => {
    expect(isPolicyConfigValid(config)).toBe(true);
    expect(
      isPolicyConfigValid({ ...config, userNamespacePrefix: "aeolus/acks/pub/" }),
    ).toBe(false);
  });
});

describe("evaluatePublish", () => {
  it("rejects wildcard topics with 400 for any role", () => {
    for (const role of ["admin", "user"] as const) {
      const d = evaluatePublish({ role, topic: "aeolus/pub/+", retain: false, payloadBytes: 1 }, config);
      expect(d).toEqual({ allow: false, status: 400, reason: expect.any(String) });
    }
  });

  it("denies reserved-system for every role with 403", () => {
    expect(evaluatePublish({ role: "user", topic: "aeolus/acks/x", retain: false, payloadBytes: 1 }, config).allow).toBe(false);
    const admin = evaluatePublish({ role: "admin", topic: "aeolus/acks/x", retain: false, payloadBytes: 1 }, config);
    expect(admin).toEqual({ allow: false, status: 403, reason: expect.any(String) });
  });

  it("confines non-admins to the user namespace", () => {
    expect(evaluatePublish({ role: "user", topic: "aeolus/pub/x", retain: false, payloadBytes: 1 }, config).allow).toBe(true);
    expect(evaluatePublish({ role: "user", topic: "home/x", retain: false, payloadBytes: 1 }, config)).toEqual({
      allow: false, status: 403, reason: expect.any(String),
    });
  });

  it("allows admins outside the user namespace", () => {
    expect(evaluatePublish({ role: "admin", topic: "home/x", retain: false, payloadBytes: 1 }, config).allow).toBe(true);
  });

  it("rejects retain for non-admins but allows it for admins", () => {
    expect(evaluatePublish({ role: "user", topic: "aeolus/pub/x", retain: true, payloadBytes: 1 }, config)).toEqual({
      allow: false, status: 403, reason: expect.any(String),
    });
    expect(evaluatePublish({ role: "admin", topic: "home/x", retain: true, payloadBytes: 1 }, config).allow).toBe(true);
  });

  it("enforces the payload size limit with 413", () => {
    expect(evaluatePublish({ role: "admin", topic: "home/x", retain: false, payloadBytes: 1025 }, config)).toEqual({
      allow: false, status: 413, reason: expect.any(String),
    });
    expect(evaluatePublish({ role: "admin", topic: "home/x", retain: false, payloadBytes: 1024 }, config).allow).toBe(true);
  });

  it("decides authorization (403) before the size guard (413)", () => {
    // A non-admin on 'other' with an oversized payload gets 403, not 413.
    const d = evaluatePublish({ role: "user", topic: "home/x", retain: false, payloadBytes: 99999 }, config);
    expect(d).toEqual({ allow: false, status: 403, reason: expect.any(String) });
  });
});
