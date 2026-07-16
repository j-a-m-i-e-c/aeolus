// frontend/src/sandbox/build-config.test.ts — Asserts the Vite config declares the sandbox-runtime entry

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const viteConfig = readFileSync(resolve(__dirname, "../../vite.config.ts"), "utf-8");

describe("Vite build config — sandbox entry", () => {
  it("declares a 'sandbox' HTML input entry", () => {
    expect(viteConfig).toContain("sandbox.html");
    expect(viteConfig).toMatch(/sandbox:\s*path\.resolve/);
  });

  it("has two build inputs (index + sandbox)", () => {
    expect(viteConfig).toMatch(/input:\s*\{/);
    expect(viteConfig).toMatch(/index:\s*path\.resolve/);
    expect(viteConfig).toMatch(/sandbox:\s*path\.resolve/);
  });
});
