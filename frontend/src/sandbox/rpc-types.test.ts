// frontend/src/sandbox/rpc-types.test.ts — Unit tests for RPC envelope guard and per-op validators

import { describe, it, expect } from "vitest";
import {
  isRpcRequest,
  isRpcHandshake,
  validateParams,
  RPC_CHANNEL,
  type SdkOp,
} from "./rpc-types";

// ─── isRpcRequest ────────────────────────────────────────────────────────────

describe("isRpcRequest", () => {
  const validRequest = {
    channel: RPC_CHANNEL,
    kind: "request",
    id: "abc-123",
    op: "read",
    params: { key: "temperature" },
  };

  it("accepts a well-formed request", () => {
    expect(isRpcRequest(validRequest)).toBe(true);
  });

  it("accepts all valid op values", () => {
    const ops: SdkOp[] = ["read", "save", "saveAndFire", "fire", "control", "publish", "subscribe"];
    for (const op of ops) {
      expect(isRpcRequest({ ...validRequest, op })).toBe(true);
    }
  });

  it("accepts requests with extra unknown keys (ignored)", () => {
    expect(isRpcRequest({ ...validRequest, extra: "stuff", nested: { a: 1 } })).toBe(true);
  });

  // Structural failures — should all return false (discard)

  it("rejects null", () => {
    expect(isRpcRequest(null)).toBe(false);
  });

  it("rejects undefined", () => {
    expect(isRpcRequest(undefined)).toBe(false);
  });

  it("rejects a non-object primitive", () => {
    expect(isRpcRequest("hello")).toBe(false);
    expect(isRpcRequest(42)).toBe(false);
    expect(isRpcRequest(true)).toBe(false);
  });

  it("rejects when channel is wrong", () => {
    expect(isRpcRequest({ ...validRequest, channel: "other-channel" })).toBe(false);
  });

  it("rejects when channel is missing", () => {
    const { channel: _c, ...rest } = validRequest;
    expect(isRpcRequest(rest)).toBe(false);
  });

  it("rejects when kind is not 'request'", () => {
    expect(isRpcRequest({ ...validRequest, kind: "response" })).toBe(false);
    expect(isRpcRequest({ ...validRequest, kind: "event" })).toBe(false);
    expect(isRpcRequest({ ...validRequest, kind: "init" })).toBe(false);
  });

  it("rejects when kind is missing", () => {
    const { kind: _k, ...rest } = validRequest;
    expect(isRpcRequest(rest)).toBe(false);
  });

  it("rejects when id is missing", () => {
    const { id: _i, ...rest } = validRequest;
    expect(isRpcRequest(rest)).toBe(false);
  });

  it("rejects when id is empty string", () => {
    expect(isRpcRequest({ ...validRequest, id: "" })).toBe(false);
  });

  it("rejects when id is not a string", () => {
    expect(isRpcRequest({ ...validRequest, id: 123 })).toBe(false);
    expect(isRpcRequest({ ...validRequest, id: null })).toBe(false);
  });

  it("rejects when op is not on the allowlist", () => {
    expect(isRpcRequest({ ...validRequest, op: "deleteAll" })).toBe(false);
    expect(isRpcRequest({ ...validRequest, op: "getToken" })).toBe(false);
    expect(isRpcRequest({ ...validRequest, op: "" })).toBe(false);
  });

  it("rejects when op is not a string", () => {
    expect(isRpcRequest({ ...validRequest, op: 42 })).toBe(false);
    expect(isRpcRequest({ ...validRequest, op: null })).toBe(false);
  });

  it("rejects when params is null", () => {
    expect(isRpcRequest({ ...validRequest, params: null })).toBe(false);
  });

  it("rejects when params is an array", () => {
    expect(isRpcRequest({ ...validRequest, params: [1, 2] })).toBe(false);
  });

  it("rejects when params is not an object", () => {
    expect(isRpcRequest({ ...validRequest, params: "string" })).toBe(false);
    expect(isRpcRequest({ ...validRequest, params: 42 })).toBe(false);
  });

  it("rejects when params is missing", () => {
    const { params: _p, ...rest } = validRequest;
    expect(isRpcRequest(rest)).toBe(false);
  });
});

// ─── isRpcHandshake ──────────────────────────────────────────────────────────

describe("isRpcHandshake", () => {
  it("accepts a well-formed handshake", () => {
    expect(isRpcHandshake({ channel: RPC_CHANNEL, kind: "handshake" })).toBe(true);
  });

  it("accepts handshake with extra keys", () => {
    expect(isRpcHandshake({ channel: RPC_CHANNEL, kind: "handshake", extra: true })).toBe(true);
  });

  it("rejects null", () => {
    expect(isRpcHandshake(null)).toBe(false);
  });

  it("rejects wrong channel", () => {
    expect(isRpcHandshake({ channel: "wrong", kind: "handshake" })).toBe(false);
  });

  it("rejects wrong kind", () => {
    expect(isRpcHandshake({ channel: RPC_CHANNEL, kind: "request" })).toBe(false);
  });
});

// ─── validateParams ──────────────────────────────────────────────────────────

describe("validateParams", () => {
  describe("read", () => {
    it("accepts valid params with a non-empty key", () => {
      expect(validateParams("read", { key: "temperature" })).toEqual({ valid: true });
    });

    it("accepts params with extra keys (ignored)", () => {
      expect(validateParams("read", { key: "temp", extra: 42 })).toEqual({ valid: true });
    });

    it("rejects when key is missing", () => {
      const result = validateParams("read", {});
      expect(result.valid).toBe(false);
      expect(result.message).toContain("key");
    });

    it("rejects when key is empty string", () => {
      const result = validateParams("read", { key: "" });
      expect(result.valid).toBe(false);
    });

    it("rejects when key is not a string", () => {
      expect(validateParams("read", { key: 42 }).valid).toBe(false);
      expect(validateParams("read", { key: null }).valid).toBe(false);
      expect(validateParams("read", { key: undefined }).valid).toBe(false);
    });
  });

  describe("save", () => {
    it("accepts valid params", () => {
      expect(validateParams("save", { key: "temp", value: 25 })).toEqual({ valid: true });
    });

    it("accepts null value (JSON-serializable)", () => {
      expect(validateParams("save", { key: "x", value: null })).toEqual({ valid: true });
    });

    it("accepts object value", () => {
      expect(validateParams("save", { key: "x", value: { nested: true } })).toEqual({ valid: true });
    });

    it("accepts array value", () => {
      expect(validateParams("save", { key: "x", value: [1, 2, 3] })).toEqual({ valid: true });
    });

    it("rejects when key is empty", () => {
      expect(validateParams("save", { key: "", value: 1 }).valid).toBe(false);
    });

    it("rejects when key is missing", () => {
      expect(validateParams("save", { value: 1 }).valid).toBe(false);
    });

    it("rejects when value is undefined", () => {
      expect(validateParams("save", { key: "x", value: undefined }).valid).toBe(false);
    });

    it("rejects when value key is absent", () => {
      expect(validateParams("save", { key: "x" }).valid).toBe(false);
    });
  });

  describe("saveAndFire", () => {
    it("accepts valid params (same as save)", () => {
      expect(validateParams("saveAndFire", { key: "mode", value: "cool" })).toEqual({ valid: true });
    });

    it("rejects when key is empty", () => {
      expect(validateParams("saveAndFire", { key: "", value: 1 }).valid).toBe(false);
    });

    it("rejects when value is missing", () => {
      expect(validateParams("saveAndFire", { key: "x" }).valid).toBe(false);
    });
  });

  describe("fire", () => {
    it("accepts valid params with eventName only", () => {
      expect(validateParams("fire", { eventName: "clicked" })).toEqual({ valid: true });
    });

    it("accepts valid params with eventName and payload object", () => {
      expect(validateParams("fire", { eventName: "target-changed", payload: { temp: 22 } })).toEqual({ valid: true });
    });

    it("accepts when payload is absent (optional)", () => {
      expect(validateParams("fire", { eventName: "go" })).toEqual({ valid: true });
    });

    it("rejects when eventName is empty", () => {
      expect(validateParams("fire", { eventName: "" }).valid).toBe(false);
    });

    it("rejects when eventName is missing", () => {
      expect(validateParams("fire", {}).valid).toBe(false);
    });

    it("rejects when eventName is not a string", () => {
      expect(validateParams("fire", { eventName: 42 }).valid).toBe(false);
    });

    it("rejects when payload is not an object", () => {
      expect(validateParams("fire", { eventName: "go", payload: "string" }).valid).toBe(false);
      expect(validateParams("fire", { eventName: "go", payload: 42 }).valid).toBe(false);
    });

    it("rejects when payload is an array", () => {
      expect(validateParams("fire", { eventName: "go", payload: [1, 2] }).valid).toBe(false);
    });

    it("rejects when payload is null", () => {
      expect(validateParams("fire", { eventName: "go", payload: null }).valid).toBe(false);
    });
  });

  describe("control", () => {
    it("accepts valid params with deviceId and actionType", () => {
      expect(validateParams("control", { deviceId: "light-1", actionType: "toggle" })).toEqual({ valid: true });
    });

    it("accepts params with optional params object", () => {
      expect(validateParams("control", { deviceId: "light-1", actionType: "setBrightness", params: { level: 80 } })).toEqual({ valid: true });
    });

    it("accepts when params field is absent (optional)", () => {
      expect(validateParams("control", { deviceId: "light-1", actionType: "toggle" })).toEqual({ valid: true });
    });

    it("rejects when deviceId is empty", () => {
      expect(validateParams("control", { deviceId: "", actionType: "toggle" }).valid).toBe(false);
    });

    it("rejects when deviceId is missing", () => {
      expect(validateParams("control", { actionType: "toggle" }).valid).toBe(false);
    });

    it("rejects when actionType is empty", () => {
      expect(validateParams("control", { deviceId: "light-1", actionType: "" }).valid).toBe(false);
    });

    it("rejects when actionType is missing", () => {
      expect(validateParams("control", { deviceId: "light-1" }).valid).toBe(false);
    });

    it("rejects when params is not an object", () => {
      expect(validateParams("control", { deviceId: "light-1", actionType: "x", params: "str" }).valid).toBe(false);
    });

    it("rejects when params is an array", () => {
      expect(validateParams("control", { deviceId: "light-1", actionType: "x", params: [1] }).valid).toBe(false);
    });
  });

  describe("publish", () => {
    it("accepts valid params with topic and payload", () => {
      expect(validateParams("publish", { topic: "home/lights", payload: "{}" })).toEqual({ valid: true });
    });

    it("accepts empty string payload (valid — just empty message)", () => {
      expect(validateParams("publish", { topic: "home/lights", payload: "" })).toEqual({ valid: true });
    });

    it("rejects when topic is empty", () => {
      expect(validateParams("publish", { topic: "", payload: "hi" }).valid).toBe(false);
    });

    it("rejects when topic is missing", () => {
      expect(validateParams("publish", { payload: "hi" }).valid).toBe(false);
    });

    it("rejects when payload is not a string", () => {
      expect(validateParams("publish", { topic: "t", payload: 42 }).valid).toBe(false);
      expect(validateParams("publish", { topic: "t", payload: null }).valid).toBe(false);
    });

    it("rejects when payload is missing", () => {
      expect(validateParams("publish", { topic: "t" }).valid).toBe(false);
    });
  });

  describe("subscribe", () => {
    it("accepts empty params (no required fields)", () => {
      expect(validateParams("subscribe", {})).toEqual({ valid: true });
    });

    it("accepts params with extra keys (ignored)", () => {
      expect(validateParams("subscribe", { whatever: true })).toEqual({ valid: true });
    });
  });
});
