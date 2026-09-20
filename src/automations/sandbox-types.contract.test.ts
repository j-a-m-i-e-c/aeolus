import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./sandbox-types.d.ts", import.meta.url)),
  "utf8",
);

describe("automation sandbox authoring types", () => {
  it("exposes EventContext for Automation Project entry functions", () => {
    expect(source).toContain("interface EventContext");
    expect(source).toContain("declare const context: EventContext;");
  });

  it("keeps connector-defined device types open-ended", () => {
    expect(source).toMatch(/interface Device[\s\S]*?type:\s*string;/);
  });

  it("exposes declarative command conditions rather than host-crossing predicates", () => {
    expect(source).toContain("type DeviceCondition =");
    expect(source).toContain("condition?: DeviceCondition;");
    expect(source).not.toContain("condition?: (state:");
  });

  it("exposes bulk actions as a first-class authored API", () => {
    expect(source).toMatch(/actionAll\([\s\S]*?Promise<BulkActionResult>/);
    expect(source).toContain("interface BulkActionResult");
  });

  it("exposes continueOnFailure when the runtime supports it", () => {
    expect(source).toContain("continueOnFailure?: boolean;");
  });

  it("exposes execution-grouped evidence for multi-command operations", () => {
    // §2.7. The authoring surface is where an author learns that keeping a single
    // `lastCommand` loses commands, so the grouped accessor has to be discoverable
    // here rather than only in the spec.
    expect(source).toContain("interface CommandExecutionEvidence");
    expect(source).toMatch(
      /executionEvidence\(executionId\?: string\): CommandExecutionEvidence \| undefined;/,
    );
    // The execution id is optional because the host resolves the running one.
    expect(source).not.toContain("executionEvidence(executionId: string)");
  });

  it("declares the executionId that grouping keys on", () => {
    // It was reachable at runtime long before it was declared, which is why a pane
    // could read it while an author could not see that it existed.
    expect(source).toMatch(/interface CommandEvidenceRecord[\s\S]*?executionId\?: string;/);
  });

  it("does not point authors at the superseded ladder helpers", () => {
    // A doc comment naming a removed API is a instruction to write broken code.
    for (const removed of ["commandLadder()", "commandVerdict()"]) {
      expect(source).not.toContain(removed);
    }
  });

  describe("Shared State (ADR-0016)", () => {
    it("declares `shared` as a first-class global, not a mode of `db`", () => {
      expect(source).toContain("declare const shared: {");
      expect(source).toMatch(/get\(bucket: string, key: string\): unknown;/);
      expect(source).toMatch(/set\(bucket: string, key: string, value: unknown\): boolean;/);
      expect(source).toMatch(/delete\(bucket: string, key: string\): boolean;/);
    });

    it("marks it optional, because a scoped automation cannot reach global Shared State", () => {
      expect(source).toMatch(/declare const shared: \{[\s\S]*?\} \| undefined;/);
    });

    it("tells an author a write reports whether anything changed", () => {
      // The whole point of the idempotency work is invisible unless the authoring
      // surface says an identical write costs nothing and triggers nothing.
      expect(source).toMatch(/Identical writes are free/);
      expect(source).toMatch(/shared-state.{0,20}trigger/is);
    });

    it("tells an author Shared State is not history", () => {
      expect(source).toMatch(/not history/i);
      expect(source).toMatch(/Collection record/);
    });

    it("steers current snapshots away from events.emit()", () => {
      // The mistake ADR-0016 exists to stop: publishing "what is true now" as an
      // occurrence, which gives it semantics it does not have and puts internal
      // composition traffic on the broker.
      expect(source).toMatch(/Do NOT use `events\.emit\(\)` for that/);
    });

    it("marks the legacy db bucket aliases deprecated and points at `shared`", () => {
      expect(source).toMatch(/@deprecated Use `shared\.get\(bucket, key\)`/);
      expect(source).toMatch(/@deprecated Use `shared\.set\(bucket, key, value\)`/);
      expect(source).toMatch(/@deprecated Use `shared\.delete\(bucket, key\)`/);
    });

    it("stops describing buckets as cross-automation state living inside `db`", () => {
      // The old example taught `db.set("computed", …)` as the way to share state,
      // which is what produced two overlapping abstractions in the first place.
      expect(source).not.toContain('db.set("computed"');
      expect(source).not.toContain("key-value buckets for cross-automation shared state");
    });

    it("declares `meta.sharedState`, so a trigger can say which key changed", () => {
      // The engine populates this on every `shared-state` trigger. Without it on the
      // authoring surface, an overview composing several keys has no typed way to ask
      // what woke it, and would be pushed back towards reading `context.topic`.
      expect(source).toMatch(/sharedState\?: \{/);
      expect(source).toMatch(/deleted: boolean;/);
    });

    it("tells an author to read `deleted` rather than guess from a null value", () => {
      // `null` is a legitimate stored value, so emptiness is not evidence of removal.
      expect(source).toMatch(/`null` is a\s+\* perfectly legitimate Shared State value/);
    });
  });
});
