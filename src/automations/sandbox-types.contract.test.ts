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
});
