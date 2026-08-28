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
});
