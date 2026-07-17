// frontend/src/sandbox/sdk-broker.property.test.ts — Property-based tests for SdkBroker
// Feature: custom-ui-sandboxing
// fast-check ≥ 100 iterations per property

import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";
import { SdkBroker, type BrokerDeps, type FrameGrant } from "./sdk-broker";
import { RPC_CHANNEL, SDK_OPS, type SdkOp, type EntityType } from "./rpc-types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Create a fake MessagePort with a spy on postMessage. */
function createFakePort(): MessagePort {
  const port = {
    postMessage: vi.fn(),
    onmessage: null as ((event: MessageEvent) => void) | null,
    onmessageerror: null,
    close: vi.fn(),
    start: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  } as unknown as MessagePort;
  return port;
}

/** Create spy BrokerDeps that record all calls. */
function createSpyDeps(): BrokerDeps & { calls: Array<{ op: string; args: unknown[] }> } {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  return {
    calls,
    control: vi.fn(async (...args: unknown[]) => { calls.push({ op: "control", args }); return { success: true }; }),
    save: vi.fn((...args: unknown[]) => { calls.push({ op: "save", args }); }),
    saveAndFire: vi.fn((...args: unknown[]) => { calls.push({ op: "saveAndFire", args }); }),
    fire: vi.fn((...args: unknown[]) => { calls.push({ op: "fire", args }); }),
    publish: vi.fn((...args: unknown[]) => { calls.push({ op: "publish", args }); }),
    readState: vi.fn((...args: unknown[]) => { calls.push({ op: "readState", args }); return "cached-value"; }),
    subscribeState: vi.fn(() => vi.fn()),
  };
}

/** Build a valid RPC request for a given op. */
function validParamsForOp(op: SdkOp): Record<string, unknown> {
  switch (op) {
    case "read": return { key: "temperature" };
    case "save": return { key: "mode", value: "cool" };
    case "saveAndFire": return { key: "target", value: 22 };
    case "fire": return { eventName: "clicked", payload: { x: 1 } };
    case "control": return { deviceId: "light-1", actionType: "toggle", params: { level: 80 } };
    case "publish": return { topic: "home/test", payload: "{}" };
    case "subscribe": return {};
  }
}

/** Arbitrary for valid SdkOp values. */
const arbSdkOp = fc.constantFrom(...Array.from(SDK_OPS) as SdkOp[]);

/** Arbitrary for entity type. */
const arbEntityType = fc.constantFrom<EntityType>("automation", "panel");

/** Arbitrary for non-empty string identifiers. */
const arbId = fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.trim().length > 0);

// ─── Property 1: Every privileged operation is scoped to the frame's granted entity ──

describe("Feature: custom-ui-sandboxing, Property 1: Every privileged operation is scoped to the frame's granted entity", () => {
  it("the broker always passes grant.entityId to deps, never a frame-supplied id", () => {
    return fc.assert(
      fc.asyncProperty(
        arbSdkOp,
        arbEntityType,
        arbId, // granted entityId (G)
        arbId, // spoofed entityId (F) that the frame might try to sneak in
        arbId, // frameId
        async (op, entityType, grantedId, spoofedId, frameId) => {
          const deps = createSpyDeps();
          const broker = new SdkBroker(deps);
          const port = createFakePort();

          const grant: FrameGrant = { frameId, entityType, entityId: grantedId, port };
          broker.register(grant);

          // Build params with a spoofed entityId field injected
          const params = { ...validParamsForOp(op), entityId: spoofedId };

          const request = {
            channel: RPC_CHANNEL,
            kind: "request",
            id: "req-1",
            op,
            params,
          };

          // Drive handleMessage directly and await the async dispatch
          await broker.handleMessage(grant, request);

          // Every dep call that receives an entityId must have the granted one
          for (const call of deps.calls) {
            // control: (entityId, deviceId, actionType, params?)
            // save/saveAndFire: (entityType, entityId, key, value)
            // fire: (entityType, entityId, eventName, payload?)
            // readState: (entityType, entityId, key)
            // publish: (topic, payload) — no entityId
            if (call.op === "control") {
              expect(call.args[0]).toBe(grantedId);
            } else if (["save", "saveAndFire", "fire", "readState"].includes(call.op)) {
              expect(call.args[0]).toBe(entityType);
              expect(call.args[1]).toBe(grantedId);
            }
            // publish has no entity scoping — it's topic-scoped
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("messages on different ports are attributed only to their own frame's grant", () => {
    return fc.assert(
      fc.asyncProperty(
        arbEntityType,
        arbId,
        arbId,
        async (entityType, entityIdA, entityIdB) => {
          // Ensure distinct entity ids
          const idA = entityIdA + "-A";
          const idB = entityIdB + "-B";

          const deps = createSpyDeps();
          const broker = new SdkBroker(deps);
          const portA = createFakePort();
          const portB = createFakePort();

          const grantA: FrameGrant = { frameId: "frame-A", entityType, entityId: idA, port: portA };
          const grantB: FrameGrant = { frameId: "frame-B", entityType, entityId: idB, port: portB };

          broker.register(grantA);
          broker.register(grantB);

          // Send a request on port A's behalf
          const request = {
            channel: RPC_CHANNEL,
            kind: "request",
            id: "req-1",
            op: "read" as SdkOp,
            params: { key: "temp" },
          };

          await broker.handleMessage(grantA, request);

          // The readState call should be for idA, not idB
          expect(deps.readState).toHaveBeenCalledWith(entityType, idA, "temp");
          expect(deps.readState).not.toHaveBeenCalledWith(entityType, idB, expect.anything());
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 2: State subscriptions are delivered only for the granted entity ──

describe("Feature: custom-ui-sandboxing, Property 2: State subscriptions are delivered only for the granted entity", () => {
  it("frame receives state events only for changes targeting its granted entity", () => {
    fc.assert(
      fc.property(
        arbEntityType,
        arbId, // granted entity G
        fc.array(
          fc.record({
            entityId: arbId,
            key: fc.string({ minLength: 1, maxLength: 20 }),
            value: fc.jsonValue(),
          }),
          { minLength: 1, maxLength: 20 },
        ),
        (entityType, grantedId, changes) => {
          // Capture the subscriber callback
          let stateCallback: ((key: string, value: unknown) => void) | null = null;
          const deps = createSpyDeps();
          deps.subscribeState = vi.fn((_et, _eid, cb) => {
            stateCallback = cb;
            return vi.fn();
          });

          const broker = new SdkBroker(deps);
          const port = createFakePort();
          const grant: FrameGrant = { frameId: "frame-1", entityType, entityId: grantedId, port };
          broker.register(grant);

          // The subscribeState was called with the granted entity
          expect(deps.subscribeState).toHaveBeenCalledWith(entityType, grantedId, expect.any(Function));
          expect(stateCallback).not.toBeNull();

          // Simulate state changes — the callback is only called for the granted entity
          // (because the broker subscribed specifically to grantedId)
          // So every invocation of stateCallback means a change for the granted entity
          for (const change of changes) {
            if (change.entityId === grantedId) {
              stateCallback!(change.key, change.value);
            }
          }

          // Count how many changes were for the granted entity
          const expectedCount = changes.filter((c) => c.entityId === grantedId).length;
          expect((port.postMessage as ReturnType<typeof vi.fn>).mock.calls.length).toBe(expectedCount);

          // Every posted message must be a state event with the correct key/value
          const postedMessages = (port.postMessage as ReturnType<typeof vi.fn>).mock.calls;
          const grantedChanges = changes.filter((c) => c.entityId === grantedId);
          for (let i = 0; i < postedMessages.length; i++) {
            const msg = postedMessages[i][0];
            expect(msg.channel).toBe(RPC_CHANNEL);
            expect(msg.kind).toBe("event");
            expect(msg.event).toBe("state");
            expect(msg.data.key).toBe(grantedChanges[i].key);
            expect(msg.data.value).toEqual(grantedChanges[i].value);
          }

          return true;
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 3: Invalid messages are rejected with no privileged effect ─────

describe("Feature: custom-ui-sandboxing, Property 3: Invalid messages are rejected with no privileged effect", () => {
  /** Arbitrary for structurally malformed messages. */
  const arbMalformed = fc.oneof(
    // Wrong channel
    fc.record({
      channel: fc.string().filter((s) => s !== RPC_CHANNEL),
      kind: fc.constant("request"),
      id: arbId,
      op: fc.constantFrom("read", "save"),
      params: fc.constant({}),
    }),
    // Wrong kind
    fc.record({
      channel: fc.constant(RPC_CHANNEL),
      kind: fc.string().filter((s) => s !== "request"),
      id: arbId,
      op: fc.constantFrom("read", "save"),
      params: fc.constant({}),
    }),
    // Empty or non-string id
    fc.record({
      channel: fc.constant(RPC_CHANNEL),
      kind: fc.constant("request"),
      id: fc.oneof(fc.constant(""), fc.integer(), fc.constant(null)),
      op: fc.constantFrom("read", "save"),
      params: fc.constant({}),
    }),
    // Unknown op
    fc.record({
      channel: fc.constant(RPC_CHANNEL),
      kind: fc.constant("request"),
      id: arbId,
      op: fc.string({ minLength: 1 }).filter((s) => !SDK_OPS.has(s)),
      params: fc.constant({}),
    }),
    // Null/non-object
    fc.oneof(fc.constant(null), fc.constant(undefined), fc.integer(), fc.string()),
  );

  it("malformed messages produce zero BrokerDeps effects", () => {
    fc.assert(
      fc.property(arbMalformed, arbEntityType, arbId, (message, entityType, entityId) => {
        const deps = createSpyDeps();
        const broker = new SdkBroker(deps);
        const port = createFakePort();
        const grant: FrameGrant = { frameId: "f1", entityType, entityId, port };
        broker.register(grant);

        broker.handleMessage(grant, message);

        // No privileged effect should have been triggered
        expect(deps.calls.length).toBe(0);
        return true;
      }),
      { numRuns: 100 },
    );
  });

  it("requests with bad params produce BAD_SCHEMA error and zero effects", () => {
    // Generate valid ops but with invalid params
    const arbBadParams = fc.oneof(
      // read with non-string key
      fc.record({ op: fc.constant("read" as SdkOp), params: fc.constant({ key: 123 }) }),
      // save with missing value
      fc.record({ op: fc.constant("save" as SdkOp), params: fc.constant({ key: "x" }) }),
      // fire with empty eventName
      fc.record({ op: fc.constant("fire" as SdkOp), params: fc.constant({ eventName: "" }) }),
      // control with missing deviceId
      fc.record({ op: fc.constant("control" as SdkOp), params: fc.constant({ actionType: "x" }) }),
      // publish with non-string payload
      fc.record({ op: fc.constant("publish" as SdkOp), params: fc.constant({ topic: "t", payload: 42 }) }),
    );

    fc.assert(
      fc.property(arbBadParams, arbEntityType, arbId, ({ op, params }, entityType, entityId) => {
        const deps = createSpyDeps();
        const broker = new SdkBroker(deps);
        const port = createFakePort();
        const grant: FrameGrant = { frameId: "f1", entityType, entityId, port };
        broker.register(grant);

        const request = {
          channel: RPC_CHANNEL,
          kind: "request",
          id: "req-bad",
          op,
          params,
        };

        broker.handleMessage(grant, request);

        // No privileged effect
        expect(deps.calls.length).toBe(0);

        // A BAD_SCHEMA response was posted
        const posted = (port.postMessage as ReturnType<typeof vi.fn>).mock.calls;
        expect(posted.length).toBe(1);
        const response = posted[0][0];
        expect(response.channel).toBe(RPC_CHANNEL);
        expect(response.kind).toBe("response");
        expect(response.id).toBe("req-bad");
        expect(response.ok).toBe(false);
        expect(response.error.code).toBe("BAD_SCHEMA");

        return true;
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 4: Every well-formed request yields exactly one correlated response ──

describe("Feature: custom-ui-sandboxing, Property 4: Every well-formed request yields exactly one correlated response", () => {
  it("each request gets exactly one response with matching id", () => {
    fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            op: arbSdkOp,
            id: fc.uuid(),
            shouldThrow: fc.boolean(),
          }),
          { minLength: 1, maxLength: 15 },
        ),
        arbEntityType,
        arbId,
        async (requests, entityType, entityId) => {
          const deps = createSpyDeps();

          // Make control throw randomly based on shouldThrow
          let callIndex = 0;
          const throwSet = new Set(
            requests
              .filter((r) => r.shouldThrow && r.op === "control")
              .map((r) => r.id),
          );

          deps.control = vi.fn(async () => {
            const currentId = requests[callIndex]?.id;
            callIndex++;
            if (throwSet.has(currentId)) {
              throw new Error("Device unreachable");
            }
            return { success: true };
          });

          const broker = new SdkBroker(deps);
          const port = createFakePort();
          const grant: FrameGrant = { frameId: "f1", entityType, entityId, port };
          broker.register(grant);

          // Send all requests
          callIndex = 0;
          const promises = requests.map((r) => {
            const msg = {
              channel: RPC_CHANNEL,
              kind: "request",
              id: r.id,
              op: r.op,
              params: validParamsForOp(r.op),
            };
            return broker.handleMessage(grant, msg);
          });

          await Promise.all(promises);

          // Verify: exactly one response per request
          const posted = (port.postMessage as ReturnType<typeof vi.fn>).mock.calls;
          expect(posted.length).toBe(requests.length);

          // Each response must have matching id and valid structure
          const responseIds = new Set<string>();
          for (const [msg] of posted) {
            expect(msg.channel).toBe(RPC_CHANNEL);
            expect(msg.kind).toBe("response");
            expect(typeof msg.id).toBe("string");
            expect(msg.id.length).toBeGreaterThan(0);
            expect(typeof msg.ok).toBe("boolean");
            if (msg.ok) {
              expect(msg.error).toBeUndefined();
            } else {
              expect(msg.error).toBeDefined();
              expect(typeof msg.error.code).toBe("string");
              expect(typeof msg.error.message).toBe("string");
            }
            responseIds.add(msg.id);
          }

          // All request ids should be present in responses
          for (const r of requests) {
            expect(responseIds.has(r.id)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
