// frontend/src/lib/completion-tier.test.ts — Acknowledgement (completion tier) helpers

import { describe, it, expect } from "vitest";

import {
  CONFIRMATION_TIERS,
  isConfirmationTier,
  tierApplies,
  tierLabel,
} from "./completion-tier";

describe("tier vocabulary", () => {
  it("exposes exactly the three backend tiers, weakest first", () => {
    expect([...CONFIRMATION_TIERS]).toEqual(["dispatch", "acknowledged", "observed"]);
  });

  it("accepts only the three tier strings", () => {
    expect(isConfirmationTier("dispatch")).toBe(true);
    expect(isConfirmationTier("observed")).toBe(true);
    expect(isConfirmationTier("ACKNOWLEDGED")).toBe(false);
    expect(isConfirmationTier(null)).toBe(false);
    expect(isConfirmationTier(undefined)).toBe(false);
    expect(isConfirmationTier(2)).toBe(false);
  });

  it("labels a known tier and falls back to the raw value otherwise", () => {
    expect(tierLabel("acknowledged")).toBe("Acknowledged");
    expect(tierLabel("bogus")).toBe("bogus");
  });
});

describe("tierApplies", () => {
  it("applies to every script rule", () => {
    expect(tierApplies({ ruleType: "script" })).toBe(true);
  });

  it("applies to a legacy form rule only when it is device-directed", () => {
    expect(tierApplies({ ruleType: "form", actionType: "device_action" })).toBe(true);
    expect(tierApplies({ ruleType: "form", actionType: "toggle" })).toBe(true);
  });

  it("does not apply to actions with nothing to acknowledge", () => {
    for (const actionType of ["log", "publish", "delay", "webhook"]) {
      expect(tierApplies({ ruleType: "form", actionType })).toBe(false);
    }
  });
});
