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
});
