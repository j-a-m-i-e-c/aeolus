// src/api/routes/mqtt-command-profile.test.ts
// phase-1-runtime-foundations Task 6 — MQTT command profile validation.

import { describe, it, expect } from "vitest";
import { validateMqttCommandProfile } from "./mqtt-command-profile.js";

describe("validateMqttCommandProfile", () => {
  it("accepts a full ack-capable profile and returns a sanitized value", () => {
    const result = validateMqttCommandProfile({
      qos: 1,
      acknowledgement: {
        supported: true,
        responseTopic: "aeolus/acks/esp32-relay",
        ackIndicatorField: "status",
        ackIndicatorValues: ["ok", "executed"],
      },
    });
    expect(result).toEqual({
      ok: true,
      value: {
        qos: 1,
        acknowledgement: {
          supported: true,
          responseTopic: "aeolus/acks/esp32-relay",
          ackIndicatorField: "status",
          ackIndicatorValues: ["ok", "executed"],
        },
      },
    });
  });

  it("drops unknown/secret-bearing fields (sanitize on write)", () => {
    const result = validateMqttCommandProfile({
      qos: 0,
      password: "hunter2",
      acknowledgement: { supported: true, token: "abc" },
    });
    expect(result).toEqual({ ok: true, value: { qos: 0, acknowledgement: { supported: true } } });
  });

  it("treats an empty object as a request to clear the profile", () => {
    expect(validateMqttCommandProfile({})).toEqual({ ok: true, value: undefined });
  });

  it.each([
    ["non-object body", 5],
    ["invalid qos", { qos: 5 }],
    ["non-boolean supported", { acknowledgement: { supported: "yes" } }],
    ["wildcard + response topic", { acknowledgement: { supported: true, responseTopic: "aeolus/acks/+" } }],
    ["wildcard # response topic", { acknowledgement: { supported: true, responseTopic: "aeolus/#" } }],
    ["empty response topic", { acknowledgement: { supported: true, responseTopic: "" } }],
    ["non-array indicator values", { acknowledgement: { supported: true, ackIndicatorValues: "ok" } }],
    ["non-string indicator value", { acknowledgement: { supported: true, ackIndicatorValues: [1] } }],
  ])("rejects %s", (_label, body) => {
    const result = validateMqttCommandProfile(body);
    expect(result.ok).toBe(false);
  });

  it("rejects an over-long response topic and an over-large indicator array", () => {
    expect(validateMqttCommandProfile({ acknowledgement: { supported: true, responseTopic: "a".repeat(300) } }).ok).toBe(false);
    expect(
      validateMqttCommandProfile({
        acknowledgement: { supported: true, ackIndicatorValues: Array.from({ length: 33 }, (_v, i) => `v${i}`) },
      }).ok,
    ).toBe(false);
  });
});
