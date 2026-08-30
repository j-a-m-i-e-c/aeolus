import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const at = (...parts: string[]) => path.join(ROOT, ...parts);

describe("demo repository layout", () => {
  it("keeps normal Compose files at root and showcase-only Compose under demo/compose", () => {
    expect(existsSync(at("docker-compose.yml"))).toBe(true);
    expect(existsSync(at("docker-compose.desktop.yml"))).toBe(true);

    for (const file of ["local-showcase.yml", "hosted-runtime.yml", "hosted-build.yml"]) {
      expect(existsSync(at("demo", "compose", file)), file).toBe(true);
    }

    for (const legacy of [
      "docker-compose.demo.yml",
      "docker-compose.public-demo.yml",
      "docker-compose.public-demo.build.yml",
    ]) {
      expect(existsSync(at(legacy)), legacy).toBe(false);
    }
  });

  it("keeps showcase content and hosted operations inside demo/", () => {
    expect(existsSync(at("demo", "seed", "seed.mjs"))).toBe(true);
    expect(existsSync(at("demo", "operations", "reset.sh"))).toBe(true);
    expect(existsSync(at("demo", "operations", "create-golden.sh"))).toBe(true);
    expect(existsSync(at("demo", "operations", "health-check.sh"))).toBe(true);
    expect(existsSync(at("demo", "infrastructure", "terraform", "main.tf"))).toBe(true);
    expect(existsSync(at("demo", "config", "mosquitto.conf"))).toBe(true);

    expect(existsSync(at("scripts", "seed"))).toBe(false);
    expect(existsSync(at("infra", "public-demo"))).toBe(false);
  });

  it("retains all 26 authored showcase projects after the move", () => {
    const projects = readdirSync(at("demo", "seed", "projects"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory());
    expect(projects).toHaveLength(26);
  });

  it("pins hosted Compose path resolution to the repository root", () => {
    const common = readFileSync(at("demo", "operations", "lib", "common.sh"), "utf8");
    expect(common).toContain('--project-directory "$AEOLUS_REPO_ROOT"');
    expect(common).toContain("demo/compose/hosted-runtime.yml");
  });
});
