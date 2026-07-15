// src/automations/command-lifecycle.property.test.ts
// Feature: verified-command-execution — Properties 5, 6, 7, 10

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type { CommandLifecycleState } from "../core/types.js";
import { canTransition, isTerminal, isSuccessState, selectRequiredTier } from "./command-lifecycle.js";

const ALL_STATES: CommandLifecycleState[] = [
  "REQUESTED", "DISPATCHED", "ACKNOWLEDGED", "OBSERVED",
  "FAILED", "TIMED_OUT", "STATE_MISMATCH",
];

const TERMINAL_SUCCESS_STATES: CommandLifecycleState[] = ["DISPATCHED", "ACKNOWLEDGED", "OBSERVED"];
const TERMINAL_FAILURE_STATES: CommandLifecycleState[] = ["FAILED", "TIMED_OUT", "STATE_MISMATCH"];

// ─── Property 5: Dispatch outcome maps to DISPATCHED or FAILED ───────────────

// Feature: verified-command-execution, Property 5: Dispatch outcome maps to DISPATCHED or FAILED
describe("Property 5: Dispatch outcome maps to DISPATCHED or FAILED", () => {
  it("REQUESTED can only transition to DISPATCHED or FAILED", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_STATES),
        (toState) => {
          const allowed = canTransition("REQUESTED", toState);
          if (toState === "DISPATCHED" || toState === "FAILED") {
            expect(allowed).toBe(true);
          } else {
            expect(allowed).toBe(false);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("DISPATCHED is terminal for success (isTerminal returns true)", () => {
    expect(isTerminal("DISPATCHED")).toBe(true);
  });

  it("FAILED is terminal (isTerminal returns true)", () => {
    expect(isTerminal("FAILED")).toBe(true);
  });
});

// ─── Property 6: ACKNOWLEDGED requires declared capability ───────────────────

// Feature: verified-command-execution, Property 6: ACKNOWLEDGED requires declared capability; dispatch-only terminates truthfully at DISPATCHED
describe("Property 6: ACKNOWLEDGED requires declared capability; dispatch-only terminates at DISPATCHED", () => {
  it("selectRequiredTier without capability and without confirm returns dispatch", () => {
    fc.assert(
      fc.property(
        fc.constant(undefined), // placeholder
        () => {
          const tier = selectRequiredTier(false, false);
          expect(tier).toBe("dispatch");
        },
      ),
      { numRuns: 200 },
    );
  });

  it("DISPATCHED is a success state (dispatch-only terminal success)", () => {
    expect(isSuccessState("DISPATCHED")).toBe(true);
  });

  it("ACKNOWLEDGED cannot be reached from REQUESTED directly", () => {
    expect(canTransition("REQUESTED", "ACKNOWLEDGED")).toBe(false);
  });

  it("ACKNOWLEDGED can only be reached from DISPATCHED (which requires actual dispatch)", () => {
    expect(canTransition("DISPATCHED", "ACKNOWLEDGED")).toBe(true);
    expect(canTransition("REQUESTED", "ACKNOWLEDGED")).toBe(false);
    expect(canTransition("OBSERVED", "ACKNOWLEDGED")).toBe(false);
    expect(canTransition("FAILED", "ACKNOWLEDGED")).toBe(false);
  });
});

// ─── Property 7: Every reported outcome carries a terminal lifecycle state ───

// Feature: verified-command-execution, Property 7: Every reported outcome carries a terminal lifecycle state
describe("Property 7: Every reported outcome carries a terminal lifecycle state", () => {
  it("all terminal states are recognized as terminal by isTerminal", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...TERMINAL_SUCCESS_STATES, ...TERMINAL_FAILURE_STATES),
        (state) => {
          expect(isTerminal(state)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("REQUESTED is never terminal", () => {
    expect(isTerminal("REQUESTED")).toBe(false);
  });

  it("truly terminal states (OBSERVED, FAILED, TIMED_OUT, STATE_MISMATCH) have no outward transitions", () => {
    const noOutwardStates: CommandLifecycleState[] = ["OBSERVED", "FAILED", "TIMED_OUT", "STATE_MISMATCH"];
    fc.assert(
      fc.property(
        fc.constantFrom(...noOutwardStates),
        fc.constantFrom(...ALL_STATES),
        (fromTerminal, toAny) => {
          expect(canTransition(fromTerminal, toAny)).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ─── Property 10: Highest available confirmation tier is selected ────────────

// Feature: verified-command-execution, Property 10: Highest available confirmation tier is selected
describe("Property 10: Highest available confirmation tier is selected", () => {
  it("returns observed when confirm present regardless of capability", () => {
    fc.assert(
      fc.property(
        fc.boolean(), // hasAckCapability
        (hasAckCapability) => {
          expect(selectRequiredTier(true, hasAckCapability)).toBe("observed");
        },
      ),
      { numRuns: 200 },
    );
  });

  it("returns acknowledged when no confirm but capability declared", () => {
    expect(selectRequiredTier(false, true)).toBe("acknowledged");
  });

  it("returns dispatch when neither confirm nor capability", () => {
    expect(selectRequiredTier(false, false)).toBe("dispatch");
  });

  it("follows ordering Observed > Acknowledged > Dispatch", () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.boolean(),
        (hasConfirm, hasAck) => {
          const tier = selectRequiredTier(hasConfirm, hasAck);
          if (hasConfirm) {
            expect(tier).toBe("observed");
          } else if (hasAck) {
            expect(tier).toBe("acknowledged");
          } else {
            expect(tier).toBe("dispatch");
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
