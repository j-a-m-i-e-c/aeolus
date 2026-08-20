// src/automations/completion-tier.property.test.ts
// Feature: command-completion-tier — Property 1
//
// Only the device Capability_Ceiling is modelled here now. Properties 2, 3 and 4
// covered `validateAgainstCeiling` and `resolveEffectiveTier`, both removed:
//
// - `resolveEffectiveTier` merged a stored per-automation default with a per-call
//   tier. The per-automation default is gone — one automation may command many
//   devices with different acknowledgement capabilities, so a single tier spanning
//   the rule could only ever be an aspiration the boundary clamped per device.
// - `validateAgainstCeiling` was an authoring-time ceiling validator that no
//   production path ever called; the routes validated the tier's shape instead.
//
// A tier is now stated per call in Logic, or omitted so each device independently
// resolves to the strongest level it can prove. Clamping lives in CommandService.

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type { ConfirmationTier } from "./command-lifecycle.js";
import { computeCapabilityCeiling, isConfirmationTier, tierRank } from "./completion-tier.js";

// ─── Property 1: Capability ceiling reflects exactly the provable tiers ──────

// Feature: command-completion-tier, Property 1: Capability ceiling reflects exactly the provable tiers
describe("Property 1: Capability ceiling reflects exactly the provable tiers", () => {
  it("reports exactly the provable tiers and the highest as ceiling", () => {
    fc.assert(
      fc.property(
        fc.record({
          dispatchable: fc.boolean(),
          ackSupported: fc.boolean(),
          observationAvailable: fc.boolean(),
        }),
        (input) => {
          const { tiers, ceiling } = computeCapabilityCeiling(input);

          if (!input.dispatchable) {
            // Req 2.7, 2.8 — non-dispatchable ⇒ no tiers, null ceiling.
            expect(tiers).toEqual([]);
            expect(ceiling).toBeNull();
            return;
          }

          // Req 2.1 — dispatch is universal for a dispatchable device.
          expect(tiers).toContain("dispatch");
          // Req 2.2, 2.3 — acknowledged iff ack supported.
          expect(tiers.includes("acknowledged")).toBe(input.ackSupported);
          // Req 2.4, 2.5 — observed iff an observation source is available.
          expect(tiers.includes("observed")).toBe(input.observationAvailable);

          // Req 2.6 — every reported tier uses the vocabulary.
          for (const t of tiers) expect(isConfirmationTier(t)).toBe(true);

          // Ceiling is the highest-rank member.
          expect(ceiling).not.toBeNull();
          const maxRank = Math.max(...tiers.map((t) => tierRank(t)));
          expect(tierRank(ceiling as ConfirmationTier)).toBe(maxRank);
        },
      ),
      { numRuns: 200 },
    );
  });
});
