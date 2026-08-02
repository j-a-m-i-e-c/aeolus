// src/connectors/kasa/kasa-power-state.test.ts — canonical Kasa power-state resolution

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { kasaPowerState } from "./kasa-power-state.js";

describe("kasaPowerState", () => {
  it("reports a plug with relay_state=1 as on (regression for H1)", () => {
    expect(kasaPowerState({ relay_state: 1 })).toBe(true);
  });

  it("reports a plug with relay_state=0 as off", () => {
    expect(kasaPowerState({ relay_state: 0 })).toBe(false);
  });

  it("reports a bulb with light_state.on_off=1 as on regardless of relay_state", () => {
    expect(kasaPowerState({ light_state: { on_off: 1 } })).toBe(true);
    expect(kasaPowerState({ relay_state: 0, light_state: { on_off: 1 } })).toBe(true);
  });

  it("reports a bulb with light_state.on_off=0 as off even when relay_state=1", () => {
    expect(kasaPowerState({ relay_state: 1, light_state: { on_off: 0 } })).toBe(false);
  });

  it("reports false when neither field is present", () => {
    expect(kasaPowerState({})).toBe(false);
    expect(kasaPowerState(undefined)).toBe(false);
  });

  // Feature: connector-correctness-release-gates, Property 1: Kasa power state
  // precedence is total and correct
  it("Property 1: precedence is total and never throws", () => {
    fc.assert(
      fc.property(
        fc.record(
          {
            relay_state: fc.option(fc.integer(), { nil: undefined }),
            light_state: fc.option(
              fc.record({ on_off: fc.option(fc.integer(), { nil: undefined }) }),
              { nil: undefined },
            ),
          },
          { requiredKeys: [] },
        ),
        (sysInfo) => {
          const result = kasaPowerState(sysInfo);
          expect(typeof result).toBe("boolean");
          const lightOnOff = sysInfo.light_state?.on_off;
          if (lightOnOff !== undefined) {
            expect(result).toBe(lightOnOff === 1);
          } else {
            expect(result).toBe(sysInfo.relay_state === 1);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
