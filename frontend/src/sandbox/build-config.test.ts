// frontend/src/sandbox/build-config.test.ts — Asserts the Vite config declares the sandbox-runtime entry

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const viteConfig = readFileSync(resolve(__dirname, "../../vite.config.ts"), "utf-8");

describe("Vite build config — sandbox-runtime entry", () => {
  it("declares a 'sandbox-runtime' rollup input entry", () => {
    expect(viteConfig).toContain('"sandbox-runtime"');
    expect(viteConfig).toContain("src/sandbox/runtime/entry.ts");
  });

  it("emits the sandbox-runtime at assets/sandbox-runtime.js (stable, unhashed)", () => {
    expect(viteConfig).toContain("assets/sandbox-runtime.js");
  });

  it("has two build inputs (index + sandbox-runtime)", () => {
    // Both input keys must be present
    expect(viteConfig).toMatch(/input:\s*\{/);
    expect(viteConfig).toMatch(/index:\s*path\.resolve/);
    expect(viteConfig).toContain('"sandbox-runtime"');
  });
});
