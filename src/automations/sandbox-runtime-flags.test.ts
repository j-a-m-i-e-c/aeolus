// src/automations/sandbox-runtime-flags.test.ts — launch-flag contract for the isolate
//
// isolated-vm's README marks `--no-node-snapshot` as MANDATORY on Node 20 and
// later. Aeolus runs Node 24, so every process that creates an isolate must pass
// it. The failure mode is the reason this is a test rather than a comment:
// omitting the flag does not reliably throw. Node often tolerates it, so the
// suite can pass and the appliance can boot while running an unsupported V8
// startup configuration — the same class of silent-degradation trap that
// ADR-0009/0010 describe for the runtime pin itself.
//
// These are source-level assertions because the thing under test is how the
// process is launched, which a test running inside that process cannot observe
// for other deployments.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const read = (...parts: string[]): string => readFileSync(path.join(REPO_ROOT, ...parts), "utf8");

const FLAG = "--no-node-snapshot";

describe("isolated-vm launch flags", () => {
  it("passes --no-node-snapshot in the production container command", () => {
    const dockerfile = read("Dockerfile");
    // Anchored on the runtime CMD specifically: the healthcheck CMD above it also
    // matches a loose /CMD/ search.
    const cmd = dockerfile
      .split("\n")
      .find((line) => /^CMD \[/.test(line) && line.includes("dist/index.js"));
    expect(cmd, "Dockerfile must launch dist/index.js via a CMD array").toBeDefined();
    expect(cmd).toContain(FLAG);

    // It must be a node flag, not an argument handed to the application, so it
    // has to appear before the entry script.
    const flagAt = cmd!.indexOf(FLAG);
    const entryAt = cmd!.indexOf("dist/index.js");
    expect(flagAt).toBeLessThan(entryAt);
  });

  it("passes --no-node-snapshot from the start script", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts.start).toContain(FLAG);
    expect(pkg.scripts.start.indexOf(FLAG)).toBeLessThan(pkg.scripts.start.indexOf("dist/index.js"));
  });

  it("gives development and test runs the flag through npm node-options", () => {
    // npm forwards node-options into NODE_OPTIONS for lifecycle scripts, so
    // `npm test` and the vitest workers it spawns inherit it. Without this the
    // real-isolate integration tests would only prove that Node tolerated
    // isolated-vm without the required flag.
    const npmrc = read(".npmrc");
    const setting = npmrc
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith("node-options"));
    expect(setting, ".npmrc must set node-options").toBeDefined();
    expect(setting).toContain(FLAG);
  });

  it("does not force the flag on processes that never create an isolate", () => {
    // The simulator and the seed helper are separate entrypoints that do not use
    // isolated-vm. Adding the flag there would imply a dependency they do not
    // have, and hide where the real requirement comes from.
    for (const file of ["docker-compose.yml", "docker-compose.public-demo.yml"]) {
      const compose = read(file);
      const simulatorCommands = compose
        .split("\n")
        .filter((line) => line.includes("dist/simulator/index.js"));
      for (const line of simulatorCommands) {
        expect(line, `${file}: simulator does not need ${FLAG}`).not.toContain(FLAG);
      }
    }
  });
});
