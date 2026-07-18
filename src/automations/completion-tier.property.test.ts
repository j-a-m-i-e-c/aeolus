// src/automations/completion-tier.property.test.ts
// Feature: command-completion-tier — Properties 1, 2, 3, 4

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type { ConfirmationTier } from "./command-lifecycle.js";
import {
  computeCapabilityCeiling,
  isConfirmationTier,
  resolveEffectiveTier,
  tierRank,
  validateAgainstCeiling,
} from "./completion-tier.js";

const TIERS: ConfirmationTier[] = ["dispatch", "acknowledged", "observed"];

/** A tier value, drawn uniformly from the vocabulary. */
const tierArb = fc.constantFrom<ConfirmationTier>(...TIERS);

/** A ceiling: a tier or null (unresolvable). */
const ceilingArb = fc.oneof(tierArb, fc.constant(null));

/** A value that is definitely NOT a valid tier string. */
const nonTierArb = fc.oneof(
  fc.string().filter((s) => !isConfirmationTier(s)),
  fc.constantFrom("DISPATCH", "Observed", "ack", "none", ""),
  fc.integer(),
  fc.boolean(),
  fc.constant({}),
  fc.constant([]),
);

/** Absent values that mean "no tier". */
const absentArb = fc.constantFrom<null | undefined>(null, undefined);

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

// ─── Property 2: Authoring validation classifies every submission ────────────

// Feature: command-completion-tier, Property 2: Authoring validation classifies every submission against the ceiling
describe("Property 2: Authoring validation classifies every submission against the ceiling", () => {
  it("accepts absent submissions as null regardless of ceiling", () => {
    fc.assert(
      fc.property(absentArb, ceilingArb, (submitted, ceiling) => {
        const v = validateAgainstCeiling(submitted, ceiling);
        // Req 7.4 — omitted tier ⇒ accepted as null.
        expect(v).toEqual({ ok: true, tier: null });
      }),
      { numRuns: 200 },
    );
  });

  it("rejects non-tier values as invalid before consulting the ceiling", () => {
    fc.assert(
      fc.property(nonTierArb, ceilingArb, (submitted, ceiling) => {
        // Exclude the absent case handled by the previous test.
        fc.pre(submitted !== null && submitted !== undefined);
        const v = validateAgainstCeiling(submitted, ceiling);
        // Req 3.5 — not a tier string ⇒ invalid.
        expect(v.ok).toBe(false);
        if (!v.ok) expect(v.code).toBe("invalid");
      }),
      { numRuns: 200 },
    );
  });

  it("classifies a valid tier by comparing its rank to the ceiling", () => {
    fc.assert(
      fc.property(tierArb, ceilingArb, (submitted, ceiling) => {
        const v = validateAgainstCeiling(submitted, ceiling);
        if (ceiling === null) {
          // Req 3.6 — ceiling unresolvable.
          expect(v.ok).toBe(false);
          if (!v.ok) expect(v.code).toBe("ceiling_unresolvable");
        } else if (tierRank(submitted) > tierRank(ceiling)) {
          // Req 3.4 — over ceiling.
          expect(v.ok).toBe(false);
          if (!v.ok) expect(v.code).toBe("over_ceiling");
        } else {
          // Req 3.2, 3.3 — equal or lower ⇒ accepted verbatim.
          expect(v).toEqual({ ok: true, tier: submitted });
        }
      }),
      { numRuns: 200 },
    );
  });
});

// ─── Property 3: Effective-tier resolution honors precedence & passes through ─

// Feature: command-completion-tier, Property 3: Effective-tier resolution honors precedence and passes through in-ceiling tiers
describe("Property 3: Effective-tier resolution honors precedence and passes through in-ceiling tiers", () => {
  it("action-specified tier overrides the stored default when in ceiling", () => {
    fc.assert(
      fc.property(tierArb, tierArb, ceilingArb, (stored, actionSpecified, ceiling) => {
        // Constrain to the in-ceiling case so pass-through is expected.
        fc.pre(ceiling !== null && tierRank(actionSpecified) <= tierRank(ceiling));
        const effective = resolveEffectiveTier(stored, actionSpecified, ceiling);
        // Req 5.1, 5.2 — action-specified overrides stored, passed through verbatim.
        expect(effective).toBe(actionSpecified);
      }),
      { numRuns: 200 },
    );
  });

  it("uses the stored tier verbatim when no action tier is specified and it is in ceiling", () => {
    fc.assert(
      fc.property(tierArb, ceilingArb, (stored, ceiling) => {
        fc.pre(ceiling !== null && tierRank(stored) <= tierRank(ceiling));
        const effective = resolveEffectiveTier(stored, undefined, ceiling);
        // Req 4.1, 4.3, 6.7 — stored in-ceiling tier passes through unchanged.
        expect(effective).toBe(stored);
      }),
      { numRuns: 200 },
    );
  });

  it("passes valid in-ceiling tiers through when ceiling is null (script path)", () => {
    fc.assert(
      fc.property(tierArb, fc.option(tierArb, { nil: undefined }), (stored, actionSpecified) => {
        // ceiling null ⇒ no over-ceiling omission; the chosen valid tier passes through.
        const effective = resolveEffectiveTier(stored, actionSpecified, null);
        const chosen = actionSpecified !== undefined ? actionSpecified : stored;
        // Req 1.8, 5.1, 5.2 — precedence with pass-through under a null ceiling.
        expect(effective).toBe(chosen);
      }),
      { numRuns: 200 },
    );
  });
});

// ─── Property 4: Effective-tier resolution omits on doubt ────────────────────

// Feature: command-completion-tier, Property 4: Effective-tier resolution omits on absence, invalidity, or over-ceiling, and never returns an out-of-vocabulary value
describe("Property 4: Effective-tier resolution omits on absence, invalidity, or over-ceiling, and never returns an out-of-vocabulary value", () => {
  it("omits when both stored and action tier are absent", () => {
    fc.assert(
      fc.property(absentArb, absentArb, ceilingArb, (stored, actionSpecified, ceiling) => {
        const effective = resolveEffectiveTier(stored, actionSpecified, ceiling);
        // Req 4.2, 5.3, 7.1, 7.5 — absent ⇒ omit.
        expect(effective).toBeUndefined();
      }),
      { numRuns: 200 },
    );
  });

  it("omits when the chosen value is not a recognized tier", () => {
    fc.assert(
      fc.property(nonTierArb, ceilingArb, (invalid, ceiling) => {
        fc.pre(invalid !== null && invalid !== undefined);
        // Invalid as action-specified (takes precedence).
        expect(resolveEffectiveTier(undefined, invalid, ceiling)).toBeUndefined();
        // Invalid as stored default with no action tier.
        expect(resolveEffectiveTier(invalid, undefined, ceiling)).toBeUndefined(); // Req 4.5
      }),
      { numRuns: 200 },
    );
  });

  it("omits when the chosen valid tier exceeds a resolvable ceiling", () => {
    fc.assert(
      fc.property(tierArb, tierArb, (chosen, ceiling) => {
        fc.pre(tierRank(chosen) > tierRank(ceiling));
        // Req 4.6 — over-ceiling ⇒ omit.
        expect(resolveEffectiveTier(chosen, undefined, ceiling)).toBeUndefined();
        expect(resolveEffectiveTier(undefined, chosen, ceiling)).toBeUndefined();
      }),
      { numRuns: 200 },
    );
  });

  it("never returns an out-of-vocabulary value for any input combination", () => {
    fc.assert(
      fc.property(
        fc.oneof(tierArb, nonTierArb, absentArb),
        fc.oneof(tierArb, nonTierArb, absentArb),
        ceilingArb,
        (stored, actionSpecified, ceiling) => {
          const effective = resolveEffectiveTier(stored, actionSpecified, ceiling);
          // The result is always either undefined or a valid tier — never anything else.
          expect(effective === undefined || isConfirmationTier(effective)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });
});
