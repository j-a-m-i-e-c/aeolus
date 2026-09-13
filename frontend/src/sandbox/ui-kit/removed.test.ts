// frontend/src/sandbox/ui-kit/removed.test.ts — the removed ladder helpers must fail
// usefully, and must not come back working.
//
// The module loader rewrites a custom UI's `import { commandLadder } from "@aeolus/ui"`
// into a destructure of the kit object, so a removed export is `undefined` rather than an
// import error. The pane then dies at "commandLadder is not a function", which names
// neither the replacement nor the reason.

import { describe, expect, it } from "vitest";
import * as kitModule from "./index";
import { REMOVED_HELPERS } from "./removed";

// Reached by name so the test asserts what a custom UI's destructured import actually
// gets, rather than what a direct import of removed.ts would.
const kit = kitModule as unknown as Record<string, (...args: unknown[]) => unknown>;

describe("removed ladder helpers", () => {
  it("is still importable, so the failure is a message rather than undefined", () => {
    for (const name of REMOVED_HELPERS) {
      expect(typeof kit[name], `${name} should be callable`).toBe("function");
    }
  });

  it("names its replacement and the reason it went", () => {
    for (const name of REMOVED_HELPERS) {
      const helper = kit[name];
      let message = "";
      try {
        helper({});
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message, `${name} should throw`).not.toBe("");
      // The three things an author needs: which call failed, what to use, and where the
      // decision is recorded.
      expect(message).toContain(`${name}() was removed`);
      expect(message).toMatch(/commandProof|proofStageProps|proofHeadlineProps/);
      expect(message).toContain("ADR-0014");
    }
  });

  it("does not quietly resurrect the variable-length ladder", () => {
    // The whole point. A working shim would put the misleading rendering back into any
    // pane that called it: the old shape derived one rung per recorded transition, so a
    // stage a device could never reach was indistinguishable from one that was required
    // and never came.
    for (const name of REMOVED_HELPERS) {
      const helper = kit[name];
      expect(() => helper({ transitions: [{ toState: "DISPATCHED", timestamp: 1 }] })).toThrow();
    }
  });

  it("accounts for exactly the helpers ADR-0014 replaced", () => {
    expect([...REMOVED_HELPERS].sort()).toEqual([
      "commandLadder",
      "commandVerdict",
      "rungProps",
      "verdictProps",
    ]);
  });
});
