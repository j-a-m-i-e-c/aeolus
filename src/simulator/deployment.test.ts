// src/simulator/deployment.test.ts
// phase-2-mqtt-simulator Task 10 — deployment guardrails.
//
// The simulator must be OFF by default and present only in the public-demo
// overlay, with no published ports (Req 10.1, 10.2, 10.8). These assertions read
// the compose files so a future edit that leaks the simulator into the base
// stack, enables it by default, or exposes a port fails loudly.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadSimulatorConfig } from "./config.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const baseCompose = readFileSync(path.join(REPO_ROOT, "docker-compose.yml"), "utf8");
const demoCompose = readFileSync(path.join(REPO_ROOT, "docker-compose.demo.yml"), "utf8");

/** Extract the indented block for a named service from a compose file. */
function serviceBlock(compose: string, service: string): string | undefined {
  const lines = compose.split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^\\s{2}${service}:\\s*$`).test(line));
  if (start === -1) return undefined;
  const block: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    // A new top-level (2-space) service key ends the block.
    if (/^\s{2}\S/.test(lines[i]) && !/^\s{2}\s/.test(lines[i])) break;
    block.push(lines[i]);
  }
  return block.join("\n");
}

describe("simulator deployment guardrails", () => {
  it("is disabled by default in configuration", () => {
    expect(loadSimulatorConfig({}).enabled).toBe(false);
  });

  it("has no simulator service and no simulator enablement in the base compose", () => {
    expect(serviceBlock(baseCompose, "simulator")).toBeUndefined();
    expect(baseCompose).not.toContain("AEOLUS_SIMULATOR_ENABLED");
  });

  it("adds an enabled simulator service only in the demo overlay", () => {
    const block = serviceBlock(demoCompose, "simulator");
    expect(block).toBeDefined();
    expect(block).toContain('AEOLUS_SIMULATOR_ENABLED: "true"');
    expect(block).toContain("reference-water");
  });

  it("never publishes a port for the simulator (no public exposure)", () => {
    const block = serviceBlock(demoCompose, "simulator") ?? "";
    // A published port would appear as a `ports:` key inside the service block.
    expect(/^\s{4}ports:/m.test(block)).toBe(false);
    expect(block).toContain("network_mode: host");
  });
});
