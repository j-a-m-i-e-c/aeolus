// frontend/src/sandbox/mode-invariant.test.ts — Asserts trusted and untrusted modes are identical in v1
// Both modes must produce a frame with sandbox="allow-scripts" only and go through the same broker.

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const hookSource = readFileSync(
  resolve(__dirname, "./useSandboxedComponent.ts"),
  "utf-8",
);

describe("Trusted/untrusted mode — v1 invariant", () => {
  it("the iframe sandbox attribute is set to exactly 'allow-scripts' with no other tokens", () => {
    // The setAttribute call must pass exactly "allow-scripts" — nothing else
    expect(hookSource).toMatch(/setAttribute\(\s*["']sandbox["']\s*,\s*["']allow-scripts["']\s*\)/);
    // There must be no setAttribute("sandbox", ...) call with additional tokens
    const sandboxCalls = hookSource.match(/setAttribute\(\s*["']sandbox["']\s*,\s*["'][^"']*["']\s*\)/g);
    expect(sandboxCalls).not.toBeNull();
    expect(sandboxCalls!.length).toBe(1);
    expect(sandboxCalls![0]).toContain("allow-scripts");
    // The actual value must not include allow-same-origin
    expect(sandboxCalls![0]).not.toContain("allow-same-origin");
  });

  it("the mode parameter is accepted but unused in v1 (no relaxation)", () => {
    // The mode param should exist in the signature
    expect(hookSource).toContain("mode");
    expect(hookSource).toContain("SandboxMode");
    // But it should not be used to conditionally change behavior
    // (no if (mode === "trusted") style branching that weakens isolation)
    expect(hookSource).not.toMatch(/if\s*\(\s*mode\s*===\s*["']trusted["']\s*\)/);
  });
});
