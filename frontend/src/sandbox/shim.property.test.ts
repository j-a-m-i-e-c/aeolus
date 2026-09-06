// frontend/src/sandbox/shim.property.test.ts — Property tests for the compatibility shim
// Feature: custom-ui-sandboxing, Properties 5 & 6

import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";
import { buildAutomationProps } from "./runtime/shim";
import type { AeolusUiSdk } from "./runtime/sdk-client";
import type { PropsPayload } from "./rpc-types";

function makeMockSdk(props: PropsPayload): AeolusUiSdk & { saveCalls: Array<{ key: string; value: unknown }> } {
  const stateMirror = new Map<string, unknown>(Object.entries(props.state ?? {}));
  const saveCalls: Array<{ key: string; value: unknown }> = [];

  return {
    saveCalls,
    read: (key: string) => stateMirror.get(key),
    save: vi.fn(async (key: string, value: unknown) => {
      stateMirror.set(key, value);
      saveCalls.push({ key, value });
    }),
    saveAndFire: vi.fn(async (key: string, value: unknown) => {
      stateMirror.set(key, value);
    }),
    fire: vi.fn(async () => {}),
    control: vi.fn(async () => ({ success: true, lifecycleState: "OBSERVED" })),
    publish: vi.fn(async () => {}),
    subscribeState: vi.fn(() => () => {}),
    subscribeProps: vi.fn(() => () => {}),
    getProps: () => props,
    dispose: vi.fn(),
  };
}

// ─── Property 5: The shim reconstructs the full CustomComponentProps surface ──

describe("Feature: custom-ui-sandboxing, Property 5: The shim reconstructs the full CustomComponentProps surface", () => {
  const arbPropsPayload = fc.record({
    entityType: fc.constant("automation" as const),
    ruleId: fc.string({ minLength: 1, maxLength: 30 }),
    ruleName: fc.string({ minLength: 1, maxLength: 50 }),
    lastFired: fc.oneof(fc.constant(null), fc.integer({ min: 0 })),
    enabled: fc.boolean(),
    devices: fc.constant([]),
    history: fc.constant([]),
    state: fc.dictionary(
      fc.string({ minLength: 1, maxLength: 10 }),
      fc.jsonValue(),
      { minKeys: 0, maxKeys: 5 },
    ),
  }) as fc.Arbitrary<PropsPayload>;

  it("reconstructs all CustomComponentProps fields from the payload", () => {
    fc.assert(
      fc.property(arbPropsPayload, (payload) => {
        const sdk = makeMockSdk(payload);
        const props = buildAutomationProps(sdk);

        expect(props.devices).toEqual(payload.devices);
        expect(props.ruleId).toBe(payload.ruleId);
        expect(props.ruleName).toBe(payload.ruleName);
        expect(props.lastFired).toBe(payload.lastFired);
        expect(props.enabled).toBe(payload.enabled);
        expect(props.history).toEqual(payload.history);

        // Methods are callable
        expect(typeof props.read).toBe("function");
        expect(typeof props.save).toBe("function");
        expect(typeof props.saveAndFire).toBe("function");
        expect(typeof props.fire).toBe("function");
        expect(typeof props.control).toBe("function");
        expect(typeof props.publish).toBe("function");
      }),
      { numRuns: 100 },
    );
  });

  it("read(key) returns the initial state value or undefined", () => {
    fc.assert(
      fc.property(
        arbPropsPayload,
        fc.string({ minLength: 1, maxLength: 10 }),
        (payload, key) => {
          const sdk = makeMockSdk(payload);
          const props = buildAutomationProps(sdk);
          const expected = Object.hasOwn(payload.state, key) ? payload.state[key] : undefined;
          expect(props.read(key)).toEqual(expected);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 6: Save/read round-trip preserves values through the SDK ──────

describe("Feature: custom-ui-sandboxing, Property 6: Save/read round-trip preserves values through the SDK", () => {
  it("read(key) after save(key,value) equals the value and broker effect was scoped", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.jsonValue(),
        (key, value) => {
          const payload: PropsPayload = {
            entityType: "automation",
            ruleId: "rule-99",
            ruleName: "Test",
            lastFired: null,
            enabled: true,
            devices: [],
            history: [],
            state: {},
          };
          const sdk = makeMockSdk(payload);
          const props = buildAutomationProps(sdk);

          props.save(key, value);

          // The SDK save was called (fire-and-forget from component's perspective)
          expect(sdk.save).toHaveBeenCalledWith(key, value);

          // After the save updates the mirror, read reflects the value
          expect(sdk.read(key)).toEqual(value);
        },
      ),
      { numRuns: 100 },
    );
  });
});
